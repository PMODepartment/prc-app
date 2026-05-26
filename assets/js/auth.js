/* auth.js — Firebase Auth + Firestore user management */
const AppAuth = (() => {

  function requireLogin(onReady) {
    Auth.onAuthStateChanged(async user => {
      if (!user) { window.location.href = 'login.html'; return; }
      const profile = await getUserProfile(user.uid);
      if (!profile) { await Auth.signOut(); window.location.href = 'login.html'; return; }
      if (profile.status === 'pending')  { window.location.href = 'pending.html'; return; }
      if (profile.status === 'rejected') { window.location.href = 'login.html'; return; }
      onReady(user, profile);
    });
  }

  function requireAdmin(onReady) {
    requireLogin((user, profile) => {
      if (profile.role !== 'admin') { window.location.href = 'index.html'; return; }
      onReady(user, profile);
    });
  }

  async function register(name, email, password) {
    const cred = await Auth.createUserWithEmailAndPassword(email, password);
    await DB.collection('users').doc(cred.user.uid).set({
      uid: cred.user.uid, name, email,
      role: 'procurement_officer',
      status: 'pending', projects: [], assigned_wps: [],
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      approvedAt: null, approvedBy: null,
    });
    await Auth.signOut();
  }

  async function login(email, password) {
    const cred    = await Auth.signInWithEmailAndPassword(email, password);
    const profile = await getUserProfile(cred.user.uid);
    if (!profile)                      throw new Error('User profile not found.');
    if (profile.status === 'pending')  throw new Error('Your account is pending admin approval.');
    if (profile.status === 'rejected') throw new Error('Your registration was not approved.');
    return { user: cred.user, profile };
  }

  async function logout() { await Auth.signOut(); window.location.href = 'login.html'; }

  async function getUserProfile(uid) {
    const doc = await DB.collection('users').doc(uid).get();
    return doc.exists ? doc.data() : null;
  }

  async function getAllUsers() {
    const snap = await DB.collection('users').get();
    return snap.docs.map(d => d.data()).sort((a,b) => {
      const ta = a.createdAt?.toMillis?.() || 0;
      const tb = b.createdAt?.toMillis?.() || 0;
      return tb - ta;
    });
  }

  async function getOfficers() {
    const snap = await DB.collection('users')
      .where('status','==','approved')
      .where('role','==','procurement_officer').get();
    return snap.docs.map(d => d.data());
  }

  async function approveUser(uid, projects, role, adminName) {
    await DB.collection('users').doc(uid).update({
      status: 'approved', projects, role,
      approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
      approvedBy: adminName,
    });
  }

  async function rejectUser(uid) {
    await DB.collection('users').doc(uid).update({ status: 'rejected' });
  }

  async function updateUser(uid, data) {
    await DB.collection('users').doc(uid).update(data);
  }

  function canAccessProject(profile, projectId) {
    if (!profile) return false;
    if (profile.role === 'admin') return true;
    return profile.projects && profile.projects.includes(projectId);
  }

  function getPermittedProjects(profile, allProjects) {
    if (!profile) return [];
    if (profile.role === 'admin') return allProjects;
    return allProjects.filter(p => profile.projects && profile.projects.includes(p.id));
  }

  function renderUserBar(containerId, profile) {
    const el = document.getElementById(containerId);
    if (!el || !profile) return;
    const roleLabel = {
      admin: 'Admin',
      procurement_officer: 'Procurement Officer',
    }[profile.role] || profile.role;
    const projLabel = profile.role === 'admin' ? 'All projects' :
      (profile.projects && profile.projects.length ? profile.projects.join(', ') : 'None assigned');
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px">
        <div style="text-align:right">
          <div style="font-size:12px;font-weight:600;color:var(--text-primary)">${profile.name}</div>
          <div style="font-size:10px;color:var(--text-secondary)">${roleLabel} · ${projLabel}</div>
        </div>
        <div style="width:34px;height:34px;border-radius:50%;background:var(--blue-600);color:#fff;
          display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;flex-shrink:0">
          ${profile.name.charAt(0).toUpperCase()}
        </div>
        <button onclick="AppAuth.logout()" title="Sign out"
          style="font-size:11px;padding:4px 10px;border-radius:6px;border:1px solid var(--border-md);
          background:var(--surface);color:var(--text-secondary);cursor:pointer">
          <i class="ti ti-logout" style="font-size:13px;vertical-align:middle"></i>
        </button>
      </div>`;
  }

  return {
    requireLogin, requireAdmin, register, login, logout,
    getUserProfile, getAllUsers, getOfficers,
    approveUser, rejectUser, updateUser,
    canAccessProject, getPermittedProjects, renderUserBar,
  };
})();
