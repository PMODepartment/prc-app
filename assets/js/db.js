
/* ── WPDb ─────────────────────────────────────────────────────────── */
const WPDb = (() => {
  function mapWP(w) {
    if (!w) return null;
    return {
      ...w,
      firestoreId: w.id,
      approved_budget_bcb: w.approved_budget_bcb ?? null,
      budget_bcb: w.approved_budget_bcb ?? null,
      total_awarded: w.total_awarded ?? 0,
      contract_amount_php: w.total_awarded ?? 0,
      award_status: w.award_status || 'Not Yet Awarded',
    };
  }
  function unmap(w) {
    const d = { ...w };
    if (d.budget_bcb && !d.approved_budget_bcb) d.approved_budget_bcb = d.budget_bcb;
    delete d.firestoreId; delete d.budget_bcb; delete d.contract_amount_php; delete d.id;
    delete d.total_awarded; delete d.variance; delete d.awarding_lead_time;
    // never let a stale read-back of the audit fields be written back verbatim; the
    // stamp is applied fresh on every write via _auditStamp()
    delete d.updated_at; delete d.updated_by; delete d.updated_by_name;
    return d;
  }
  // Per-WP audit trail: stamp who last changed a work package and when, from the logged-in
  // profile. Applied on every insert/update so the WP detail panel can show "Last updated by …".
  // updated_by_name is a snapshot so the display survives even if that user is later removed.
  function _auditStamp() {
    const p = (typeof window !== 'undefined' && window.__profile) || {};
    return { updated_at: new Date().toISOString(), updated_by: p.id || null, updated_by_name: p.name || p.email || null };
  }
  // True if the error is a "column does not exist" (audit columns not migrated yet).
  function _isMissingAuditCol(error) {
    if (!error) return false;
    const m = (error.message || '') + (error.details || '');
    return error.code === '42703' || /updated_by_name|updated_by|updated_at/.test(m) && /column|does not exist|schema cache/i.test(m);
  }
  function _stripAudit(obj) { const d = {...obj}; delete d.updated_at; delete d.updated_by; delete d.updated_by_name; return d; }
  // Same deploy-order guard for the BCB baseline columns: they only exist once
  // MIGRATION_bcb_baselines.sql has been run, so every write retries without them.
  function _isMissingBcbCol(error) {
    if (!error) return false;
    const m = (error.message || '') + (error.details || '');
    return /budget_bcb[0-9]/.test(m) && /column|does not exist|schema cache/i.test(m);
  }
  function _stripBcb(obj) { const d = {...obj}; delete d.budget_bcb0; delete d.budget_bcb1; delete d.budget_bcb2; return d; }
  // Retry helper: strip whichever optional column set the DB is missing, then try again.
  function _stripOptional(obj, error) {
    if (_isMissingBcbCol(error)) return _stripBcb(_stripAudit(obj));
    return _stripAudit(obj);
  }
  async function getProjects() { const sb=await getSB(); const {data}=await sb.from('projects').select('*').order('id'); return data||[]; }
  async function getProject(id) { const sb=await getSB(); const {data}=await sb.from('projects').select('*').eq('id',id).single(); return data; }
  async function saveProject(d) { const sb=await getSB(); const {data}=await sb.from('projects').upsert(d,{onConflict:'id'}).select().single(); return data; }
  // Read relation (S4): non-viewers read the base work_packages table (with cost). Viewers are
  // blocked from the table by RLS and instead read the cost-free security-definer view
  // `wp_view_public`. Memoized probe; if the view doesn't exist yet (migration not run) we fall
  // back to the table so nothing hard-breaks (viewers just still see cost until the DB is migrated).
  let _wpRelCache=null;
  async function _wpRel() {
    if (!(typeof window!=='undefined' && window.__wpmRole==='viewer')) return 'work_packages';
    if (_wpRelCache) return _wpRelCache;
    try { const sb=await getSB(); const {error}=await sb.from('wp_view_public').select('id').limit(1); _wpRelCache = error ? 'work_packages' : 'wp_view_public'; }
    catch(_) { _wpRelCache='work_packages'; }
    return _wpRelCache;
  }
  async function getApprovedWPs(pid) { const sb=await getSB(); let q=sb.from(await _wpRel()).select('*').eq('review_status','approved'); if(pid) q=q.eq('project_id',pid); const {data}=await q.order('wp_no'); return (data||[]).map(mapWP); }
  async function getAllWPs(pid) { const sb=await getSB(); let q=sb.from(await _wpRel()).select('*'); if(pid) q=q.eq('project_id',pid); const {data}=await q.order('wp_no'); return (data||[]).map(mapWP); }
  async function getAllApprovedWPs() { return getApprovedWPs(null); }
  async function getApprovedWPsForProjects(ids) { if(!ids||!ids.length) return []; const sb=await getSB(); const {data}=await sb.from(await _wpRel()).select('*').eq('review_status','approved').in('project_id',ids).order('wp_no'); return (data||[]).map(mapWP); }
  async function getPendingWPs() { const sb=await getSB(); const {data}=await sb.from('work_packages').select('*').eq('review_status','pending_review').order('created_at',{ascending:false}); return (data||[]).map(mapWP); }
  async function getAllWPsForAdmin() { const sb=await getSB(); const {data}=await sb.from('work_packages').select('*').order('created_at',{ascending:false}); return (data||[]).map(mapWP); }
  async function getAllWPsForProjects(ids) { if(!ids||!ids.length) return []; const sb=await getSB(); const {data}=await sb.from('work_packages').select('*').in('project_id',ids).order('created_at',{ascending:false}); return (data||[]).map(mapWP); }
  async function getOfficerWPs(uid) { const sb=await getSB(); const {data}=await sb.from('work_packages').select('*').eq('assigned_officer',uid).order('wp_no'); return (data||[]).map(mapWP); }
  async function getWP(id) { const sb=await getSB(); const {data}=await sb.from(await _wpRel()).select('*').eq('id',id).single(); return mapWP(data); }
  async function getProjectWPs(pid) { return getAllWPs(pid); }
  async function submitWP(d,p) {
    const sb=await getSB(); const base={...unmap(d),review_status:'pending_review',assigned_officer:p?.id||null};
    let {data,error}=await sb.from('work_packages').insert({...base,..._auditStamp()}).select().single();
    if(error && (_isMissingAuditCol(error) || _isMissingBcbCol(error)))
      ({data,error}=await sb.from('work_packages').insert(_stripOptional(base,error)).select().single());
    if(error && _isMissingBcbCol(error))
      ({data,error}=await sb.from('work_packages').insert(_stripBcb(_stripAudit(base))).select().single());
    if(error) throw error; return data;
  }
  async function updateWP(id,d) {
    const sb=await getSB(); const base={...unmap(d),review_status:'pending_review'};
    let {data,error}=await sb.from('work_packages').update({...base,..._auditStamp()}).eq('id',id).select().single();
    if(error && (_isMissingAuditCol(error) || _isMissingBcbCol(error)))
      ({data,error}=await sb.from('work_packages').update(_stripOptional(base,error)).eq('id',id).select().single());
    if(error && _isMissingBcbCol(error))
      ({data,error}=await sb.from('work_packages').update(_stripBcb(_stripAudit(base))).eq('id',id).select().single());
    if(error) throw error; return data;
  }
  async function updateWPDirect(id,d) {
    const sb=await getSB(); const base=unmap(d);
    let {data,error}=await sb.from('work_packages').update({...base,..._auditStamp()}).eq('id',id).select().single();
    if(error && (_isMissingAuditCol(error) || _isMissingBcbCol(error)))
      ({data,error}=await sb.from('work_packages').update(_stripOptional(base,error)).eq('id',id).select().single());
    if(error && _isMissingBcbCol(error))
      ({data,error}=await sb.from('work_packages').update(_stripBcb(_stripAudit(base))).eq('id',id).select().single());
    if(error) throw error; return data;
  }
  async function createProject(d) { const sb=await getSB(); const {data,error}=await sb.from('projects').insert(d).select().single(); if(error) throw error; return data; }
  async function approveWP(id) { const sb=await getSB(); const {data}=await sb.from('work_packages').update({review_status:'approved'}).eq('id',id).select().single(); return data; }
  async function rejectWP(id,_,reason) { const sb=await getSB(); const {data}=await sb.from('work_packages').update({review_status:'rejected',review_notes:reason}).eq('id',id).select().single(); return data; }
  async function assignOfficer(id,uid) { const sb=await getSB(); const {data}=await sb.from('work_packages').update({assigned_officer:uid}).eq('id',id).select().single(); return data; }
  async function deleteWP(id) { const sb=await getSB(); const {error}=await sb.from('work_packages').delete().eq('id',id); if(error) throw error; }
  async function getAllUsers() { const sb=await getSB(); const {data}=await sb.from('users').select('*').order('created_at',{ascending:false}); return data||[]; }
  async function getUsersForAdmin(profile) {
    const all = await getAllUsers();
    if (profile.role === 'super_admin') return all;
    // admin: see users explicitly assigned to them, plus unassigned pending users
    return all.filter(u =>
      u.assigned_admin === profile.id ||
      (u.assigned_admin == null && u.status === 'pending')
    );
  }
  async function getAdminUsers() { const sb=await getSB(); const {data}=await sb.from('users').select('id,name,email,role').in('role',['admin','super_admin']).eq('status','approved').order('name'); return data||[]; }
  async function getManagerUsers() { const sb=await getSB(); const {data}=await sb.from('users').select('id,name,email,role').eq('role','manager').eq('status','approved').order('name'); return data||[]; }
  async function updateUser(id, updates) {
    const sb = await getSB();
    // Strip assigned_admin if it's in the payload but the column may not exist yet —
    // attempt the full update; if Supabase returns "column does not exist" retry without it
    const {data, error} = await sb.from('users').update(updates).eq('id',id).select().single();
    if (error) {
      if ((error.message||'').includes('assigned_admin') || error.code === '42703') {
        const safe = {...updates}; delete safe.assigned_admin;
        const {data:d2, error:e2} = await sb.from('users').update(safe).eq('id',id).select().single();
        if (e2) throw new Error(e2.message);
        return d2;
      }
      throw new Error(error.message);
    }
    return data;
  }
  async function updateLastLogin(id) {
    try {
      const sb = await getSB();
      await sb.from('users').update({last_login: new Date().toISOString()}).eq('id',id);
    } catch(e) { /* non-critical — ignore */ }
  }
  // COMPLETE user removal (admin "Remove user"). Purges BOTH the public.users profile row
  // AND the auth.users record via the public.admin_delete_user() SECURITY DEFINER RPC
  // (MIGRATION_admin_delete_user.sql) — the auth schema isn't writable by the client, so the
  // server-side function does the auth purge after re-checking the caller is an admin. This
  // frees the email for re-registration (Planning-App parity). Falls back to a profile-only
  // delete if the RPC doesn't exist yet (safe to deploy before the migration runs) — without
  // a profile the user still fails AppAuth.requireLogin (signed out), so access is revoked.
  async function deleteUser(id) {
    const sb = await getSB();
    const { error } = await sb.rpc('admin_delete_user', { target_id: id });
    if (error) {
      // 404/PGRST202 = function not created yet → fall back to profile-only delete.
      const missing = error.code === 'PGRST202' || /not exist|could not find|schema cache/i.test(error.message || '');
      if (!missing) throw error;
      const { error: delErr } = await sb.from('users').delete().eq('id', id);
      if (delErr) throw delErr;
    }
  }
  async function archiveProject(id) { const sb=await getSB(); const {error}=await sb.from('projects').update({status:'archived'}).eq('id',id); if(error) throw error; }
  async function unarchiveProject(id) { const sb=await getSB(); const {error}=await sb.from('projects').update({status:'active'}).eq('id',id); if(error) throw error; }
  async function updateProject(id,data) { const sb=await getSB(); const {data:d,error}=await sb.from('projects').update(data).eq('id',id).select().single(); if(error) throw error; return d; }
  async function deleteProject(id) { const sb=await getSB(); await sb.from('work_packages').delete().eq('project_id',id); const {error}=await sb.from('projects').delete().eq('id',id); if(error) throw error; }
  async function seedWP(d) { return submitWP(d,null); }
  return { getProjects,getProject,saveProject,createProject,getApprovedWPs,getAllWPs,getAllApprovedWPs,getApprovedWPsForProjects,getPendingWPs,getAllWPsForAdmin,getAllWPsForProjects,getOfficerWPs,getWP,getProjectWPs,submitWP,updateWP,updateWPDirect,approveWP,rejectWP,assignOfficer,deleteWP,getAllUsers,getUsersForAdmin,getAdminUsers,getManagerUsers,updateUser,updateLastLogin,deleteUser,archiveProject,unarchiveProject,updateProject,deleteProject,seedWP };
})();

