const _SB_URL = 'https://cayjeqeleenizbdzrums.supabase.co';
const _SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNheWplcWVsZWVuaXpiZHpydW1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3OTE5NzUsImV4cCI6MjA5NTM2Nzk3NX0.xWF6mSMTYSL65S56FTUSWFN0udJSY_yzUedU2CwFwpw';
// Use UMD bundle (loaded as <script> before this file) — single request vs 6 ESM sub-imports
window.__sb = window.supabase.createClient(_SB_URL, _SB_KEY);
async function getSB() { return window.__sb; }
const AppAuth = (() => {
  async function requireLogin(onReady) {
    const sb = await getSB();
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { window.location.href = 'login.html'; return; }
    // Profile cache: avoids a DB round-trip on every page navigation within a session
    let profile;
    const cacheKey = 'wpm_prof_' + session.user.id;
    try { const c = sessionStorage.getItem(cacheKey); if (c) profile = JSON.parse(c); } catch {}
    if (!profile) {
      const { data } = await sb.from('users').select('*').eq('id', session.user.id).single();
      profile = data;
      try { if (profile) sessionStorage.setItem(cacheKey, JSON.stringify(profile)); } catch {}
    }
    if (!profile || profile.status !== 'approved') { await sb.auth.signOut(); window.location.href = 'login.html'; return; }
    window.__profile = profile; window.__session = session;
    if (typeof WPDb !== 'undefined' && WPDb.updateLastLogin) WPDb.updateLastLogin(session.user.id).catch(()=>{});
    onReady(session.user, profile);
  }
  async function requireAdmin(onReady) { requireLogin((user, profile) => { if (!['admin','super_admin'].includes(profile.role)) { window.location.href = 'index.html'; return; } onReady(user, profile); }); }
  async function logout() {
    const sb = await getSB();
    try { [...Object.keys(sessionStorage)].forEach(k => { if (k.startsWith('wpm_prof_')) sessionStorage.removeItem(k); }); } catch {}
    await sb.auth.signOut();
    window.location.href = 'login.html';
  }
  function getPermittedProjects(profile, allProjects) { if (['admin','super_admin'].includes(profile.role)) return allProjects; return allProjects.filter(p => (profile.projects||[]).includes(p.id)); }
  function canAccessProject(profile, projectId) { if (['admin','super_admin'].includes(profile.role)) return true; return (profile.projects||[]).includes(projectId); }
  function isAdmin(p) { return ['admin','super_admin'].includes(p?.role); }
  function isSuperAdmin(p) { return p?.role === 'super_admin'; }
  function isViewer(p) { return p?.role === 'viewer'; }
  return { requireLogin, requireAdmin, logout, getPermittedProjects, canAccessProject, isAdmin, isSuperAdmin, isViewer };
})();
