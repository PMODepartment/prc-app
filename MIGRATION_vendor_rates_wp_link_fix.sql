-- MIGRATION_vendor_rates_wp_link_fix.sql
-- Run once in Supabase SQL Editor. Requires MIGRATION_vendor_rates_wp_link.sql
-- to already have been run. Idempotent / safe to re-run.
--
-- Fixes: VendorDb.upsertRate() (assets/js/db.js) calls
--   .upsert(payload, { onConflict: 'vendor_id,wp_id' })
-- which Supabase/PostgREST translates into a plain
--   ON CONFLICT (vendor_id, wp_id)
-- with NO WHERE predicate. Postgres requires the ON CONFLICT target to
-- exactly match an existing constraint/index — a PARTIAL unique index
-- (MIGRATION_vendor_rates_wp_link.sql's `vendor_rates_wp_uidx ... WHERE
-- wp_id IS NOT NULL`) does NOT satisfy a non-partial arbiter, so every
-- backfill upsert failed with:
--   "there is no unique or exclusion constraint matching the ON CONFLICT
--    specification"
--
-- Fix: drop the partial index and replace it with a FULL unique constraint
-- on (vendor_id, wp_id). This still works correctly for manually-entered
-- rates with wp_id IS NULL — standard SQL unique constraints never treat
-- NULL as equal to NULL, so any number of manual rate rows with a null
-- wp_id remain completely unconstrained, exactly as before.

drop index if exists vendor_rates_wp_uidx;

alter table vendor_rates drop constraint if exists vendor_rates_vendor_wp_uidx;
alter table vendor_rates add constraint vendor_rates_vendor_wp_uidx
  unique (vendor_id, wp_id);
