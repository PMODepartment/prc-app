-- ============================================================================
-- Vendor Management Dashboard — Phase 2b  —  Megawide WPM Dashboard
-- ----------------------------------------------------------------------------
-- Run once in the Supabase SQL Editor (production). Idempotent — safe to
-- re-run. Requires MIGRATION_vendor_management.sql (Phase 2a) to already be
-- applied (vendors table, internal.get_my_vendor_id(), internal.get_my_role(),
-- internal.get_my_status()).
--
-- Scope (Phase 2b): links a work package to a directory vendor
-- (work_packages.vendor_id) and introduces vendor_bids — per-WP competitive
-- bidding rows (one per participating vendor, not just the eventual winner)
-- so losing bids stay visible for comparison. Award-time reconciliation
-- (winning bid → 'awarded', the rest on that WP → 'lost') is done client-side
-- via VendorDb.reconcileBidsOnAward() in assets/js/db.js, not a DB trigger.
--
-- Deliberately NOT included this pass: the WP-form vendor combobox writing
-- vendor_id is added in wp-form.html/project.html app code (this migration
-- only adds the column); a "Log Bid" UI and vendors.html Bid History tab are
-- separate follow-up work — see CLAUDE.md "Vendor Management — Phase 2b".
-- ============================================================================

-- ── WORK PACKAGES: optional FK to the vendor directory ──────────────────────
-- Nullable, additive. Does NOT replace the existing free-text `contractor`
-- column — both are populated going forward (contractor for display/legacy
-- filters, vendor_id for the directory relationship).
alter table work_packages add column if not exists vendor_id uuid references vendors(id);
create index if not exists idx_wp_vendor on work_packages(vendor_id);

-- ── VENDOR BIDS ───────────────────────────────────────────────────────────
-- Per-WP competitive bidding: staff logs each participating vendor's offer
-- while a WP is still out for bidding, not just the eventual winner, so
-- losing bids stay visible for comparison. One row per (vendor_id, wp_id) —
-- a vendor bidding twice on the same WP updates in place rather than
-- duplicating (upsert on that pair, see VendorDb.upsertBid).
create table if not exists vendor_bids (
  id               uuid primary key default gen_random_uuid(),
  vendor_id        uuid not null references vendors(id),
  wp_id            uuid not null references work_packages(id) on delete cascade,
  project_id       text references projects(id),

  original_offer   numeric(18,2),
  negotiated_offer numeric(18,2),
  final_amount     numeric(18,2),

  status           text not null default 'participated'
                     check (status in ('participated','shortlisted','awarded','lost','withdrawn')),

  bid_date         date,
  award_date       date,
  notes            text,

  created_at       timestamptz default now(),
  created_by       uuid references users(id),
  updated_at       timestamptz default now(),
  updated_by       uuid references users(id),
  updated_by_name  text,

  constraint vendor_bids_vendor_wp_unique unique (vendor_id, wp_id)
);

create index if not exists idx_vendor_bids_vendor on vendor_bids(vendor_id);
create index if not exists idx_vendor_bids_wp on vendor_bids(wp_id);
create index if not exists idx_vendor_bids_project on vendor_bids(project_id);

-- updated_at trigger (reuse the shared trigger function, same as vendors/etc.)
drop trigger if exists trg_vendor_bids_updated on vendor_bids;
create trigger trg_vendor_bids_updated before update on vendor_bids
  for each row execute function update_updated_at();

-- ── RLS — mirrors vendor_rates exactly: staff read/write, viewer excluded,
-- viewer_budget can read (cost data, but they're allowed cost), vendor role
-- has NO access at all (money data belonging to staff's bidding process,
-- not the vendor's own record — unlike vendor_products/certifications/etc.
-- which a vendor edits about themselves).
alter table vendor_bids enable row level security;

drop policy if exists "vendor_bids_select" on vendor_bids;
create policy "vendor_bids_select" on vendor_bids
  for select to authenticated
  using (
    internal.get_my_status() = 'approved'
    and internal.get_my_role() in ('super_admin','admin','specialist','manager','user','viewer_budget')
  );

drop policy if exists "vendor_bids_write" on vendor_bids;
create policy "vendor_bids_write" on vendor_bids
  for all to authenticated
  using (
    internal.get_my_status() = 'approved'
    and internal.get_my_role() in ('super_admin','admin','specialist','manager','user')
  )
  with check (
    internal.get_my_status() = 'approved'
    and internal.get_my_role() in ('super_admin','admin','specialist','manager','user')
  );

-- ============================================================================
-- After running this migration:
-- 1. work_packages.vendor_id is available for the wp-form.html / project.html
--    vendor combobox to populate on save/award.
-- 2. vendor_bids is ready for VendorDb.upsertBid/getBidsForWP/getBidsForVendor/
--    reconcileBidsOnAward (assets/js/db.js) — no UI reads/writes it yet
--    beyond the award-time reconciliation call.
-- ============================================================================
