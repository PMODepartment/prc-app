/**
 * firebase-auth-shim.js
 * Place this in assets/js/ and add BEFORE firebase-config.js in every HTML page.
 * It intercepts AppAuth.requireLogin() and replaces Firebase auth with Supabase.
 * Zero changes needed to index.html, project.html, or any other page.
 */

// Override AppAuth globally before the old auth.js runs
window.AppAuth = {
  requireLogin: async function(onReady) {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    const sb = createClient(
      'https://cayjeqeleenizbdzrums.supabase.co',
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNheWplcWVsZWVuaXpiZHpydW1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3OTE5NzUsImV4cCI6MjA5NTM2Nzk3NX0.xWF6mSMTYSL65S56FTUSWFN0udJSY_yzUedU2CwFwpw'
    );

    const { data: { session } } = await sb.auth.getSession();
    if (!session) { window.location.href = 'login.html'; return; }

    const { data: profile } = await sb
      .from('users').select('*').eq('id', session.user.id).single();

    if (!profile || profile.status !== 'approved') {
      window.location.href = 'login.html'; return;
    }

    // Store globally
    window.__sb = sb;
    window.__profile = profile;

    // Expose logout
    window.logout = async () => { await sb.auth.signOut(); window.location.href = 'login.html'; };

    // Call the page's onReady with user + profile (matches old Firebase signature)
    onReady(session.user, profile);
  },

  requireAdmin: async function(onReady) {
    window.AppAuth.requireLogin(async (user, profile) => {
      if (!['admin','super_admin'].includes(profile.role)) {
        window.location.href = 'index.html'; return;
      }
      onReady(user, profile);
    });
  }
};

// Also override DB calls that pages use — map Firestore to Supabase
// Pages call DB.getWorkPackages(projectId) etc — we'll lazy-init DB when __sb is ready
window.DB = new Proxy({}, {
  get(_, method) {
    return async (...args) => {
      // Wait for __sb to be set by requireLogin
      let tries = 0;
      while (!window.__sb && tries++ < 50) await new Promise(r => setTimeout(r, 100));
      if (!window.__sb) throw new Error('Supabase not initialized');

      const sb = window.__sb;

      if (method === 'getWorkPackages') {
        const [projectId, filters] = args;
        let q = sb.from('work_packages').select('*').eq('review_status','approved');
        if (projectId) q = q.eq('project_id', projectId);
        if (filters?.trade) q = q.eq('trade', filters.trade);
        if (filters?.zone) q = q.eq('zone', filters.zone);
        if (filters?.search) q = q.ilike('description', `%${filters.search}%`);
        const { data } = await q.order('wp_no');
        return data || [];
      }

      if (method === 'getAllProjects') {
        const { data } = await sb.from('projects').select('*').order('id');
        return data || [];
      }

      if (method === 'getProject') {
        const { data } = await sb.from('projects').select('*').eq('id', args[0]).single();
        return data;
      }

      if (method === 'getUserProfile') {
        const { data } = await sb.from('users').select('*').eq('id', args[0]).single();
        return data;
      }

      if (method === 'getAllUsers') {
        const { data } = await sb.from('users').select('*').order('created_at', { ascending: false });
        return data || [];
      }

      if (method === 'approveUser') {
        const [uid, updates] = args;
        const { data } = await sb.from('users').update(updates).eq('id', uid).select().single();
        return data;
      }

      if (method === 'updateWorkPackage') {
        const [id, updates] = args;
        const { data } = await sb.from('work_packages').update(updates).eq('id', id).select().single();
        return data;
      }

      console.warn(`DB.${method} not yet mapped to Supabase`);
      return null;
    };
  }
});
