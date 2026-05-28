/**
 * auth-guard.js
 * Drop this in assets/js/ and add ONE script tag to every protected page:
 * <script src="assets/js/auth-guard.js"></script>
 *
 * It checks Supabase session and redirects to login if not authenticated.
 * Works completely independently — does NOT require the old auth.js or firebase.
 */
(async function() {
  const SUPABASE_URL = 'https://cayjeqeleenizbdzrums.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNheWplcWVsZWVuaXpiZHpydW1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3OTE5NzUsImV4cCI6MjA5NTM2Nzk3NX0.xWF6mSMTYSL65S56FTUSWFN0udJSY_yzUedU2CwFwpw';

  // Load Supabase dynamically
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

  const { data: { session } } = await sb.auth.getSession();

  if (!session) {
    window.location.href = 'login.html';
    return;
  }

  // Fetch profile
  const { data: profile } = await sb
    .from('users')
    .select('*')
    .eq('id', session.user.id)
    .single();

  if (!profile || profile.status !== 'approved') {
    window.location.href = 'login.html';
    return;
  }

  // Store profile globally for the page to use
  window.__sbProfile = profile;
  window.__sbClient = sb;

  // Expose logout globally
  window.logout = async () => {
    await sb.auth.signOut();
    window.location.href = 'login.html';
  };

})();