/* ── Stats ─────────────────────────────────────────────────────────── */
function computeStats(wps) {
  const total=wps.length;
  // Awarded count / budget / awarded cost come from the WP-Monitoring Helping Sheet (authoritative)
  // via helpingMetrics; falls back to row-derived values for projects not in HELPING_FIGURES.
  const hm=helpingMetrics(wps);
  const awarded=hm.awarded;
  const notAwarded=Math.max(0,total-awarded);
  const totalBudget=hm.totalBudget;
  const totalContract=hm.awardedCost;
  const variance=totalBudget-totalContract;
  const today=new Date();
  const late=wps.filter(w=>!window.isResolved(w)&&w.awarding_date&&new Date(w.awarding_date)<today).length;
  return {total,awarded,notAwarded,totalBudget,totalContract,variance,late,awardRate:total?Math.round(awarded/total*100):0};
}

/* ── Awarded metrics are now FULLY ROW-DERIVED (no Helping Sheet) ──
   All six projects (AVR/GRP/OPW/SLN/SLT/UTM) were reconciled against their WP-Monitoring files and
   the row-derived basis below reproduces their Helping Sheets (and CORRECTS AVR101, whose Helping
   Sheet under-counted by ₱8.9M due to a date-gated SUMIFS that dropped awarded WPs with a blank
   actual-award date or below its hardcoded row range). So HELPING_FIGURES is now EMPTY — every
   project (incl. all future ones) computes from its rows, self-maintaining and immune to those
   spreadsheet leaks. The dict + override branch are kept only as an escape hatch if a project's row
   data is ever found to be unusable; prefer fixing the rows instead. Use project.html?id=<PID>&diag=1
   to inspect a project's awarded reconciliation. */
const HELPING_FIGURES = {};
// A WP is "resolved" — done, no longer sitting in the active backlog — when it's
// genuinely Awarded, OR flagged `not_to_be_awarded` (Ops decided it will NEVER go
// through a formal award: handled outside PRC entirely — petty cash, direct
// arrangement, scope removed). Requiring Procurement Status to be set to "Awarded"
// before the flag "counted" was a contradiction in the UI (the WP form would say
// "Award Status: Awarded" right next to "Not to be Awarded: Yes") — so this check
// is deliberately independent of award_status. Use it everywhere a WP's "is this
// done / not backlog" state matters — awarded counts, Due-Not-Awarded / Not-Due
// splits, Backlog tables — never re-inline `award_status==='Awarded'` (or its
// negation) for that purpose, or a not_to_be_awarded WP with Procurement Status
// left honest (not set to "Awarded") will still show stuck in the backlog forever
// while the KPI cards already treat it as closed.
window.isResolved = function (w) {
  return !!w && (w.award_status === 'Awarded' || !!w.not_to_be_awarded);
};
// A WP is "money awarded" when it's genuinely Awarded with a real cost, OR it's
// flagged `not_to_be_awarded` (see isResolved above) — its budget is realized
// savings at an effective ₱0 cost rather than data pending entry. Without this
// flag a WP like that is indistinguishable from "Awarded, cost not encoded yet"
// and gets dropped from BOTH sides of the ledger (Known Issue #17) instead of
// counting as real savings. Deliberately does NOT require award_status==='Awarded'
// (see isResolved) — the flag alone is sufficient. Use these two helpers
// everywhere the app decides whether a WP's money counts and what its effective
// awarded cost is — never re-inline `award_status==='Awarded' && total_awarded>0`,
// or a not_to_be_awarded WP will disagree between tabs/charts again.
window.isMoneyAwarded = function (w) {
  return !!w && (!!w.not_to_be_awarded || (w.award_status === 'Awarded' && (w.total_awarded || 0) > 0));
};
window.effectiveAwardedCost = function (w) {
  return (w && w.not_to_be_awarded) ? 0 : ((w && w.total_awarded) || 0);
};
// Aggregate awarded metrics over a set of WPs (grouped by project), row-derived.
function helpingMetrics(wps) {
  const byProj = {};
  (wps||[]).forEach(w => { (byProj[w.project_id] = byProj[w.project_id] || []).push(w); });
  let awarded=0, totalBudget=0, awardedCost=0, budgetAwarded=0, hsCovered=true;
  Object.keys(byProj).forEach(pid => {
    const arr = byProj[pid], hs = HELPING_FIGURES[pid];
    if (hs) {
      awarded += hs.awarded; totalBudget += hs.budget;
      awardedCost += hs.awardedCost; budgetAwarded += hs.budgetAwarded;
    } else {
      // STRICTER awarded definition: a WP counts as awarded only when award_status==='Awarded' AND it
      // carries an award amount (total_awarded>0) — "if it's awarded, it must have an awarded cost".
      // Awarded count, Awarded Cost AND Budget-for-Awarded all use this SAME set so they reconcile
      // with each other, with the chart/forecast, and with the source Helping Sheets. This rejects
      // both failure modes seen in the data: provisional costs sitting on "Not yet Awarded" WPs
      // (GRP/SLN/SLT over-count) and the Helping Sheet's date/row leaks (AVR under-count).
      hsCovered = false;
      // COUNT basis: every WP that's "resolved" (award_status==='Awarded', OR flagged
      // not_to_be_awarded — see isResolved). A WP that has genuinely been awarded but
      // whose cost hasn't been encoded yet is still an awarded WP — excluding it made
      // the Overview disagree with the WP List (CCM302 read 39 against a list of 40,
      // OPW101 64 against 62). Provisional costs on Not-Yet-Awarded rows are still excluded,
      // because that is decided by award_status, which the importer takes from the sheet's
      // own Remarks flag rather than from the presence of a cost.
      const awdAll = arr.filter(w => window.isResolved(w));
      // MONEY basis: only awarded WPs that actually carry a cost, OR are flagged
      // not_to_be_awarded (their budget is realized savings at an effective ₱0
      // cost — see isMoneyAwarded). Awarded Cost and Budget-for-Awarded must move
      // together — counting a costless WP's budget here would otherwise book its
      // entire BCB as "savings" while its real cost is still pending.
      const awd = awdAll.filter(w => window.isMoneyAwarded(w));
      awarded += awdAll.length;
      totalBudget += arr.reduce((s,w)=>s+(w.approved_budget_bcb||0),0);
      awardedCost += awd.reduce((s,w)=>s+window.effectiveAwardedCost(w),0);
      budgetAwarded += awd.reduce((s,w)=>s+(w.approved_budget_bcb||0),0);
    }
  });
  return {awarded, totalBudget, awardedCost, budgetAwarded, hsCovered};
}

/* ── Status glyphs — never encode meaning in colour alone ──────────────────
   Award/procurement/submittal/delivery states were distinguished ONLY by red vs
   green, which ~8% of men cannot reliably tell apart (and which disappears in a
   greyscale print of the PDF export). Every status label now carries a leading
   glyph, so the state is readable without perceiving colour at all.
   `window.statusGlyph(text)` returns the marker for a status string. */
