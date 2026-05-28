/**
 * auth.js — Supabase replacement
 * Keeps AppAuth API identical to the old Firebase version
 * so index.html, project.html etc need ZERO changes.
 */

const _SB_URL = 'https://cayjeqeleenizbdzrums.supabase.co';
const _SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNheWplcWVsZWVuaXpiZHpydW1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3OTE5NzUsImV4cCI6MjA5NTM2Nzk3NX0.xWF6mSMTYSL65S56FTUSWFN0udJSY_yzUedU2CwFwpw';

// Bootstrap Supabase — loaded via CDN since pages use legacy non-module scripts
let _sb = null;
async function getSB() {
  if (_sb) return _sb;
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  _sb = createClient(_SB_URL, _SB_KEY);
  return _sb;
}

const AppAuth = (() => {

  async function requireLogin(onReady) {
    const sb = await getSB();
    const { data: { session } } = await sb.auth.getSession();

    if (!session) { window.location.href = 'login.html'; return; }

    const { data: profile } = await sb
      .from('users').select('*').eq('id', session.user.id).single();

    if (!profile || profile.status !== 'approved') {
      await sb.auth.signOut();
      window.location.href = 'login.html'; return;
    }

    // Expose globally for other scripts
    window.__sb = sb;
    window.__profile = profile;
    window.__session = session;

    onReady(session.user, profile);
  }

  async function requireAdmin(onReady) {
    requireLogin((user, profile) => {
      if (!['admin', 'super_admin'].includes(profile.role)) {
        window.location.href = 'index.html'; return;
      }
      onReady(user, profile);
    });
  }

  async function logout() {
    const sb = await getSB();
    await sb.auth.signOut();
    window.location.href = 'login.html';
  }

  function getPermittedProjects(profile, allProjects) {
    if (['admin', 'super_admin'].includes(profile.role)) return allProjects;
    return allProjects.filter(p => (profile.projects || []).includes(p.id));
  }

  function isAdmin(profile) {
    return ['admin', 'super_admin'].includes(profile?.role);
  }

  function isSuperAdmin(profile) {
    return profile?.role === 'super_admin';
  }

  return { requireLogin, requireAdmin, logout, getPermittedProjects, isAdmin, isSuperAdmin };
})();
