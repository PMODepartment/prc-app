/**
 * db.js — Supabase CRUD layer
 * Drop-in replacement for the Firebase db.js
 * 
 * All functions are async and return { data, error }.
 * Charts/dashboard reads use single optimized queries instead of many doc reads.
 */

import supabase from './supabase-config.js';

// ── AUTH ──────────────────────────────────────────────────────

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  return { data, error };
}

export async function signOut() {
  return supabase.auth.signOut();
}

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

export async function getCurrentUser() {
  const session = await getSession();
  if (!session) return null;
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', session.user.id)
    .single();
  return error ? null : data;
}

export async function registerUser(email, password, name) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return { data: null, error };

  // Insert into users table
  const { data: profile, error: profileError } = await supabase
    .from('users')
    .insert({ id: data.user.id, email, name, role: 'user', status: 'pending' })
    .select()
    .single();

  return { data: profile, error: profileError };
}

// Auth state change listener
export function onAuthStateChange(callback) {
  return supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null);
  });
}

// ── USERS ─────────────────────────────────────────────────────

export async function getAllUsers() {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .order('created_at', { ascending: false });
  return { data, error };
}

export async function getPendingUsers() {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  return { data, error };
}

export async function approveUser(userId, { role, projects }) {
  const { data, error } = await supabase
    .from('users')
    .update({ status: 'approved', role, projects })
    .eq('id', userId)
    .select()
    .single();
  return { data, error };
}

export async function rejectUser(userId, reason = '') {
  const { data, error } = await supabase
    .from('users')
    .update({ status: 'rejected', review_notes: reason })
    .eq('id', userId)
    .select()
    .single();
  return { data, error };
}

export async function updateUserRole(userId, role) {
  const { data, error } = await supabase
    .from('users')
    .update({ role })
    .eq('id', userId)
    .select()
    .single();
  return { data, error };
}

export async function assignUserToProjects(userId, projects) {
  const { data, error } = await supabase
    .from('users')
    .update({ projects })
    .eq('id', userId)
    .select()
    .single();
  return { data, error };
}

export async function getUserCounts() {
  // Single RPC call instead of 4 Firestore count queries
  const { data, error } = await supabase.rpc('get_user_counts');
  if (error || !data) {
    // Fallback: individual counts
    const [total, pending, approved, rejected] = await Promise.all([
      supabase.from('users').select('id', { count: 'exact', head: true }),
      supabase.from('users').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('users').select('id', { count: 'exact', head: true }).eq('status', 'approved'),
      supabase.from('users').select('id', { count: 'exact', head: true }).eq('status', 'rejected'),
    ]);
    return {
      data: {
        total: total.count,
        pending: pending.count,
        approved: approved.count,
        rejected: rejected.count,
      },
      error: null,
    };
  }
  return { data, error };
}

// ── PROJECTS ──────────────────────────────────────────────────

export async function getAllProjects() {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .order('id');
  return { data, error };
}

export async function getProject(projectId) {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single();
  return { data, error };
}

export async function createProject(project) {
  const { data, error } = await supabase
    .from('projects')
    .insert(project)
    .select()
    .single();
  return { data, error };
}

export async function updateProject(projectId, updates) {
  const { data, error } = await supabase
    .from('projects')
    .update(updates)
    .eq('id', projectId)
    .select()
    .single();
  return { data, error };
}

// ── WORK PACKAGES ─────────────────────────────────────────────

/**
 * Get all WPs for a project with optional filters.
 * Single query replaces multiple Firestore reads.
 */
export async function getWorkPackages(projectId, filters = {}) {
  let q = supabase
    .from('work_packages')
    .select('*')
    .eq('review_status', 'approved');  // only show approved WPs in dashboard

  if (projectId) q = q.eq('project_id', projectId);
  if (filters.trade) q = q.eq('trade', filters.trade);
  if (filters.zone) q = q.eq('zone', filters.zone);
  if (filters.award_status) q = q.eq('award_status', filters.award_status);
  if (filters.search) {
    q = q.or(`wp_no.ilike.%${filters.search}%,description.ilike.%${filters.search}%,cost_code.ilike.%${filters.search}%`);
  }

  q = q.order('wp_no');

  const { data, error } = await q;
  return { data, error };
}

/**
 * Get dashboard KPIs for a project — one query, fast.
 */
export async function getProjectKPIs(projectId) {
  const { data, error } = await supabase
    .from('work_packages')
    .select('award_status, approved_budget_bcb, total_awarded, variance, awarding_date, actual_awarding_date')
    .eq('project_id', projectId)
    .eq('review_status', 'approved');

  if (error) return { data: null, error };

  const wps = data || [];
  const totalBudget = wps.reduce((s, w) => s + (w.approved_budget_bcb || 0), 0);
  const totalAwarded = wps.reduce((s, w) => s + (w.total_awarded || 0), 0);
  const variance = totalBudget - totalAwarded;

  const awarded = wps.filter(w => w.award_status === 'Awarded').length;
  const partial = wps.filter(w => w.award_status === 'Partially Awarded').length;
  const notAwarded = wps.filter(w => w.award_status === 'Not Yet Awarded').length;

  const today = new Date();
  const lateAwards = wps.filter(w =>
    w.award_status !== 'Awarded' &&
    w.awarding_date &&
    new Date(w.awarding_date) < today
  ).length;

  return {
    data: {
      totalPackages: wps.length,
      awarded,
      partial,
      notAwarded,
      totalBudget,
      totalAwarded,
      variance,
      variancePct: totalBudget ? (variance / totalBudget) * 100 : 0,
      lateAwards,
    },
    error: null,
  };
}

/**
 * Get consolidated KPIs across ALL projects a user can access.
 */