const _STATUS_GLYPHS = [
  [/^awarded$/i,                         '✔'],   // ✔ done
  [/not yet awarded|not awarded/i,       '○'],   // ○ open
  [/^delivered$|^approved$/i,            '✔'],
  [/approved w\/ comments/i,             '✓'],   // ✓ done, with caveats
  [/^submitted$|manufactured|produced/i, '◐'],   // ◐ in progress
  [/detailed drawings|dp paid/i,         '◐'],
  [/evaluated|solicited|sourced/i,       '◐'],
  [/not started|not required/i,          '○'],
  [/overdue|due not awarded|rejected/i,  '⚠'],   // ⚠ needs attention
  [/pending/i,                           '⏱'],   // ⏱ waiting
];
function statusGlyph(text) {
  const t = String(text == null ? '' : text).trim();
  if (!t) return '';
  for (const [re, g] of _STATUS_GLYPHS) if (re.test(t)) return g;
  return '';
}
// Convenience: "✔ Awarded" — the glyph is aria-hidden so screen readers, which
// already read the status word, don't announce a meaningless symbol.
function statusLabel(text) {
  const g = statusGlyph(text);
  const t = (text == null || text === '') ? '—' : String(text);
  return g ? '<span aria-hidden="true" style="opacity:.85">' + g + '</span> ' + t : t;
}
window.statusGlyph = statusGlyph; window.statusLabel = statusLabel;

/* ── BCB baselines (BCB0 … BCB2) ──────────────────────────────────────────
   A project's budget is re-baselined over time, so the SAME work package can
   show savings against BCB0 and a loss against BCB1. Each baseline is stored in
   its own column (`budget_bcb0…2`); `approved_budget_bcb` holds the CURRENT
   one, which is what every chart/KPI/table/export already reads.
   Rather than thread a baseline argument through ~110 read sites, the switcher
   re-maps `approved_budget_bcb` on the loaded array (`applyBcbBaseline`) and the
   whole dashboard re-renders against it unchanged. */
const BCB_LEVELS = ['bcb0','bcb1','bcb2'];
const BCB_LABELS = { bcb0:'BCB0', bcb1:'BCB1', bcb2:'BCB2' };

// The figure explicitly recorded AT this baseline (BCB0 falls back to the single
// legacy budget column, so data imported before baselines existed still reads).
function bcbValue(w, level) {
  if (!w) return null;
  const v = w['budget_' + level];
  if (v != null) return v;
  return (level === 'bcb0') ? (w.approved_budget_bcb ?? null) : null;
}
// The budget IN FORCE at a baseline: that baseline's figure, else carry forward the
// newest earlier one — a WP whose budget didn't change at BCB2 still has its BCB1 value.
function bcbEffective(w, level) {
  const i = BCB_LEVELS.indexOf(level);
  if (i < 0) return w?.approved_budget_bcb ?? null;
  for (let j = i; j >= 0; j--) { const v = bcbValue(w, BCB_LEVELS[j]); if (v != null) return v; }
  return w?.approved_budget_bcb ?? null;
}
// Which baselines actually carry data — drives the switcher. A project may have NO BCB0:
// QHL706's monitoring sheet heads its budget "BUDGET 1 - BCB1 (VAT EX)", so every WP lands
// in budget_bcb1 and there is no original baseline to show. Offering an empty BCB0 tab
// there would display BCB1's own figures under a BCB0 label — so only populated levels
// are offered. Rows imported before baselines existed have none populated; BCB0 then
// stands for the single stored budget.
function bcbLevelsPresent(wps) {
  const out = {};
  BCB_LEVELS.forEach(l => { out[l] = (wps||[]).some(w => w['budget_'+l] != null); });
  if (!BCB_LEVELS.some(l => out[l])) out.bcb0 = true;
  return out;
}
// Lowest baseline that actually has data — the sensible default for this data set.
function bcbDefaultLevel(wps) {
  const p = bcbLevelsPresent(wps);
  return BCB_LEVELS.find(l => p[l]) || 'bcb0';
}
// Return a copy of the WP list with approved_budget_bcb set to the chosen baseline.
function applyBcbBaseline(wps, level) {
  if (!level || !BCB_LEVELS.includes(level)) return wps || [];
  return (wps||[]).map(w => {
    const v = bcbEffective(w, level);
    return (v === w.approved_budget_bcb) ? w : { ...w, approved_budget_bcb: v };
  });
}
// Selected baseline, persisted per user. Defaults to BCB0 (the original budget).
const BcbBaseline = (() => {
  const key = () => 'wpm_bcb_' + ((window.__profile && window.__profile.id) || 'anon');
  function get() {
    try { const v = localStorage.getItem(key()); if (v && BCB_LEVELS.includes(v)) return v; } catch (_) {}
    return 'bcb0';
  }
  function set(v) { try { if (BCB_LEVELS.includes(v)) localStorage.setItem(key(), v); } catch (_) {} }
  function label(v) { return BCB_LABELS[v || get()] || 'BCB0'; }
  // The level to actually render for THIS data: the user's pick if that baseline has
  // data here, otherwise the lowest one that does (never an empty baseline).
  function resolve(wps) {
    const p = bcbLevelsPresent(wps), pref = get();
    return p[pref] ? pref : bcbDefaultLevel(wps);
  }
  return { get, set, label, resolve, LEVELS: BCB_LEVELS, LABELS: BCB_LABELS };
})();
window.BCB_LEVELS = BCB_LEVELS; window.BCB_LABELS = BCB_LABELS;
window.bcbValue = bcbValue; window.bcbEffective = bcbEffective;
window.bcbLevelsPresent = bcbLevelsPresent; window.bcbDefaultLevel = bcbDefaultLevel;
window.applyBcbBaseline = applyBcbBaseline;
window.BcbBaseline = BcbBaseline;

/* ── Formatting ─────────────────────────────────────────────────────── */
// HTML-escape user-entered text before it goes into innerHTML. WP fields (description,
// remarks, vendor, wp_no…) and self-registered user name/email are attacker-controllable
// (a contributor can PATCH a WP, a pending registrant sets their own name) — without this,
// a payload like <img src=x onerror=…> stored in a field runs in an ADMIN's session when
// they open the list, exfiltrating the Supabase JWT from localStorage → account takeover.
// Escapes the 5 HTML-significant chars so the value is inert as text AND in a quoted attr.
// Returns '' for null/undefined so callers can keep `|| '—'` fallbacks.
window.esc = function (v) {
  return v == null ? '' : String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
};

const Fmt = {
  money(v, decimals=2) {
    if (v==null||isNaN(v)) return '\u2014';
    const a=Math.abs(v);
    // Auto-scale so billions read as B (\u20B11.50B) instead of an ambiguous \u20B11500.00M
    if (a>=1e9) return '\u20B1'+(a/1e9).toFixed(decimals)+'B';
    return '\u20B1'+(a/1e6).toFixed(decimals)+'M';
  },
  moneyFull(v) {
    if (v==null||isNaN(v)) return '\u2014';
    return '\u20B1'+Math.round(Math.abs(v)).toLocaleString('en-US');
  },
  // Compact headline figure: auto-scales to B / M, else full. Sign is dropped
  // (callers prepend +/-); pair with moneyFull(v) in a title for the exact value.
  moneyShort(v) {
    if (v==null||isNaN(v)) return '\u2014';
    const a=Math.abs(v);
    if (a>=1e9) return '\u20B1'+(a/1e9).toFixed(2)+'B';
    if (a>=1e6) return '\u20B1'+(a/1e6).toFixed(2)+'M';
    return '\u20B1'+Math.round(a).toLocaleString('en-US');
  },
  date(d) {
    if (!d) return '\u2014';
    try { return new Date(d).toLocaleDateString('en-US',{month:'short',day:'2-digit',year:'numeric'}); }
    catch { return d; }
  }
};

const Calc = {
  variance(w) { return (w.approved_budget_bcb??0)-(w.total_awarded??0); }
};

