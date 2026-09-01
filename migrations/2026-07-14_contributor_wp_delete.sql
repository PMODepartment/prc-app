-- MIGRATION: allow contributors to DELETE work packages on their assigned projects
-- Run once in the Supabase SQL Editor. Idempotent (drops + recreates the policy).
--
-- Why: the Excel "Replace" import (and the WP detail-panel delete) deletes a project's
-- existing WPs before re-inserting. Previously DELETE on work_packages was super_admin-only,
-- so contributors (specialist/manager/user) could parse/preview but their Replace aborted at
-- the delete step. This widens DELETE to the SAME scope as INSERT/UPDATE: super_admin/admin
-- anywhere; specialist/manager/user only on projects in their assigned list; viewer denied.

drop policy if exists "wp_delete" on work_packages;

create policy "wp_delete" on work_packages
  for delete to authenticated
  using (
    internal.get_my_status() = 'approved'
    and internal.get_my_role() <> 'viewer'
    and (
      internal.get_my_role() in ('super_admin','admin')
      or project_id = any(internal.get_my_projects())
    )
  );
