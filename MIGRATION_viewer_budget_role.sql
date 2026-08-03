-- ============================================================
-- Adds a new role: viewer_budget
-- Same as 'viewer' (read-only, assigned projects only, no writes)
-- EXCEPT it can see budget/cost data — it reads work_packages
-- directly (like the editor roles) instead of the cost-free
-- wp_view_public view. Run once in Supabase SQL Editor. Idempotent.
-- ============================================================

-- 1. Allow the new role value
alter table users drop constraint if exists users_role_check;
alter table users add constraint users_role_check
  check (role in ('super_admin','admin','specialist','manager','user','viewer','viewer_budget'));

-- 2. Write policies must deny viewer_budget too (it's read-only, same as viewer).
--    wp_select / wp_select_demo are untouched — they already only exclude 'viewer',
--    so viewer_budget falls through to the normal project-scope SELECT branch and
--    reads the base table (with cost columns) directly. wp_view_public is
--    unaffected — viewer_budget never routes through it (see db.js _wpRel()).

drop policy if exists "wp_insert" on work_packages;
create policy "wp_insert" on work_packages
  for insert to authenticated
  with check (
    internal.get_my_status() = 'approved'
    and internal.get_my_role() not in ('viewer','viewer_budget')
    and (
      internal.get_my_role() in ('super_admin','admin')
      or project_id = any(internal.get_my_projects())
    )
  );

drop policy if exists "wp_update" on work_packages;
create policy "wp_update" on work_packages
  for update to authenticated
  using (
    internal.get_my_status() = 'approved'
    and internal.get_my_role() not in ('viewer','viewer_budget')
    and (
      internal.get_my_role() in ('super_admin','admin')
      or project_id = any(internal.get_my_projects())
    )
  );

drop policy if exists "wp_delete" on work_packages;
create policy "wp_delete" on work_packages
  for delete to authenticated
  using (
    internal.get_my_status() = 'approved'
    and internal.get_my_role() not in ('viewer','viewer_budget')
    and (
      internal.get_my_role() in ('super_admin','admin')
      or project_id = any(internal.get_my_projects())
    )
  );

-- claims table doesn't exist on every environment (Claims/CO feature is hidden,
-- not-yet-active per CLAUDE.md) — guard so this migration is safe either way.
do $$
begin
  if to_regclass('public.claims') is not null then
    drop policy if exists "claims_insert" on claims;
    create policy "claims_insert" on claims
      for insert to authenticated
      with check (
        internal.get_my_status() = 'approved'
        and internal.get_my_role() not in ('viewer','viewer_budget')
        and (
          internal.get_my_role() in ('super_admin','admin')
          or project_id = any(internal.get_my_projects())
        )
      );

    drop policy if exists "claims_update" on claims;
    create policy "claims_update" on claims
      for update to authenticated
      using (
        internal.get_my_status() = 'approved'
        and internal.get_my_role() not in ('viewer','viewer_budget')
        and (
          internal.get_my_role() in ('super_admin','admin')
          or project_id = any(internal.get_my_projects())
        )
      );
  end if;
end $$;
