-- ============================================================================
-- RLS hardening migration  —  Megawide WPM Dashboard
-- ----------------------------------------------------------------------------
-- Fixes three authorization gaps found in the security audit. Run once in the
-- Supabase SQL Editor (production). Idempotent — safe to re-run.
--
--   S2  users_update had a USING but NO WITH CHECK, so any user could PATCH
--       their own row to role='super_admin', status='approved'. (privilege escalation)
--   S3  users_insert only checked id=auth.uid(), so a registrant could insert
--       themselves as role='super_admin', status='approved'. (privilege escalation)
--   B3  The read-only DEMO sandbox was unreadable to normal users because
--       wp_select requires the project be in their assignments. Add a DEMO
--       read exception so everyone approved can explore it.
-- ============================================================================

-- ── S3: registration insert may only create a plain pending user ────────────
drop policy if exists "users_insert" on public.users;
create policy "users_insert" on public.users
  for insert to authenticated
  with check (
    id = auth.uid()
    and role = 'user'
    and status = 'pending'
  );

-- ── S2: self-update may NOT change role / status / projects ─────────────────
-- Admins may change anything; a user editing their own row must leave role,
-- status and projects exactly as they are (WITH CHECK compares the NEW row to
-- the CURRENT stored values via the SECURITY DEFINER helpers). This lets users
-- still update benign columns (name, last_login) but blocks self-elevation.
drop policy if exists "users_update" on public.users;
create policy "users_update" on public.users
  for update to authenticated
  using (
    id = auth.uid()
    or internal.get_my_role() in ('super_admin','admin')
  )
  with check (
    internal.get_my_role() in ('super_admin','admin')
    or (
      id = auth.uid()
      and role = internal.get_my_role()
      and status = internal.get_my_status()
      and coalesce(projects, '{}') = internal.get_my_projects()
    )
  );

-- ── B3: DEMO sandbox is readable by every approved user ─────────────────────
-- Additional SELECT policies are OR'd with the existing wp_select, so this only
-- widens read access to project_id='DEMO' (it never narrows the existing scope).
drop policy if exists "wp_select_demo" on public.work_packages;
create policy "wp_select_demo" on public.work_packages
  for select to authenticated
  using (
    internal.get_my_status() = 'approved'
    and project_id = 'DEMO'
  );

-- ── Optional hardening: drop the latent broad anon INSERT grant on users ────
-- Registration inserts run as `authenticated` (post-signUp), so anon never
-- needs INSERT. Removing the grant closes a footgun if a permissive anon
-- policy is ever added later. (Safe: no anon insert policy exists today.)
revoke insert on public.users from anon;

-- Done.
