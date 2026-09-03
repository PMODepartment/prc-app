const _SB_URL = 'https://cayjeqeleenizbdzrums.supabase.co';
const _SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNheWplcWVsZWVuaXpiZHpydW1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3OTE5NzUsImV4cCI6MjA5NTM2Nzk3NX0.xWF6mSMTYSL65S56FTUSWFN0udJSY_yzUedU2CwFwpw';
// Use UMD bundle (loaded as <script> before this file) — single request vs 6 ESM sub-imports
window.__sb = window.supabase.createClient(_SB_URL, _SB_KEY);
async function getSB() { return window.__sb; }
const AppAuth = (() => {
  /* Which sign-in page this surface belongs to. Vendors and Megawide staff are
     separate audiences with separate front doors: vendor-portal.html sets
     window.__loginPage = 'vendor-login.html' so an expired session, a rejected
     profile and Sign out all return the vendor to THEIR door rather than
     dropping them on the employee dashboard's login. Every other page leaves it
     unset and keeps login.html. */
  function _loginPage() {
    return (typeof window !== 'undefined' && window.__loginPage) || 'login.html';
  }
  async function requireLogin(onReady) {
    const sb = await getSB();
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { window.location.href = _loginPage(); return; }
    // Profile cache: avoids a DB round-trip on every page navigation within a session
    let profile;
    const cacheKey = 'wpm_prof_' + session.user.id;
    try { const c = sessionStorage.getItem(cacheKey); if (c) profile = JSON.parse(c); } catch {}
    if (!profile) {
      const { data } = await sb.from('users').select('*').eq('id', session.user.id).single();
      profile = data;
      try { if (profile) sessionStorage.setItem(cacheKey, JSON.stringify(profile)); } catch {}
    }
    if (!profile || profile.status !== 'approved') { await sb.auth.signOut(); window.location.href = _loginPage(); return; }
    /* ⚠️ A VENDOR MAY NOT OPEN AN INTERNAL PAGE. RLS already starves them of the
       data (which is why the dashboard rendered zeros), but the page itself still
       exposed Megawide's internal surface: the tabs, the KPI set, the reporting
       structure, every feature name. Blocking it here — the ONE place every
       internal page funnels through — means a page added later is covered by
       default instead of needing its own guard. Vendor surfaces opt IN with
       window.__vendorSurface, set before auth.js runs; only vendor-portal.html
       does. Never gate this per-page again: all nine internal pages had no
       vendor check at all, which is how this shipped. */
    if (profile.role === 'vendor' && !(typeof window !== 'undefined' && window.__vendorSurface)) {
      window.location.href = 'vendor-portal.html';
      return;
    }
    window.__profile = profile; window.__session = session;
    if (typeof WPDb !== 'undefined' && WPDb.updateLastLogin) WPDb.updateLastLogin(session.user.id).catch(()=>{});
    if (typeof AppTheme !== 'undefined') AppTheme.init(session.user.id);
    onReady(session.user, profile);
  }
  async function requireAdmin(onReady) { requireLogin((user, profile) => { if (!['admin','super_admin'].includes(profile.role)) { window.location.href = 'index.html'; return; } onReady(user, profile); }); }
  async function logout() {
    const sb = await getSB();
    try { [...Object.keys(sessionStorage)].forEach(k => { if (k.startsWith('wpm_prof_')) sessionStorage.removeItem(k); }); } catch {}
    await sb.auth.signOut();
    window.location.href = _loginPage();
  }
  // Roles that see ALL projects (not just assigned)
  const _ALL_PROJECT_ROLES = ['admin','super_admin','specialist'];
  function getPermittedProjects(profile, allProjects) { if (_ALL_PROJECT_ROLES.includes(profile.role)) return allProjects; return allProjects.filter(p => (profile.projects||[]).includes(p.id)); }
  // VIEW scope: specialist (like admin) can open/read all projects.
  function canAccessProject(profile, projectId) { if (projectId === 'DEMO') return true; /* read-only sandbox — open to everyone */ if (_ALL_PROJECT_ROLES.includes(profile.role)) return true; return (profile.projects||[]).includes(projectId); }
  // EDIT scope (P1): only super_admin/admin can edit ANY project; specialist/manager/user
  // can edit only their ASSIGNED projects. Mirrors the server-side wp_insert/wp_update RLS.
  // DEMO is read-only for everyone (handled separately via window.__demo/__archived).
  function canEditProject(profile, projectId) {
    if (projectId === 'DEMO') return false;
    // Read-only roles can never edit, however their projects are assigned. Without this a
    // viewer_budget assigned to a project would get edit affordances the server then refuses.
    if (isReadOnly(profile)) return false;
    if (['super_admin','admin'].includes(profile?.role)) return true;
    return (profile?.projects||[]).includes(projectId);
  }
  function isAdmin(p) { return ['admin','super_admin'].includes(p?.role); }
  function isSuperAdmin(p) { return p?.role === 'super_admin'; }
  // isReadOnly  = cannot change anything (viewer + viewer_budget).
  // isViewer     = ALSO gets the stripped-down single-page layout with most panels removed.
  //                That is plain `viewer` ONLY -- viewer_budget gets the full contributor UI
  //                (tabs, every panel, Vendor Management) and is merely unable to edit.
  // hidesBudget  = cost data hidden (plain `viewer` only).
  function isReadOnly(p) { return p?.role === 'viewer' || p?.role === 'viewer_budget'; }
  function isViewer(p) { return p?.role === 'viewer'; }
  function hidesBudget(p) { return p?.role === 'viewer'; }
  function isSpecialist(p) { return p?.role === 'specialist'; }
  function isManager(p) { return p?.role === 'manager'; }
  // Roles whose WP submissions auto-approve (skip pending_review). `user` was added — regular users
  // now add/edit/delete WPs freely without manager/approver sign-off. Only `viewer` is read-only.
  function isAutoApprove(p) { return ['super_admin','admin','specialist','manager','user'].includes(p?.role); }
  return { requireLogin, requireAdmin, logout, getPermittedProjects, canAccessProject, canEditProject, isAdmin, isSuperAdmin, isViewer, isReadOnly, isSpecialist, isManager, isAutoApprove, hidesBudget };
})();
