-- migrations/2026-08-10_vendor_rates_wp_link.sql
-- Run once in Supabase SQL Editor. Requires migrations/2026-08-10_vendor_management.sql
-- (vendor_rates table) to already exist. Idempotent / safe to re-run.
--
-- Links a vendor_rates row back to the work_package it was derived from, so
-- the vendor-data backfill tool (VendorDb.backfillVendorDataFromWPs, db.js)
-- can be re-run without creating duplicate rate rows for the same WP.
-- Nullable/additive: manually-entered staff rates (vendors.html Rates tab)
-- keep wp_id NULL and are completely unaffected.

alter table vendor_rates add column if not exists wp_id uuid references work_packages(id) on delete cascade;

-- Partial unique index: only auto-imported rows (wp_id is not null) are
-- constrained to one rate per (vendor, WP) pair. Manual entries (wp_id null)
-- are never limited by this index — a vendor can have any number of manual
-- quotes with no wp_id.
create unique index if not exists vendor_rates_wp_uidx
  on vendor_rates(vendor_id, wp_id)
  where wp_id is not null;

-- No RLS change needed: vendor_rates' existing "vendor_rates_select"/
-- "vendor_rates_write" policies (migrations/2026-08-10_vendor_management.sql) apply to
-- the whole row regardless of column, so a new column needs no new policy.