export async function getConsolidatedKPIs(projectIds = null) {
  let q = supabase
    .from('work_packages')
    .select('project_id, award_status, approved_budget_bcb, total_awarded, variance, awarding_date, actual_awarding_date')
    .eq('review_status', 'approved');

  if (projectIds && projectIds.length) q = q.in('project_id', projectIds);

  const { data, error } = await q;
  if (error) return { data: null, error };

  const wps = data || [];
  // Group by project
  const byProject = {};
  wps.forEach(w => {
    if (!byProject[w.project_id]) byProject[w.project_id] = [];
    byProject[w.project_id].push(w);
  });

  return {
    data: {
      totalPackages: wps.length,
      awarded: wps.filter(w => w.award_status === 'Awarded').length,
      notAwarded: wps.filter(w => w.award_status === 'Not Yet Awarded').length,
      totalBudget: wps.reduce((s, w) => s + (w.approved_budget_bcb || 0), 0),
      totalAwarded: wps.reduce((s, w) => s + (w.total_awarded || 0), 0),
      byProject,
    },
    error: null,
  };
}

/**
 * Get WPs grouped by trade for chart data.
 */
export async function getWPsByTrade(projectId) {
  const { data, error } = await supabase
    .from('work_packages')
    .select('trade, award_status, approved_budget_bcb, total_awarded')
    .eq('project_id', projectId)
    .eq('review_status', 'approved');

  if (error) return { data: null, error };

  const grouped = {};
  (data || []).forEach(w => {
    const t = w.trade || 'Other';
    if (!grouped[t]) grouped[t] = { trade: t, total: 0, awarded: 0, budget: 0, contract: 0 };
    grouped[t].total++;
    if (w.award_status === 'Awarded') grouped[t].awarded++;
    grouped[t].budget += w.approved_budget_bcb || 0;
    grouped[t].contract += w.total_awarded || 0;
  });

  return { data: Object.values(grouped), error: null };
}

/**
 * Get WPs grouped by awarding period (quarter) for timeline charts.
 */
export async function getWPsByPeriod(projectId) {
  const { data, error } = await supabase
    .from('work_packages')
    .select('awarding_date, actual_awarding_date, approved_budget_bcb, total_awarded, award_status')
    .eq('project_id', projectId)
    .eq('review_status', 'approved')
    .not('awarding_date', 'is', null);

  if (error) return { data: null, error };

  const grouped = {};
  (data || []).forEach(w => {
    const d = new Date(w.awarding_date);
    const q = `Q${Math.ceil((d.getMonth() + 1) / 3)} ${d.getFullYear()}`;
    if (!grouped[q]) grouped[q] = { period: q, date: d, planned: 0, actual: 0, budget: 0, awarded: 0 };
    grouped[q].planned++;
    grouped[q].budget += w.approved_budget_bcb || 0;
    if (w.award_status === 'Awarded') {
      grouped[q].actual++;
      grouped[q].awarded += w.total_awarded || 0;
    }
  });

  return {
    data: Object.values(grouped).sort((a, b) => a.date - b.date),
    error: null,
  };
}

export async function createWorkPackage(wp) {
  const { data, error } = await supabase
    .from('work_packages')
    .insert({ ...wp, review_status: 'pending_review' })
    .select()
    .single();
  return { data, error };
}

export async function updateWorkPackage(id, updates) {
  const { data, error } = await supabase
    .from('work_packages')
    .update({ ...updates, review_status: 'pending_review' })
    .eq('id', id)
    .select()
    .single();
  return { data, error };
}

export async function approveWorkPackage(id) {
  const { data, error } = await supabase
    .from('work_packages')
    .update({ review_status: 'approved' })
    .eq('id', id)
    .select()
    .single();
  return { data, error };
}

export async function rejectWorkPackage(id, reason) {
  const { data, error } = await supabase
    .from('work_packages')
    .update({ review_status: 'rejected', review_notes: reason })
    .eq('id', id)
    .select()
    .single();
  return { data, error };
}

export async function getPendingWorkPackages() {
  const { data, error } = await supabase
    .from('work_packages')
    .select('*, projects(name)')
    .eq('review_status', 'pending_review')
    .order('created_at', { ascending: false });
  return { data, error };
}

// ── REAL-TIME SUBSCRIPTIONS ───────────────────────────────────
// Much simpler than Firestore onSnapshot

export function subscribeToWorkPackages(projectId, callback) {
  return supabase
    .channel(`wps:${projectId}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'work_packages',
      filter: `project_id=eq.${projectId}`,
    }, callback)
    .subscribe();
}

export function subscribeToUsers(callback) {
  return supabase
    .channel('users')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, callback)
    .subscribe();
}

// Unsubscribe: channel.unsubscribe()

// ── CSV EXPORT ────────────────────────────────────────────────

export function exportToCSV(workPackages, filename = 'work-packages.csv') {
  const headers = [
    'WP No', 'Cost Code', 'Description', 'Zone', 'Trade', 'Status',
    'Award Status', 'Planned Award', 'Actual Award', 'Aging',
    'Budget BCB', 'Total Awarded', 'Variance', '% Variance',
    'Contractor', 'PO/JO Numbers', 'Submittal', 'Remarks'
  ];

  const rows = workPackages.map(w => [
    w.wp_no, w.cost_code, w.description, w.zone, w.trade,
    w.procurement_status, w.award_status,
    w.awarding_date, w.actual_awarding_date,
    w.awarding_lead_time,
    w.approved_budget_bcb, w.total_awarded, w.variance,
    w.approved_budget_bcb ? ((w.variance / w.approved_budget_bcb) * 100).toFixed(1) + '%' : '',
    w.contractor, w.po_jo_numbers, w.submittal_type, w.remarks
  ].map(v => `"${(v ?? '').toString().replace(/"/g, '""')}"`));

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
