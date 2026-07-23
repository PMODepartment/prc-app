-- ============================================================================
-- MIGRATION: Per-WP audit trail ("last change" log)
-- Run once in the Supabase SQL Editor. Idempotent / safe to re-run.
--
-- Records WHO last changed each work package and WHEN, so the WP detail panel
-- can show a "Last Change" block now that the dashboard is used by all officers.
--   • updated_at       — timestamp of the last insert/update (already selected by
--                        wp_view_public; added here IF NOT EXISTS for safety)
--   • updated_by       — auth uid of the last editor (no FK, so removing a user
--                        never blocks a WP write)
--   • updated_by_name  — snapshot of the editor's name/email at write time, so the
--                        display survives even if that user is later removed
--
-- The client (db.js _auditStamp / the Excel importer) writes all three on every
-- insert/update. Both write paths gracefully fall back to writing WITHOUT these
-- columns if the migration hasn't run yet, so deploying the code first is safe.
-- ============================================================================

alter table public.work_packages add column if not exists updated_at      timestamptz;
alter table public.work_packages add column if not exists updated_by      uuid;
alter table public.work_packages add column if not exists updated_by_name text;

-- Backfill a sensible starting timestamp so existing rows aren't blank.
update public.work_packages set updated_at = coalesce(updated_at, created_at) where updated_at is null;

-- Extend the viewer-facing cost-free view so read-only viewers also see the
-- last-change info (all three are non-cost columns — safe to expose).
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
    remarks, created_at, updated_at, updated_by, updated_by_name
  from public.work_packages wp
  where internal.get_my_status() = 'approved'
    and (
      internal.get_my_role() in ('super_admin','admin','specialist')
      or wp.project_id = any(internal.get_my_projects())
      or wp.project_id = 'DEMO'
    );

grant select on public.wp_view_public to authenticated;

-- Done.
