/**
 * auth.js — Supabase auth + role guard
 * Replaces the Firebase auth.js
 *
 * Usage: import { requireAuth, requireRole } from './auth.js';
 */

import supabase from './supabase-config.js';
import { getCurrentUser } from './db.js';

// ── Session state (module-level cache) ────────────────────────
let _currentUser = null;
let _session = null;

export function getUser() { return _currentUser; }
export function getSession() { return _session; }

export async function initAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  _session = session;
  if (session) {
    _currentUser = await getCurrentUser();
  }
  return { session, user: _currentUser };
}

// ── Page guards ───────────────────────────────────────────────

/**
 * Call at top of every protected page.
 * Redirects to login if not authenticated.
 * Redirects to pending.html if registration not yet approved.
 */
export async function requireAuth() {
  const { session, user } = await initAuth();
  if (!session) {
    window.location.href = 'login.html';
    return null;
  }
  if (!user || user.status === 'pending') {
    window.location.href = 'pending.html';
    return null;
  }
  if (user.status === 'rejected') {
    window.location.href = 'login.html?rejected=1';
    return null;
  }
  return user;
}

/**
 * Require a minimum role. Hierarchy: super_admin > admin > user.
 * Returns user or redirects to 403-equivalent.
 */
export async function requireRole(minRole = 'user') {
  const user = await requireAuth();
  if (!user) return null;

  const hierarchy = { user: 0, admin: 1, super_admin: 2 };
  const userLevel = hierarchy[user.role] ?? 0;
  const requiredLevel = hierarchy[minRole] ?? 0;

  if (userLevel < requiredLevel) {
    // Redirect to dashboard with access denied message
    window.location.href = 'index.html?error=access_denied';
    return null;
  }
  return user;
}

export function isSuperAdmin(user) {
  return user?.role === 'super_admin';
}

export function isAdmin(user) {
  return user?.role === 'admin' || user?.role === 'super_admin';
}

export function canManageUsers(user) {
  return isAdmin(user);
}

export function canCreateProjects(user) {
  return isSuperAdmin(user);
}

export function canAccessProject(user, projectId) {
  if (!user) return false;
  if (isSuperAdmin(user)) return true;
  if (isAdmin(user)) return true; // admins see all for now; can be tightened to user.projects
  return user.projects?.includes(projectId);
}

export function canAccessConsolidated(user) {
  // Consolidated view: admins and super admins (or users explicitly granted 'CONSOLIDATED')
  return isAdmin(user) || user?.projects?.includes('CONSOLIDATED');
}

// ── Logout ────────────────────────────────────────────────────
export async function logout() {
  await supabase.auth.signOut();
  sessionStorage.clear();
  window.location.href = 'login.html';
}

// ── Auth state listener ───────────────────────────────────────
export function watchAuth(callback) {
  return supabase.auth.onAuthStateChange(async (_event, session) => {
    _session = session;
    _currentUser = session ? await getCurrentUser() : null;
    callback({ session, user: _currentUser });
  });
}
