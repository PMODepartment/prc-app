-- Vendor SCHEDULE PERFORMANCE from the Planners app ------------------------------
-- Run in the WPM Supabase project. Idempotent (safe to re-run).
--
-- The Planners app's Project Schedule knows which activities a work package
-- supplies (project_schedule.work_package = this app's work_packages.wp_no), and
-- this app knows who won that package (work_packages.vendor_id). Put the two
-- together and you get the thing a buyer actually wants: is this vendor keeping
-- to the construction programme?
--
-- ⚠️ THE SCHEDULE LIVES IN THE PLANNERS DATABASE AND THIS APP CANNOT READ IT.
-- So the numbers are COMPUTED THERE and pushed here. Everything in this table is
-- a SNAPSHOT as fresh as the last push — exactly like planners_need_by, which
-- already works this way. That is why `pushed_at` and `data_date` are columns and
-- not decoration: a vendor's SPI is meaningless without saying when it was true,
-- and a screen that shows the figure without the timestamp invites someone to
-- quote a month-old number in a negotiation.
--
-- ⚠️ IT IS A SEPARATE TABLE, NOT COLUMNS ON `vendors`. Vendor rows are edited by
-- staff and by vendors themselves (vendor_field_ownership, the accreditation
-- request queue). Another application writing into them would destroy work with
-- no audit trail and no way to tell a buyer's judgement from a robot's. The
-- schedule REPORTS here; nothing in this table is authoritative for the vendor.
--
-- ⚠️ WRITES ARE SERVICE-ROLE ONLY. The Planners `push-vendor-perf` Edge Function
-- holds this project's service key as a server-side secret; no policy grants
-- insert/update to authenticated or anon, so a browser can never fabricate a
-- performance figure about a vendor.
--
-- Keyed by (vendor_id, project_id) — vendor_id is this app's own vendors.id (the
-- Planners app mirrors it, it does not mint its own), so this joins without the
-- Planners app needing to know anything about our uuids.
-- ---------------------------------------------------------------------------------

create table if not exists planners_vendor_performance (
  vendor_id     uuid not null,
  project_id    text not null,          -- THIS app's projects.id
  -- The Planners-side project this was computed from. They are usually the same
  -- string, but Cash Flow's wpm_project_id mapping allows them to differ, and a
  -- buyer looking at a surprising number needs to know which schedule it came from.
  source_project_id text,

  -- Denormalised so a row stays readable if the vendor is later merged away.
  -- ⚠️ Display only — never join on it.
  vendor_name   text,

  n_packages    integer,                -- packages this vendor is PRIMARY on
  n_activities  integer,                -- schedule activities under those packages
  -- ⚠️ Packages where this vendor is only a CO-AWARDEE. Those are NOT in the
  --    figures above: counting a shared package for both co-awardees would
  --    double-count the project. Reported so a low package count is explainable
  --    rather than looking like missing data.
  co_awarded    integer,

  -- Duration-weighted, 0..1. ⚠️ DURATION, not cost — procurement cost is
  -- deliberately kept off Planners schedule rows, so a cost-weighted curve is not
  -- available for every project. Stated here so nobody reads it as value-weighted.
  pct_complete  numeric,
  planned_pct   numeric,                -- where the programme says it should be, at data_date
  spi           numeric,                -- pct_complete / planned_pct
  slip_days     numeric,                -- sum(actual_finish - bl_finish) over finished activities
  n_slipped     integer,
  n_finished    integer,

  -- Need-by adherence. ⚠️ This is PLANNED adherence: there is no actual-delivery
  --    date anywhere in the mirror the Planners app reads, so it compares the
  --    schedule's need-by against our own Target Installation. Calling it
  --    "delivered on time" would be a number nobody could defend.
  needby_late    integer,
  needby_checked integer,

  -- 'improving' | 'flat' | 'deteriorating' — the sign of the last three months of
  -- variance movement, so a recovering vendor and a deteriorating one at the same
  -- SPI do not read identically.
  trend         text,
  -- 'on_track' | 'watch' | 'problem' — thresholded in the Planners app from its
  -- own `schedule_thresholds` table, NOT hard-coded here. Two apps with two sets
  -- of thresholds would disagree about the same vendor.
  status        text,

  -- The monthly curve: [{key,pd,pc,ad,ac}], the same shape the Planners S-curve
  -- module renders, so the two draw the same picture from the same numbers.
  months        jsonb   not null default '[]'::jsonb,

  data_date     date,                   -- the schedule data date the figures are as-of
  pushed_at     timestamptz not null default now(),

  primary key (vendor_id, project_id)
);

create index if not exists idx_pvp_vendor  on planners_vendor_performance (vendor_id);
create index if not exists idx_pvp_project on planners_vendor_performance (project_id);
create index if not exists idx_pvp_status  on planners_vendor_performance (status);

-- ---- Access ---------------------------------------------------------------------
-- Read for any signed-in user (the same audience that can already see a work
-- package's award status). No write policy at all: the push uses the service-role
-- key, which bypasses RLS.
alter table planners_vendor_performance enable row level security;

drop policy if exists pvp_read on planners_vendor_performance;
create policy pvp_read on planners_vendor_performance
  for select to authenticated using (true);

grant select on planners_vendor_performance to authenticated;
-- ⚠️ Deliberately NO grant of insert/update/delete to authenticated or anon.

-- ---- Verify ---------------------------------------------------------------------
--   select count(*) from planners_vendor_performance;          -- 0 until the push runs
--   select polname, cmd from pg_policies
--    where tablename = 'planners_vendor_performance';          -- expect one SELECT policy
--
-- ⚠️ NOTHING APPEARS UNTIL THE PLANNERS SIDE IS DEPLOYED AND RUN:
--     1. run the Planners migrations 2026-08-25-vendor-identity.sql
--        and 2026-08-25-vendor-performance.sql in the PLANNERS project
--     2. supabase functions deploy sync-wpm      --project-ref bgupuqnkqhixpuctyder
--     3. supabase functions deploy push-vendor-perf --project-ref bgupuqnkqhixpuctyder
--     4. Sync from WPM (fills vendor_id on the Planners mirror), then invoke the push
--   Until then the Vendor Management screen says so rather than showing zeroes.
