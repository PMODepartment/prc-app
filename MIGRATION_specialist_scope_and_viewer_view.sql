-- ============================================================================
-- P1 (specialist edit-scope) + S4 (viewer cost masking)  —  WPM Dashboard
-- ----------------------------------------------------------------------------
-- Run once in the Supabase SQL Editor (production), AFTER MIGRATION_rls_hardening.sql.
-- Idempotent — safe to re-run.
--
-- P1: Specialists may VIEW all projects but EDIT only their assigned ones.
--     Previously the write policies included 'specialist' in the all-projects
--     branch, letting a specialist insert/update/… WPs on projects not assigned
--     to them. Remove specialist from the WRITE branches (keep it in SELECT).
--
-- S4: Viewers must not read cost via the REST API. RLS is row-level so the
--     UI-only cost hiding was bypassable. We (a) block viewers from SELECTing
--     the base work_packages table, and (b) give everyone a security-definer
--     view `wp_view_public` that re-implements row scope and OMITS all cost
--     columns. Non-viewers keep reading the base table (with cost); viewers
--     read the view (no cost). The client picks the relation by role.
-- ============================================================================

-- ── P1: WORK_PACKAGES write policies — specialist limited to assigned ───────
drop policy if exists "wp_insert" on public.work_packages;
create policy "wp_insert" on public.work_packages
  for insert to authenticated
  with check (
    internal.get_my_status() = 'approved'
    and internal.get_my_role() <> 'viewer'
    and (
      internal.get_my_role() in ('super_admin','admin')
      or project_id = any(internal.get_my_projects())
    )
  );

drop policy if exists "wp_update" on public.work_packages;
create policy "wp_update" on public.work_packages
  for update to authenticated
  using (
    internal.get_my_status() = 'approved'
    and internal.get_my_role() <> 'viewer'
    and (
      internal.get_my_role() in ('super_admin','admin')
      or project_id = any(internal.get_my_projects())
    )
  );

-- ── P1: CLAIMS write policies — same specialist restriction ─────────────────
drop policy if exists "claims_insert" on public.claims;
create policy "claims_insert" on public.claims
  for insert to authenticated
  with check (
    internal.get_my_status() = 'approved'
    and internal.get_my_role() <> 'viewer'
    and (
      internal.get_my_role() in ('super_admin','admin')
      or project_id = any(internal.get_my_projects())
    )
  );

drop policy if exists "claims_update" on public.claims;
create policy "claims_update" on public.claims
  for update to authenticated
  using (
    internal.get_my_status() = 'approved'
    and internal.get_my_role() <> 'viewer'
    and (
      internal.get_my_role() in ('super_admin','admin')
      or project_id = any(internal.get_my_projects())
    )
  );

-- ── S4: block viewers from the base table (they read via the view instead) ──
-- Keep the DEMO read-exception (from MIGRATION_rls_hardening) intact.
drop policy if exists "wp_select" on public.work_packages;
create policy "wp_select" on public.work_packages
  for select to authenticated
  using (
    internal.get_my_status() = 'approved'
    and internal.get_my_role() <> 'viewer'
    and (
      internal.get_my_role() in ('super_admin','admin','specialist')
      or project_id = any(internal.get_my_projects())
    )
  );

-- ── S4: cost-free, security-definer view of work_packages ───────────────────
-- SECURITY DEFINER (default for views) → runs as owner, bypassing the caller's
-- RLS, so viewers (who are denied on the base table) can read it. It therefore
-- re-implements the same row scope in its WHERE, and OMITS every money column:
--   approved_budget_bcb, awarded_cost, additionals, total_awarded, variance,
--   dp_percent, dp_amount, retention_percent, retention_amount.
-- MAINTENANCE: when you ADD a work_packages column, add it here too (non-cost
-- columns only — never add a money column, or viewers would see it).
drop view if exists public.wp_view_public;
create view public.wp_view_public as
  select
    id, project_id, wp_no, cost_code, description, detailed_description,
    zone, trade, works, type_of_works, scope,
    type_of_service, type_of_procurement, type_of_contract, proposed_vendors,
    charging_type, contract_package_no, co_description,
    lead_time, awarding_date, actual_awarding_date, awarding_lead_time,
    target_delivery, actual_delivery, target_installation, target_completion,
    procurement_status, award_status, delivery_status, awarding_status, purchase_request,
    responsible_team, contractor, po_jo_count, po_jo_numbers,
    approver, support_team,
    surety_bond, performance_bond, warranty_bond,
    requires_approval, approver_name, approval_date, submittal_document_type, submittal_type,
    payment_terms_days, dp_terms, dp_notes, dp_release_date, retention_period,
    osm,
    review_status, review_notes, assigned_officer,
    remarks, created_at, updated_at
  from public.work_packages wp
  where internal.get_my_status() = 'approved'
    and (
      internal.get_my_role() in ('super_admin','admin','specialist')
      or wp.project_id = any(internal.get_my_projects())
      or wp.project_id = 'DEMO'
    );

grant select on public.wp_view_public to authenticated;

-- Done.