/* ── CSV Export ─────────────────────────────────────────────────────── */
function exportCSV(wps, label) {
  // Sort by project then WP number for clean consolidated output
  const sorted = [...wps].sort((a,b) => {
    const pCmp = (a.project_id||'').localeCompare(b.project_id||'');
    if (pCmp !== 0) return pCmp;
    // Natural sort WP numbers (WP-1 < WP-10 < WP-100)
    const na = parseInt((a.wp_no||'').replace(/\D/g,''))||0;
    const nb = parseInt((b.wp_no||'').replace(/\D/g,''))||0;
    return na - nb;
  });

  const h = [
    // Identity
    'Project','WP No','Cost Code','Trade','Works','Type of Works','Zone',
    // Description
    'Work Package Description','Scope of Work','Type of Service',
    'Type of Procurement','Type of Contract',
    // Charging
    'Charging Type','Contract Package No.','CO Description',
    // Vendors & PO
    'Proposed Vendors','No. of PO/JO','PO/JO Numbers',
    // Team
    'Responsible Team','Approver','Support Team',
    // Procurement schedule
    'Lead Time (d)','Planned Award Date','Actual Award Date',
    'Target Delivery','Actual Delivery','Target Installation','Target Completion',
    // Budget & contract
    'Budget BCB (PHP)','Contract Amount (PHP)','Total Awarded (PHP)','Variance (PHP)',
    'Award Status','Contractor',
    // Bonds
    'Surety Bond','Performance Bond','Warranty Bond',
    // Payment terms
    'Payment Terms (d)','DP %','DP Terms','DP Amount (PHP)','DP Release Date','DP Notes',
    // Retention
    'Retention %','Retention Amount (PHP)','Retention Period',
    // Submittals
    'Requires Submittal Approval','Type of Submittal','Submittal Approver','Approval Date',
    // Status
    'Procurement Status','Awarding Status','Delivery Status','Submittal Status',
    'Purchase Request','Remarks',
  ];

  const pct = v => v != null ? (parseFloat(v) * 100).toFixed(2) + '%' : '';
  const cell = v => `"${(v??'').toString().replace(/"/g,'""')}"`;
  const rows = sorted.map(w => [
    // Identity
    w.project_id, w.wp_no, w.cost_code, w.trade, w.works, w.type_of_works, w.zone,
    // Description
    w.description, w.scope, w.type_of_service,
    w.type_of_procurement, w.type_of_contract,
    // Charging
    w.charging_type, w.contract_package_no, w.co_description,
    // Vendors & PO
    w.proposed_vendors, w.po_jo_count, w.po_jo_numbers,
    // Team
    w.responsible_team, w.approver, w.support_team,
    // Procurement schedule
    w.awarding_lead_time, w.awarding_date, w.actual_awarding_date,
    w.target_delivery, w.actual_delivery, w.target_installation, w.target_completion,
    // Budget & contract
    w.approved_budget_bcb, w.awarded_cost, w.total_awarded, w.variance,
    w.award_status, w.contractor,
    // Bonds
    w.surety_bond, w.performance_bond, w.warranty_bond,
    // Payment terms
    w.payment_terms_days, pct(w.dp_percent), w.dp_terms, w.dp_amount, w.dp_release_date, w.dp_notes,
    // Retention
    pct(w.retention_percent), w.retention_amount, w.retention_period,
    // Submittals
    w.requires_approval ? 'Yes' : 'No', w.submittal_document_type, w.approver_name, w.approval_date,
    // Status
    w.procurement_status, w.awarding_status, w.delivery_status, w.submittal_type,
    w.purchase_request, w.remarks,
  ].map(cell).join(','));

  // BOM + header + data — BOM ensures Excel opens UTF-8 correctly (handles ₱ etc)
  const BOM = '\uFEFF';
  const csv = BOM + [h.join(','), ...rows].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${label||'wps'}_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/* ── KPI help — plain-English definitions shown as hover tooltips on metric labels ── */
window.KPI_HELP = {
  'Procurement Budget (BCB)':'Total approved procurement budget (Base Cost Budget, net) across these work packages.',
  'Actual Award':'Total awarded cost of the WPs already awarded — the sum of their contract amounts.',
  'Balance to Award':'Budget still to be committed = Total Budget − budget of the awarded WPs. The sub-line shows how many WPs remain.',
  'Savings / Loss':'Budget for the awarded WPs minus what they were actually awarded for. Green = savings, red = over budget.',
  'Procurement Cost to Complete':'Budget remaining to award = Total Budget − budget of the awarded WPs.',
  'Cost to Complete':'Budget remaining to award = Total Budget − budget of the awarded WPs.',
  'Procurement Estimate at Completion':'Projected total spend = awarded cost so far + budget of the not-yet-awarded WPs.',
  'Estimate at Completion':'Projected total spend = awarded cost so far + budget of the not-yet-awarded WPs.',
  'Variance':'Total Budget − Estimate at Completion. Positive = under budget, negative = over budget.'
};
// Returns the ` title="…" style="cursor:help"` attributes for a KPI label (empty if no help defined).
// KPI label help. A bare `title` is invisible on touch (no hover) and is never
// announced reliably, so the label also gets: an aria-label (screen readers),
// tabindex (keyboard reachable) and a `data-tip` the Tooltip helper in ui.js shows
// on tap/focus. The dotted underline signals that help exists at all.
window.kpiLabelAttrs = function(lbl){
  const h=(window.KPI_HELP||{})[lbl];
  if(!h) return '';
  const esc=String(h).replace(/"/g,'&quot;');
  return ' title="'+esc+'" data-tip="'+esc+'" tabindex="0" role="button"'
       + ' aria-label="'+String(lbl).replace(/"/g,'&quot;')+' — what is this? '+esc+'"'
       + ' class="has-tip"';
};

/* ── User bar — avatar only, role in dropdown ───────────────────────── */
function renderUserBar(id, profile) {
  const el = document.getElementById(id);
  if (!el || !profile) return;
  const initials = (profile.name||profile.email||'U').split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();
  const dark = typeof AppTheme !== 'undefined' && AppTheme.isDark(profile.id);
  // Export PDF / Export Excel move into this dropdown ON MOBILE ONLY (class hidden ≥768px in
  // dashboard.css) — the topbar hides those two buttons on mobile (too many icons crowded the
  // page title, see Known Issues), so this is the only way to reach them there. Detected by
  // presence in the DOM, so it works on whichever page loaded (project.html has both; index.html
  // has PDF only) with no per-page code. `.click()` on the real (hidden) button reuses its exact
  // handler — including its own `__hideBudget` viewer guard — so nothing needs duplicating.
  // Still gated here too so a viewer never sees a menu entry that would silently no-op.
  const exportItems = window.__hideBudget ? '' : ['btn-export-xlsx','btn-export'].map(bid => {
    if (!document.getElementById(bid)) return '';
    const label = bid === 'btn-export-xlsx' ? 'Export Excel' : 'Export PDF';
    const icon  = bid === 'btn-export-xlsx' ? 'ti-file-type-xls' : 'ti-file-type-pdf';
    return `<a class="user-menu-mobile-only" onclick="event.preventDefault();(function(){var m=document.getElementById('user-menu');if(m)m.style.display='none';var b=document.getElementById('${bid}');if(b)b.click();})()" style="
            display:flex;align-items:center;gap:8px;padding:12px 16px;
            font-size:0.9286rem;color:#231F20;font-weight:600;text-decoration:none;
            font-family:inherit;cursor:pointer;border-bottom:1px solid #f5f5f5;">
            <i class="ti ${icon}" style="font-size:1.1429rem;color:#888"></i>${label}
          </a>`;
  }).join('');
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:6px">
      <button id="theme-toggle-btn" class="theme-toggle"
        onclick="AppTheme.toggle('${profile.id}')"
        title="${dark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}">
        <i class="ti ${dark ? 'ti-sun' : 'ti-moon-stars'}" style="font-size:1.2143rem;line-height:1"></i>
      </button>
      <div style="position:relative">
        <button id="avatar-btn" onclick="toggleUserMenu()" title="${esc(profile.name||profile.email)}" style="
          width:36px;height:36px;border-radius:50%;background:#EE3124;color:#fff;
          border:none;cursor:pointer;font-size:0.9286rem;font-weight:700;font-family:inherit;
          display:flex;align-items:center;justify-content:center;flex-shrink:0;">${initials}</button>
        <div id="user-menu" style="
          display:none;position:absolute;right:0;top:44px;
          background:#fff;border:1px solid #f0f0f0;border-radius:12px;
          box-shadow:0 8px 32px rgba(0,0,0,.12);width:220px;z-index:9999;overflow:hidden;">
          <div style="padding:14px 16px;border-bottom:1px solid #f5f5f5;">
            <div style="font-size:0.9286rem;font-weight:600;color:#231F20">${esc(profile.name||profile.email)}</div>
            <div style="font-size:0.7857rem;color:#888;margin-top:2px;text-transform:capitalize">${(profile.role||'').replace(/_/g,' ')}</div>
          </div>
          ${exportItems}
          <a onclick="event.preventDefault();(function(){var m=document.getElementById('user-menu');if(m)m.style.display='none';if(window.CoachTour&&CoachTour.available()){CoachTour.start(true);}else if(window.Onboarding&&Onboarding.open){Onboarding.open();}else{window.location.href='onboarding.html';}})()" style="
            display:flex;align-items:center;gap:8px;padding:12px 16px;
            font-size:0.9286rem;color:#231F20;font-weight:600;text-decoration:none;
            font-family:inherit;cursor:pointer;border-bottom:1px solid #f5f5f5;">
            <i class="ti ti-route" style="font-size:1.1429rem;color:#888"></i>Restart tour
          </a>
          <a href="login.html" onclick="event.preventDefault();AppAuth.logout()" style="
            display:flex;align-items:center;gap:8px;padding:12px 16px;
            font-size:0.9286rem;color:#EE3124;font-weight:600;text-decoration:none;
            font-family:inherit;cursor:pointer;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>Sign out
          </a>
        </div>
      </div>
    </div>`;
}
window.toggleUserMenu = function() {
  const m = document.getElementById('user-menu');
  if (m) m.style.display = m.style.display==='none' ? 'block' : 'none';
};
document.addEventListener('click', function(e) {
  const btn = document.getElementById('avatar-btn');
  const menu = document.getElementById('user-menu');
  if (menu && btn && !btn.contains(e.target) && !menu.contains(e.target))
    menu.style.display = 'none';
});

/* ── Metrics & Rank helpers ─────────────────────────────────────────── */
function buildMetrics(containerId, items) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = items.map(c=>`
    <div class="metric-card ${c.accent?'metric-accent-'+c.accent:''}">
      <div class="metric-label">${c.lbl}</div>
      <div class="metric-value ${c.cls||''}">${c.val}</div>
      ${c.sub?`<div class="metric-sub">${c.sub}</div>`:''}
    </div>`).join('');
}

function buildRankTable(id, items, type) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!items.length) { el.innerHTML='<div style="color:#aaa;font-size:0.8571rem;padding:10px 0">No data</div>'; return; }

  if (!document.getElementById('_rankTblStyle')) {
    const s = document.createElement('style');
    s.id = '_rankTblStyle';
    s.textContent = [
      // All 5 rows always visible. The value columns (BCB/Award/…) keep their width (nowrap); the
      // WP-NAME column TRUNCATES with an ellipsis so long names can never push the value columns off
      // the card (the classic max-width:0 + overflow:hidden trick in a width:100% table). Full name
      // is in the cell's title tooltip and one click away in the detail panel. Mobile-safe: no scroll.
      '.rank-row{cursor:default}',
      // Full names on one line. In the default 3-up view a cramped card scrolls left↔right; to read
      // the whole table at a glance, click the card title to EXPAND the card to full width (accordion
      // in ui.js — initTop5Accordion).
      '.rank-table-scroll{overflow-x:auto;overflow-y:visible;-webkit-overflow-scrolling:touch}',
      '.rank-table-scroll table{min-width:100%}',
      '.rank-short,.rank-sub{white-space:nowrap}',
    ].join('');
    document.head.appendChild(s);
  }

  const isValue  = type === 'value';
  const accent   = type === 'savings' ? '#2D9B6F' : '#EE3124';
  const valLabel = type === 'savings' ? 'Savings' : type === 'loss' ? 'Overbudget' : 'Budget';
  const valSign  = type === 'savings' ? '+' : type === 'loss' ? '-' : '';
  // Right-aligned headers use the SAME 8px horizontal padding as their value cells so they line up.
  const th = (txt, right, color) =>
    `<th style="font-size:0.5714rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:${color||'#777'};padding:7px 8px 7px ${right?'8px':'0'};text-align:${right?'right':'left'};border-bottom:2px solid #ebebeb;white-space:nowrap">${txt}</th>`;
  const valueAccent = '#231F20';
  const thead = isValue
    ? `<tr>${th('#&nbsp;&nbsp;Work Package',false)} ${th(valLabel,true)} ${th('Award',true)} ${th('%',true,valueAccent)} ${th('%WT',true,valueAccent)}</tr>`
    : `<tr>${th('#&nbsp;&nbsp;Work Package',false)} ${th('BCB',true)} ${th('Award',true)} ${th(valLabel,true,accent)} ${th('%',true,accent)} ${th('%WT',true,accent)}</tr>`;
  const rows = items.map((item, i) => {
    const safe = esc(item.name);  // data-rn attribute (used by search filter)
    // Clicking a row opens the WP detail slide-in panel (full details + Edit/Delete)
    const click = item.id ? ` onclick="if(window.openWPDetail)openWPDetail('${item.id}')"` : '';
    const cursor = item.id ? 'cursor:pointer;' : '';
    const wpCell = `<td style="padding:9px 8px 9px 0;vertical-align:top">
      <div style="display:flex;align-items:flex-start;gap:6px">
        <span style="font-size:0.7143rem;color:#999;font-weight:700;flex-shrink:0;min-width:14px;padding-top:1px">${i+1}</span>
        <div>
          <div class="rank-short" title="${esc(item.name)}" style="font-size:0.7857rem;font-weight:600;color:#231F20;line-height:1.35;white-space:nowrap">${esc(item.name)}</div>
          <div class="rank-sub" style="font-size:0.6429rem;color:#888;margin-top:1px;white-space:nowrap">${esc(item.sub)||''}</div>
        </div>
      </div>
    </td>`;
    if (isValue) {
      return `<tr class="rank-row" data-rn="${safe}"${click} style="${cursor}border-bottom:1px solid #f5f5f5">${wpCell}
        <td class="rank-side" style="font-size:0.8571rem;font-weight:700;color:#231F20;padding:9px 8px;text-align:right;vertical-align:middle;white-space:nowrap">${Fmt.money(item.val)}</td>
        <td class="rank-side" style="font-size:0.7143rem;color:#777;font-weight:500;padding:9px 8px;text-align:right;vertical-align:middle;white-space:nowrap">${Fmt.money(item.awarded)}</td>
        <td class="rank-side" style="font-size:0.7857rem;font-weight:600;color:${valueAccent};padding:9px 8px;text-align:right;vertical-align:middle;white-space:nowrap" title="Awarded Cost ÷ Budget (BCB)">${item.pct!=null?item.pct:'—'}</td>
        <td class="rank-side" style="font-size:0.7857rem;font-weight:600;color:${valueAccent};padding:9px 8px;text-align:right;vertical-align:middle;white-space:nowrap" title="Budget (BCB) ÷ Total BCB">${item.wt!=null?item.wt:'—'}</td>
      </tr>`;
    }
    return `<tr class="rank-row" data-rn="${safe}"${click} style="${cursor}border-bottom:1px solid #f5f5f5">${wpCell}
      <td class="rank-side" style="font-size:0.7143rem;color:#888;font-weight:500;padding:9px 8px;text-align:right;vertical-align:middle;white-space:nowrap">${Fmt.money(item.bcb)}</td>
      <td class="rank-side" style="font-size:0.7143rem;color:#777;font-weight:500;padding:9px 8px;text-align:right;vertical-align:middle;white-space:nowrap">${Fmt.money(item.awarded)}</td>
      <td class="rank-side" style="font-size:0.8571rem;font-weight:700;color:${accent};padding:9px 8px;text-align:right;vertical-align:middle;white-space:nowrap">${valSign}${Fmt.money(item.val)}</td>
      <td class="rank-side" style="font-size:0.7857rem;font-weight:600;color:${accent};padding:9px 8px;text-align:right;vertical-align:middle;white-space:nowrap">${item.pct}</td>
      <td class="rank-side" style="font-size:0.7857rem;font-weight:600;color:${accent};padding:9px 8px;text-align:right;vertical-align:middle;white-space:nowrap" title="Savings ÷ Total BCB">${item.wt!=null?item.wt:'—'}</td>
    </tr>`;
  }).join('');
  el.innerHTML = `<div class="rank-table-scroll"><table style="width:100%;border-collapse:collapse;font-family:inherit"><thead>${thead}</thead><tbody>${rows}</tbody></table></div>`;
}

function buildRankList(id, items, colorClass, fmtVal) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!items.length) { el.innerHTML='<div style="color:#aaa;font-size:0.8571rem;padding:8px 0">No data</div>'; return; }
  el.innerHTML = items.map((item,i) => {
    const hasBcbAwd = item.bcb!=null && item.awarded!=null;
    return `<div style="display:flex;align-items:flex-start;gap:10px;padding:9px 0;border-bottom:1px solid #f5f5f5">
      <span style="font-size:0.7857rem;color:#aaa;font-weight:600;width:16px;flex-shrink:0;padding-top:2px">${i+1}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:0.8571rem;font-weight:600;color:#231F20;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(item.name)}</div>
        <div style="font-size:0.7143rem;color:#999;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${item.sub}</div>
        ${hasBcbAwd?`<div style="font-size:0.7143rem;color:#bbb;margin-top:1px;white-space:nowrap">BCB ${Fmt.money(item.bcb)} <span style="color:#ddd">→</span> Awd ${Fmt.money(item.awarded)}</div>`:''}
      </div>
      <div style="text-align:right;flex-shrink:0;padding-top:2px">
        <div style="font-size:0.9286rem;font-weight:700;color:${item.color};white-space:nowrap">${fmtVal(item.val)}</div>
        ${item.pct!=null?`<div style="font-size:0.7143rem;font-weight:600;color:${item.color};white-space:nowrap">${item.pct}</div>`:''}
      </div>
    </div>`;
  }).join('');
}

/* ── PDF Export (jsPDF + AutoTable, lazy-loaded) ──────────────────────── */
async function _loadPDFLibs() {
  if (window.jspdf) return;
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js';
    s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}

async function exportPDF(wps, label, titleStr) {
  await _loadPDFLibs();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pgW = doc.internal.pageSize.getWidth();
  const pgH = doc.internal.pageSize.getHeight();
  const mg  = 14;
  const today = new Date();
  const dateStr = today.toLocaleDateString('en-PH', { year:'numeric', month:'long', day:'numeric' });
  const multiProject = new Set((wps||[]).map(w=>w.project_id).filter(Boolean)).size > 1;

  // ── Computed stats ──
  const awarded    = wps.filter(w=>window.isResolved(w)).length;
  const totalBCB   = wps.reduce((s,w)=>s+(w.approved_budget_bcb||0),0);
  const totalAwd   = wps.reduce((s,w)=>s+(w.total_awarded||0),0);
  const variance   = totalBCB - totalAwd;
  const awardRate  = wps.length ? Math.round(awarded/wps.length*100) : 0;
  const fmtM = v => v != null ? (v>=0?'+':'-')+((Math.abs(v))/1e6).toFixed(2)+'M' : '-';
  const fmtV = v => v != null ? ((v)/1e6).toFixed(2)+'M' : '-';
  const fmtDate = d => d ? new Date(d).toLocaleDateString('en-US',{month:'short',day:'2-digit',year:'numeric'}) : '-';

  // ── Page header (drawn before table content via willDrawPage) ──
  const drawHeader = (pgNum) => {
    doc.setFontSize(13); doc.setFont('helvetica','bold'); doc.setTextColor(35,31,32);
    doc.text('MEGAWIDE CONSTRUCTION CORPORATION', mg, 14);
    doc.setFontSize(8.5); doc.setFont('helvetica','normal'); doc.setTextColor(110,110,110);
    doc.text('EPC Procurement · Work Package Management System', mg, 20);
    doc.setFontSize(10); doc.setFont('helvetica','bold'); doc.setTextColor(35,31,32);
    doc.text(`Work Package Summary${titleStr ? ' — '+titleStr : ''}`, mg, 27);
    doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(130);
    doc.text(`Generated: ${dateStr}   |   Total WPs: ${wps.length}   |   Awarded: ${awarded} (${awardRate}%)   |   BCB: ${fmtV(totalBCB)}   |   Variance: ${fmtM(variance)}`, mg, 33);
    doc.setDrawColor(238,49,36); doc.setLineWidth(0.6);
    doc.line(mg, 36, pgW - mg, 36);
    if (pgNum === 1) {
      doc.setFontSize(7); doc.setFont('helvetica','italic'); doc.setTextColor(160);
      doc.text('All monetary values in PHP Millions (M). Variance = BCB - Awarded (positive = under budget).', mg, 39);
    }
  };

  // ── Footer: page number on all pages; signatures only on last page ──
  const sigH = 30;
  const drawPageNum = (pageNum, totalPages) => {
    const fy = pgH - sigH;
    doc.setFontSize(7); doc.setFont('helvetica','normal'); doc.setTextColor(160);
    doc.text(`Page ${pageNum} of ${totalPages}`, pgW - mg, fy + 5.5, { align:'right' });
  };
  const drawSignatures = () => {
    const fy = pgH - sigH;
    doc.setDrawColor(210,210,210); doc.setLineWidth(0.3);
    doc.line(mg, fy, pgW - mg, fy);
    const bW = (pgW - mg*2 - 16) / 3;
    ['Prepared by','Confirmed by','Approved by'].forEach((lbl, i) => {
      const bx = mg + i * (bW + 8);
      doc.setFontSize(7.5); doc.setFont('helvetica','bold'); doc.setTextColor(80);
      doc.text(lbl+':', bx, fy + 5.5);
      doc.setDrawColor(160); doc.setLineWidth(0.4);
      doc.line(bx, fy + 15, bx + bW - 4, fy + 15);
      doc.setFontSize(6.5); doc.setFont('helvetica','normal'); doc.setTextColor(140);
      doc.text('Name & Signature over Printed Name', bx, fy + 19);
      doc.text('Date: _________________________', bx, fy + 24.5);
    });
  };

  // ── Table data ──
  const sorted = [...wps].sort((a,b) => {
    const pc = (a.project_id||'').localeCompare(b.project_id||'');
    if (pc!==0) return pc;
    return (parseInt((a.wp_no||'').replace(/\D/g,''))||0) - (parseInt((b.wp_no||'').replace(/\D/g,''))||0);
  });

  const baseCols = [
    ...(multiProject ? [{ header:'Project', dataKey:'project_id' }] : []),
    { header:'WP No.', dataKey:'wp_no' },
    { header:'Trade', dataKey:'trade' },
    { header:'Works', dataKey:'works' },
    { header:'Description', dataKey:'description' },
    { header:'BCB (M)', dataKey:'bcb' },
    { header:'Awarded (M)', dataKey:'awarded' },
    { header:'Variance (M)', dataKey:'var' },
    { header:'Award Status', dataKey:'award_status' },
    { header:'Contractor', dataKey:'contractor' },
    { header:'Planned Award', dataKey:'plan_date' },
    { header:'Actual Award', dataKey:'act_date' },
    { header:'Proc. Status', dataKey:'proc_status' },
  ];

  // Available width = pgW - mg*2; column widths tuned to exactly fit (single + multi-project)
  const avail = pgW - mg * 2;
  const fmtMM = v => v != null ? ((v)/1e6).toFixed(2) : '-';
  const tableRows = sorted.map(w => {
    const v = (w.approved_budget_bcb||0) - (w.total_awarded||0);
    return {
      project_id: w.project_id||'-',
      wp_no: w.wp_no||'-',
      trade: w.trade||'-',
      works: w.works||'-',
      description: w.description||'-',
      bcb: fmtMM(w.approved_budget_bcb),
      awarded: w.total_awarded ? fmtMM(w.total_awarded) : '-',
      var: w.approved_budget_bcb ? (v>=0?'+':'')+fmtMM(v) : '-',
      award_status: w.award_status||'-',
      contractor: w.contractor||'-',
      plan_date: fmtDate(w.awarding_date),
      act_date: fmtDate(w.actual_awarding_date),
      proc_status: w.procurement_status||'-',
    };
  });

  doc.autoTable({
    columns: baseCols,
    body: tableRows,
    startY: 43,
    tableWidth: avail,
    margin: { top: 43, left:mg, right:mg, bottom: sigH + 6 },
    theme: 'grid',
    headStyles: { fillColor:[35,31,32], textColor:[255,255,255], fontSize:6.5, fontStyle:'bold', halign:'center', cellPadding:2, minCellHeight:8 },
    bodyStyles: { fontSize:6.5, cellPadding:[2,2,2,2], textColor:[50,50,50], minCellHeight:7 },
    alternateRowStyles: { fillColor:[250,250,250] },
    styles: { overflow:'linebreak', lineColor:[220,220,220], lineWidth:0.2 },
    columnStyles: {
      project_id:  { halign:'center', cellWidth: multiProject ? 16 : 0 },
      wp_no:       { halign:'center', cellWidth:12 },
      trade:       { cellWidth:22 },
      works:       { cellWidth:20 },
      description: { cellWidth: multiProject ? 42 : 48 },
      bcb:         { halign:'right',  cellWidth:15 },
      awarded:     { halign:'right',  cellWidth:15 },
      var:         { halign:'right',  cellWidth:15 },
      award_status:{ halign:'center', cellWidth:19 },
      contractor:  { cellWidth:25 },
      plan_date:   { halign:'center', cellWidth:18 },
      act_date:    { halign:'center', cellWidth:18 },
      proc_status: { halign:'center', cellWidth:18 },
    },
    willDrawPage: (data) => {
      drawHeader(data.pageNumber);
    },
  });

  // Draw page numbers and signatures now that we know total pages
  const totalPg = doc.getNumberOfPages();
  for (let i = 1; i <= totalPg; i++) {
    doc.setPage(i);
    drawPageNum(i, totalPg);
    if (i === totalPg) drawSignatures();
  }

  doc.save(`WPM_${label}_${new Date().toISOString().slice(0,10)}.pdf`);
}

function updatePendingBadge() {
  WPDb.getPendingWPs().then(wps=>{
    const badge=document.getElementById('review-badge');
    if (badge) { badge.textContent=wps.length; badge.style.display=wps.length>0?'inline-block':'none'; }
  }).catch(()=>{});
}

/* ── Global New Project Modal (overridden by admin.html's own version) ── */
(function() {
  let _gnpUsers = [];

  function _gnpGetOrCreate() {
    let m = document.getElementById('gnp-global-modal');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'gnp-global-modal';
    m.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:3000;align-items:center;justify-content:center;padding:16px';
    m.innerHTML = `
      <div style="background:#fff;border-radius:12px;width:100%;max-width:460px;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.2)">
        <div style="padding:20px 20px 0;flex-shrink:0">
          <div style="font-size:1.1429rem;font-weight:700;color:#231F20;margin-bottom:4px">New Project</div>
          <div style="font-size:0.9286rem;color:#888;margin-bottom:16px">Create a new EPC project and assign users</div>
        </div>
        <div style="padding:0 20px 16px;overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:14px">
          <div>
            <div style="font-size:0.7857rem;font-weight:600;letter-spacing:.06em;color:#888;text-transform:uppercase;margin-bottom:8px">Project Code * <span style="font-size:0.6429rem;font-weight:400;text-transform:none">(letters/numbers only, e.g. AVR102)</span></div>
            <input id="gnp-id" type="text" placeholder="e.g. AVR102" oninput="this.value=this.value.toUpperCase().replace(/[^A-Z0-9]/g,'')"
              style="width:100%;padding:10px 12px;border:1.5px solid #e5e5e5;border-radius:8px;font-size:1rem;font-family:inherit;outline:none;box-sizing:border-box">
          </div>
          <div>
            <div style="font-size:0.7857rem;font-weight:600;letter-spacing:.06em;color:#888;text-transform:uppercase;margin-bottom:8px">Project Name *</div>
            <input id="gnp-name" type="text" placeholder="e.g. Avesta Residences Tower 2"
              style="width:100%;padding:10px 12px;border:1.5px solid #e5e5e5;border-radius:8px;font-size:1rem;font-family:inherit;outline:none;box-sizing:border-box">
          </div>
          <div>
            <div style="font-size:0.7857rem;font-weight:600;letter-spacing:.06em;color:#888;text-transform:uppercase;margin-bottom:8px">Location</div>
            <input id="gnp-location" type="text" placeholder="e.g. Quezon City"
              style="width:100%;padding:10px 12px;border:1.5px solid #e5e5e5;border-radius:8px;font-size:1rem;font-family:inherit;outline:none;box-sizing:border-box">
          </div>
          <div>
            <div style="font-size:0.7857rem;font-weight:600;letter-spacing:.06em;color:#888;text-transform:uppercase;margin-bottom:8px">Description</div>
            <input id="gnp-description" type="text" placeholder="Optional project description"
              style="width:100%;padding:10px 12px;border:1.5px solid #e5e5e5;border-radius:8px;font-size:1rem;font-family:inherit;outline:none;box-sizing:border-box">
          </div>
          <div>
            <div style="font-size:0.7857rem;font-weight:600;letter-spacing:.06em;color:#888;text-transform:uppercase;margin-bottom:8px">Assign Users (optional)</div>
            <div id="gnp-user-list"><div style="color:#aaa;font-size:0.8571rem">Loading…</div></div>
          </div>
          <div id="gnp-error" style="display:none;background:#FEE2E2;color:#991B1B;border-radius:8px;padding:10px 12px;font-size:0.9286rem"></div>
        </div>
        <div style="padding:12px 20px 20px;flex-shrink:0;border-top:1px solid #f0f0f0;display:flex;gap:10px">
          <button onclick="window._gnpConfirm()" id="gnp-create-btn"
            style="flex:1;padding:10px;background:#EE3124;color:#fff;border:none;border-radius:8px;font-size:1rem;font-weight:600;font-family:inherit;cursor:pointer">
            <i class="ti ti-plus" style="font-size:1rem;margin-right:4px;vertical-align:middle"></i> Create Project
          </button>
          <button onclick="window._gnpClose()"
            style="padding:10px 16px;background:transparent;color:#666;border:1px solid #e5e5e5;border-radius:8px;font-size:1rem;font-family:inherit;cursor:pointer">Cancel</button>
        </div>
      </div>`;
    m.addEventListener('click', e => { if(e.target===m) window._gnpClose(); });
    document.body.appendChild(m);
    return m;
  }

  window._gnpClose = function() {
    const m = document.getElementById('gnp-global-modal');
    if (m) m.style.display = 'none';
    ['gnp-id','gnp-name','gnp-location','gnp-description'].forEach(id=>{
      const el=document.getElementById(id); if(el) el.value='';
    });
    const err=document.getElementById('gnp-error'); if(err) err.style.display='none';
  };

  window._gnpConfirm = async function() {
    const v = id => (document.getElementById(id)?.value||'').trim();
    const id = v('gnp-id'), name = v('gnp-name');
    const errEl = document.getElementById('gnp-error');
    if (!id||!name) { errEl.textContent='Project Code and Name are required.'; errEl.style.display='block'; return; }
    if (!/^[A-Z0-9]+$/.test(id)) { errEl.textContent='Project Code must be letters/numbers only (e.g. AVR102).'; errEl.style.display='block'; return; }
    const selectedUsers = [...document.querySelectorAll('#gnp-user-rows input:checked')].map(cb=>cb.value);
    const btn = document.getElementById('gnp-create-btn');
    btn.textContent='Creating…'; btn.disabled=true; errEl.style.display='none';
    try {
      // budget_bcb is intentionally omitted — a project's BCB is the sum of its work packages' BCB (computed)
      await WPDb.createProject({id, name, location:v('gnp-location'), description:v('gnp-description'), status:'active'});
      for (const uid of selectedUsers) {
        const user = _gnpUsers.find(u=>u.id===uid);
        if (user) await WPDb.updateUser(uid, {projects:[...new Set([...(user.projects||[]),id])]});
      }
      window._gnpClose();
      const toast = document.createElement('div');
      toast.innerHTML=`<div style="position:fixed;bottom:24px;right:24px;background:#2D9B6F;color:#fff;padding:14px 20px;border-radius:12px;font-size:1rem;font-weight:600;box-shadow:0 4px 20px rgba(0,0,0,.15);z-index:9999">✓ Project ${id} created</div>`;
      document.body.appendChild(toast); setTimeout(()=>toast.remove(),3000);
      if (typeof loadData==='function') setTimeout(loadData,500);
      if (typeof loadAll==='function') setTimeout(loadAll,500);
      if (typeof renderOverview==='function') setTimeout(renderOverview,600);
    } catch(err) {
      errEl.textContent=(err.message.includes('duplicate')||err.message.includes('unique'))
        ?`Project Code "${id}" already exists.`:'Error: '+err.message;
      errEl.style.display='block';
      const b=document.getElementById('gnp-create-btn'); b.innerHTML='<i class="ti ti-plus" style="font-size:1rem;margin-right:4px;vertical-align:middle"></i> Create Project'; b.disabled=false;
    }
  };

  window.openNewProjectModal = async function() {
    const modal = _gnpGetOrCreate();
    modal.style.display = 'flex';
    const list = document.getElementById('gnp-user-list');
    if (list) list.innerHTML = '<div style="color:#aaa;font-size:0.8571rem">Loading…</div>';
    try {
      _gnpUsers = await WPDb.getAllUsers();
      const approved = _gnpUsers.filter(u=>u.status==='approved');
      if (list) {
        list.innerHTML = `
          <div style="position:relative;margin-bottom:8px">
            <i class="ti ti-search" style="position:absolute;left:8px;top:50%;transform:translateY(-50%);color:#bbb;font-size:0.9286rem"></i>
            <input type="text" placeholder="Search users…" oninput="document.querySelectorAll('.gnpu-row').forEach(r=>r.style.display=r.textContent.toLowerCase().includes(this.value.toLowerCase())?'':'none')"
              style="width:100%;padding:6px 10px 6px 28px;border:1px solid #e5e5e5;border-radius:7px;font-size:0.8571rem;font-family:inherit;outline:none;box-sizing:border-box">
          </div>
          <div id="gnp-user-rows" style="display:flex;flex-direction:column;gap:5px;max-height:180px;overflow-y:auto">
            ${approved.length?approved.map(u=>`
              <div class="gnpu-row" style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid #e5e5e5;border-radius:8px;cursor:pointer" onclick="this.querySelector('input').click()">
                <input type="checkbox" value="${u.id}" onclick="event.stopPropagation()" style="width:16px;height:16px;accent-color:#EE3124;cursor:pointer">
                <label onclick="event.preventDefault()" style="cursor:pointer;font-size:0.9286rem;pointer-events:none">${esc(u.name||u.email)} <span style="font-size:0.7143rem;color:#aaa">(${(u.role||'user').replace(/_/g,' ')})</span></label>
              </div>`).join(''):'<div style="color:#aaa;font-size:0.8571rem">No approved users</div>'}
          </div>`;
      }
    } catch(e) {
      if (list) list.innerHTML = '<div style="color:#c00;font-size:0.8571rem">Could not load users.</div>';
    }
    document.getElementById('gnp-id')?.focus();
  };
})();

/* ──────────────────────────────────────────────────────────────────────────
   WPCsv — shared Work Package CSV import (used by wp-form.html & project.html)
   Header-name driven so the existing Work Package Monitoring layout imports
   directly. Falls back to position-based mapping for the native 54-col template
   and the legacy 25-col files. Handles quoted fields with embedded newlines
   (the cause of the "705 rows" bug) and Excel serial-number dates.
   ────────────────────────────────────────────────────────────────────────── */
window.WPCsv = (function(){
  'use strict';

  // RFC-4180-style tokenizer: respects quotes, "" escapes, and newlines inside quotes
  function parse(text){
    text = String(text || '').replace(/^﻿/, '');   // strip BOM
    const rows = []; let row = [], cur = '', inQ = false;
    for (let i = 0; i < text.length; i++){
      const ch = text[i];
      if (inQ){
        if (ch === '"'){ if (text[i+1] === '"'){ cur += '"'; i++; } else inQ = false; }
        else cur += ch;
      } else {
        if (ch === '"') inQ = true;
        else if (ch === ',') { row.push(cur); cur = ''; }
        else if (ch === '\r') { /* swallow — \n closes the row */ }
        else if (ch === '\n') { row.push(cur); cur = ''; rows.push(row); row = []; }
        else cur += ch;
      }
    }
    if (cur !== '' || row.length){ row.push(cur); rows.push(row); }
    // drop fully-blank rows (trailing newlines, spacer rows)
    return rows.filter(r => r.some(c => (c || '').trim() !== ''));
  }

  const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  // normalized-header → canonical field. Covers BOTH the WP-Monitoring adopted
  // layout and the native template. Generated columns (TOTAL, VARIANCE,
  // *LEAD TIME) are intentionally absent so they are skipped.
  const HMAP = {
    costcodeno:'cost_code', costcode:'cost_code',
    trade:'trade', tradediscipline:'trade',
    works:'works',
    typeofworks:'type_of_works',
    workpackageno:'wp_no', wpno:'wp_no', workpackagenumber:'wp_no',
    workpackagedescription:'description', workpackagedesc:'description',
    description:'detailed_description', detaileddescription:'detailed_description',
    detaileddescriptionscopeofwork:'detailed_description',
    scopeofwork:'scope', scope:'scope',
    zone:'zone',
    typeofservice:'type_of_service',
    typeofprocurement:'type_of_procurement',
    typeofcontract:'type_of_contract',
    chargingtype:'charging_type',
    contractpackageno:'contract_package_no',
    codescription:'co_description',
    proposedvendors:'proposed_vendors', proposedvendorssuppliers:'proposed_vendors',
    noofpojo:'po_jo_count',
    pojonos:'po_jo_numbers', pojonumbers:'po_jo_numbers',
    responsible:'responsible_team', responsibleteam:'responsible_team',
    approver:'approver',
    support:'support_team', supportteam:'support_team',
    surety:'surety_bond', suretybond:'surety_bond', suretybondyesno:'surety_bond',
    performance:'performance_bond', performancebond:'performance_bond', performancebondyesno:'performance_bond',
    warranty:'warranty_bond', warrantybond:'warranty_bond', warrantybondyesno:'warranty_bond',
    budgetbcbnet:'approved_budget_bcb', budgetbcb:'approved_budget_bcb',
    procurementbudgetbcbphp:'approved_budget_bcb', procurementbudgetbcb:'approved_budget_bcb',
    awardedcostnet:'awarded_cost', awardedcost:'awarded_cost',
    contractamountawardedphp:'awarded_cost', contractamountawarded:'awarded_cost', contractamount:'awarded_cost',
    additionals:'additionals',
    awarded:'award_status', awardstatus:'award_status',
    vendorcontractor:'contractor', contractor:'contractor', vendors:'contractor', vendor:'contractor',
    termsdays:'payment_terms_days', terms:'payment_terms_days', paymentterms:'payment_terms_days', paymenttermsdays:'payment_terms_days',
    ofdp:'dp_percent', dp:'dp_percent', downpayment:'dp_percent', downpaymentpct:'dp_percent', dppercent:'dp_percent',
    dpterms:'dp_terms',
    notes:'dp_notes', paymentnotes:'dp_notes',
    dateofrelease:'dp_release_date', dateofdprelease:'dp_release_date',
    dpamount:'dp_amount', dpamountphp:'dp_amount',
    retention:'retention_percent', retentionpct:'retention_percent', retentionpercent:'retention_percent',
    retentionamount:'retention_amount', retentionamountphp:'retention_amount',
    retentionperiod:'retention_period',
    reqdapproval:'requires_approval', requiressubmittalapproval:'requires_approval', requiresapproval:'requires_approval',
    reqdapprovalyesno:'requires_approval', requiressubmittalapprovalyesno:'requires_approval',
    nameofapprover:'approver_name', submittalsapprovername:'approver_name',
    dateofapproval:'approval_date',
    typeofsubmittal:'submittal_type', submittalstatus:'submittal_type',
    submittaldocumenttype:'submittal_document_type',
    leadtimedays:'lead_time', leadtime:'lead_time',
    awardingdate:'awarding_date', plannedawarddate:'awarding_date',
    actualawardingdate:'actual_awarding_date', actualawarddate:'actual_awarding_date',
    targetdeliverydate:'target_delivery', targetdelivery:'target_delivery',
    actualdeliverydate:'actual_delivery',
    targetinstndate:'target_installation', targetinstallationdate:'target_installation',
    targetcompndate:'target_completion', targetcompletiondate:'target_completion',
    remarks:'remarks',
    awardingstatus:'awarding_status',
    deliverystatus:'delivery_status',
    purchaserequest:'purchase_request',
    procurementstatus:'procurement_status',
  };

  // Procurement-status stage columns (WP Monitoring). The right-most marked stage wins.
  // Mapped to the Procurement Status option set (Not Started | Sourced | Solicited |
  // Evaluated | Awarded) so re-imports stay aligned with the WP form.
  const STAGES = [
    ['sourcing','Sourced'], ['rfq','Solicited'], ['bidopen','Solicited'],
    ['bidclosed','Evaluated'], ['loa','Awarded'], ['contract','Awarded'], ['mobdel','Awarded'],
  ];

  function buildIdx(header){
    const idx = {}, stageIdx = {};
    (header || []).forEach((h, i) => {
      const n = norm(h);
      if (HMAP[n] !== undefined && idx[HMAP[n]] === undefined) idx[HMAP[n]] = i;
      const st = STAGES.find(s => s[0] === n);
      if (st && stageIdx[st[0]] === undefined) stageIdx[st[0]] = i;
    });
    return { idx, stageIdx };
  }

  // ── value parsers ──
  const pStr  = v => { v = (v == null ? '' : String(v)).trim(); return v === '' ? null : v; };
  const pNum  = v => { if (v == null) return null; const n = parseFloat(String(v).replace(/[,\s₱]/g, '')); return isNaN(n) ? null : n; };
  const pInt  = v => { const n = parseInt(String(v == null ? '' : v).replace(/[,\s]/g, ''), 10); return isNaN(n) ? null : n; };
  const pPct  = v => { const n = pNum(v); if (n == null || n === 0) return null; return n > 1 ? n / 100 : n; };
  const pBond = v => { v = (v || '').trim().toLowerCase(); if (['yes','true','y','1'].includes(v)) return 'Yes'; if (['no','false','n','0',''].includes(v)) return 'No'; return v; };
  const pBool = v => ['yes','true','y','x','1'].includes((v || '').trim().toLowerCase());
  // Partial awards are not a valid state — "partially awarded" text maps to Not Yet Awarded (not fully awarded).
  function pAward(v){ v = (v || '').trim().toLowerCase(); if (!v) return null; if (v.includes('partial')) return 'Not Yet Awarded'; if (v.includes('not')) return 'Not Yet Awarded'; if (v.includes('award')) return 'Awarded'; return null; }
  function pDate(v){
    v = (v == null ? '' : String(v)).trim();
    if (!v || /^(n\/a|na|tbd|-|—)$/i.test(v)) return null;
    if (/^\d+(\.\d+)?$/.test(v)) {                       // bare number → Excel serial date
      const s = parseFloat(v);
      if (s > 20000 && s < 80000) { const d = new Date(Date.UTC(1899,11,30) + s * 86400000); return isNaN(d) ? null : d.toISOString().split('T')[0]; }
    }
    const d = new Date(v);
    return isNaN(d) ? null : d.toISOString().split('T')[0];
  }
  const stageOn = v => { v = (v || '').trim().toLowerCase(); return !(['', 'false', 'no', '0', 'n/a', 'na', '-'].includes(v)); };

  function deriveProc(row, stageIdx){
    let last = null;
    for (const [k, label] of STAGES) if (stageIdx[k] !== undefined && stageOn(row[stageIdx[k]])) last = label;
    return last;
  }

  // Position-based fallback: native 54-col template, or legacy <40-col files
  function positionMap(r, pid){
    const is54 = r.length >= 40;
    if (is54) return {
      project_id:pid,
      cost_code:pStr(r[0]), trade:pStr(r[1]), works:pStr(r[2]), type_of_works:pStr(r[3]),
      wp_no:pStr(r[4]), description:pStr(r[5])||pStr(r[4]), detailed_description:pStr(r[6]), scope:pStr(r[7]),
      zone:pStr(r[8]), type_of_service:pStr(r[9]), type_of_procurement:pStr(r[10]),
      type_of_contract:pStr(r[11]), charging_type:pStr(r[12]),
      contract_package_no:pStr(r[13]), co_description:pStr(r[14]),
      proposed_vendors:pStr(r[15]), po_jo_count:pInt(r[16]), po_jo_numbers:pStr(r[17]),
      responsible_team:pStr(r[18]), approver:pStr(r[19]), support_team:pStr(r[20]),
      surety_bond:pBond(r[21]), performance_bond:pBond(r[22]), warranty_bond:pBond(r[23]),
      requires_approval:pBool(r[24]), submittal_document_type:pStr(r[25]), approver_name:pStr(r[26]),
      approval_date:pDate(r[27]), submittal_type:pStr(r[28])||'Not Required',
      lead_time:pInt(r[29]), awarding_date:pDate(r[30]), actual_awarding_date:pDate(r[31]),
      target_delivery:pDate(r[32]), actual_delivery:pDate(r[33]), target_installation:pDate(r[34]),
      target_completion:pDate(r[35]),
      approved_budget_bcb:pNum(r[36])||0, awarded_cost:pNum(r[37]),
      award_status:pStr(r[38])||'Not Yet Awarded', contractor:pStr(r[39]),
      payment_terms_days:pInt(r[40]), dp_percent:pPct(r[41]), dp_terms:pStr(r[42]),
      dp_amount:pNum(r[43]), dp_release_date:pDate(r[44]), dp_notes:pStr(r[45]),
      retention_percent:pPct(r[46]), retention_amount:pNum(r[47]), retention_period:pStr(r[48]),
      procurement_status:pStr(r[49])||'Not Started', awarding_status:pStr(r[50]),
      delivery_status:pStr(r[51])||'', remarks:pStr(r[52])||'', purchase_request:pStr(r[53]),
    };
    return {
      project_id:pid,
      cost_code:pStr(r[0]), trade:pStr(r[1]), works:pStr(r[2]),
      wp_no:pStr(r[3]), description:pStr(r[4])||pStr(r[3]), zone:pStr(r[5]), scope:pStr(r[6]),
      charging_type:pStr(r[7]), contract_package_no:pStr(r[8]), co_description:pStr(r[9]),
      proposed_vendors:pStr(r[10]), po_jo_count:pInt(r[11]), po_jo_numbers:pStr(r[12]),
      approved_budget_bcb:pNum(r[13])||0, awarded_cost:pNum(r[14]),
      award_status:pStr(r[15])||'Not Yet Awarded', procurement_status:pStr(r[16])||'Not Started',
      awarding_date:pDate(r[17]), actual_awarding_date:pDate(r[18]),
      target_delivery:pDate(r[19]), actual_delivery:pDate(r[20]),
      target_completion:pDate(r[21]), target_installation:pDate(r[22]),
      lead_time:pInt(r[23]), remarks:pStr(r[24])||'',
    };
  }

  // Returns true when the header row contains recognizable WP column names
  function isHeaderMode(table){ return buildIdx(table[0]).idx.wp_no !== undefined; }

  function dataRowCount(table){
    if (!table || table.length < 2) return 0;
    const { idx } = buildIdx(table[0]);
    const header = idx.wp_no !== undefined;
    let n = 0;
    for (let i = 1; i < table.length; i++){
      const r = table[i];
      const cell = header ? r[idx.wp_no] : r[r.length >= 40 ? 4 : 3];
      if ((cell || '').trim() !== '') n++;
    }
    return n;
  }

  function toWPData(table, pid){
    const { idx, stageIdx } = buildIdx(table[0]);
    const header = idx.wp_no !== undefined;
    const out = [];
    for (let i = 1; i < table.length; i++){
      const r = table[i];
      if (!header){
        const wp = positionMap(r, pid);
        if (wp.wp_no) out.push(wp);
        continue;
      }
      const g = f => idx[f] !== undefined ? r[idx[f]] : '';
      const wpno = pStr(g('wp_no'));
      if (!wpno) continue;
      const proc = pStr(g('procurement_status')) || deriveProc(r, stageIdx) || 'Not Started';
      const awardedCost = pNum(g('awarded_cost'));
      // Award status comes from the explicit AWARDED / REMARKS text (the WP-Monitoring
      // "Not yet Awarded / Awarded" in Column P). The procurement stage is NOT a reliable
      // award signal, so it is only used as a last resort via awarded_cost.
      let award_status = pAward(g('award_status'))
        || pAward(g('remarks'))
        || (awardedCost > 0 ? 'Awarded' : 'Not Yet Awarded');
      // Reconcile the one-way invariant (proc 'Awarded' ⇄ award 'Awarded') that the WP form and
      // Status Tracker enforce, so imported rows don't land with proc/award disagreeing — the
      // dashboards read award_status, and a mismatch would make the KPIs and the form disagree.
      let procurement_status = proc;
      if (procurement_status === 'Awarded') award_status = 'Awarded';
      else if (award_status === 'Awarded') procurement_status = 'Awarded';
      out.push({
        project_id:pid,
        cost_code:pStr(g('cost_code')), trade:pStr(g('trade')), works:pStr(g('works')),
        type_of_works:pStr(g('type_of_works')), wp_no:wpno,
        description:pStr(g('description')) || wpno, detailed_description:pStr(g('detailed_description')),
        scope:pStr(g('scope')), zone:pStr(g('zone')),
        type_of_service:pStr(g('type_of_service')), type_of_procurement:pStr(g('type_of_procurement')),
        type_of_contract:pStr(g('type_of_contract')), charging_type:pStr(g('charging_type')),
        contract_package_no:pStr(g('contract_package_no')), co_description:pStr(g('co_description')),
        proposed_vendors:pStr(g('proposed_vendors')), po_jo_count:pInt(g('po_jo_count')), po_jo_numbers:pStr(g('po_jo_numbers')),
        responsible_team:pStr(g('responsible_team')), approver:pStr(g('approver')), support_team:pStr(g('support_team')),
        surety_bond:pBond(g('surety_bond')), performance_bond:pBond(g('performance_bond')), warranty_bond:pBond(g('warranty_bond')),
        requires_approval:pBool(g('requires_approval')),
        submittal_document_type:pStr(g('submittal_document_type')), approver_name:pStr(g('approver_name')),
        approval_date:pDate(g('approval_date')), submittal_type:pStr(g('submittal_type')) || 'Not Required',
        lead_time:pInt(g('lead_time')), awarding_date:pDate(g('awarding_date')),
        actual_awarding_date:pDate(g('actual_awarding_date')), target_delivery:pDate(g('target_delivery')),
        actual_delivery:pDate(g('actual_delivery')), target_installation:pDate(g('target_installation')),
        target_completion:pDate(g('target_completion')),
        approved_budget_bcb:pNum(g('approved_budget_bcb')) || 0, awarded_cost:awardedCost,
        additionals:pNum(g('additionals')),
        award_status, contractor:pStr(g('contractor')),
        payment_terms_days:pInt(g('payment_terms_days')), dp_percent:pPct(g('dp_percent')),
        dp_terms:pStr(g('dp_terms')), dp_amount:pNum(g('dp_amount')), dp_release_date:pDate(g('dp_release_date')),
        dp_notes:pStr(g('dp_notes')), retention_percent:pPct(g('retention_percent')),
        retention_amount:pNum(g('retention_amount')), retention_period:pStr(g('retention_period')),
        procurement_status, awarding_status:pStr(g('awarding_status')),
        delivery_status:pStr(g('delivery_status')) || '', remarks:pStr(g('remarks')) || '',
        purchase_request:pStr(g('purchase_request')),
      });
    }
    return out;
  }

  return { parse, dataRowCount, toWPData, isHeaderMode };
})();
