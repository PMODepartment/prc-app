-- ═══════════════════════════════════════════════════════════════════════════
-- PENDING MIGRATIONS — consolidated, 2026-09-05
-- Paste the whole thing into the Supabase SQL Editor and run it.
-- ---------------------------------------------------------------------------
-- These are the migrations that had NOT been applied to the production project
-- (cayjeqeleenizbdzrums) as of 2026-09-05. Determined by PROBING THE LIVE
-- SCHEMA for the objects each migration creates — not by reading the notes,
-- which is how two of these came to be missed in the first place.
--
-- ⚠️ THIS IS A CONVENIENCE BUNDLE, NOT A NEW MIGRATION. The three files below
--    remain the canonical ones in migrations/, and all three are idempotent, so
--    running this after they have already been applied is a no-op. Rebuilding a
--    database from scratch still follows migrations/README.md.
--
-- Included, in README run order:
--   #11  2026-07-23_bcb_baselines.sql
--   #28  2026-08-20_planners_need_by.sql
--        2026-09-05_board_view_round_id_fix.sql   (after the board-view files)
--
-- ⚠️ NONE of these touches internal.vendor_edit_guard, so the "consolidated
--    guard must run LAST" rule in the README does not apply and you do NOT need
--    to re-run 2026-09-01_vendor_edit_guard_consolidated.sql afterwards.
--
-- ⚠️ WHY budget_bcb0..2 MATTERS MOST HERE. db.js carries a deploy-safe guard
--    (_isMissingBcbCol / _stripBcb) that drops those columns from a write and
--    lets it report success. So every per-baseline budget entered through the WP
--    form or the review grid has been SILENTLY DISCARDED, with the BCB0/BCB1/
--    BCB2 switcher showing the single approved_budget_bcb figure throughout. The
--    backfill below sets budget_bcb0 from that column, which is the correct
--    starting point — everything imported so far IS the original baseline.
--
-- ⚠️ WHAT THIS CANNOT TELL YOU. Policies, triggers, function BODIES and pure
--    data fixes cannot be probed from outside the database, so the following
--    could not be confirmed either way and are NOT included:
--      2026-06-29_update_status_align_2026 · 2026-07-02_update_remove_partially_awarded
--      2026-07-08_rls_hardening · 2026-07-08_seed_demo_project
--      2026-07-09_update_wpno_strip_prefix · 2026-07-14_contributor_wp_delete
--      2026-08-03_viewer_budget_role · 2026-08-10_vendor_rates_wp_link_fix
--      2026-08-10_vendor_invite_rls_fix · 2026-08-20_vendor_field_ownership
--    Check those with migrations/CHECK_migration_status.sql and each file's own
--    verification SELECT. Every one of them is idempotent and safe to re-run —
--    EXCEPT that re-running any file which defines internal.vendor_edit_guard
--    (see the README) must be followed by the consolidated guard again.
-- ═══════════════════════════════════════════════════════════════════════════



-- ═══════════════════════════════════════════════════════════════════════════
-- 1 of 3 · 2026-07-23_bcb_baselines.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- ─────────────────────────────────────────────────────────────────────────────
-- BCB baselines (BCB0 … BCB2)
-- Run once in the Supabase SQL Editor. Safe to re-run.
--
-- A project's procurement budget is re-baselined over time (BCB0 original,
-- BCB1/BCB2 revisions). A work package can therefore show savings against BCB0
-- while being overbudget against a later baseline. These columns hold the
-- budget AT EACH BASELINE; `approved_budget_bcb` keeps holding the CURRENT one
-- (the newest baseline that has a figure) so every existing query, chart,
-- export and KPI keeps working unchanged.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE work_packages ADD COLUMN IF NOT EXISTS budget_bcb0 numeric(18,2);
ALTER TABLE work_packages ADD COLUMN IF NOT EXISTS budget_bcb1 numeric(18,2);
ALTER TABLE work_packages ADD COLUMN IF NOT EXISTS budget_bcb2 numeric(18,2);

-- Backfill: everything imported so far is the original baseline.
UPDATE work_packages SET budget_bcb0 = approved_budget_bcb
 WHERE budget_bcb0 IS NULL AND approved_budget_bcb IS NOT NULL;

-- Viewers read work packages through wp_view_public, which must never expose money.
-- These are money columns, so they are deliberately NOT added to that view.

-- ═══════════════════════════════════════════════════════════════════════════
-- 2 of 3 · 2026-08-20_planners_need_by.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- Schedule NEED-BY dates from the Planners app ------------------------------------
-- The Planners app's Project Schedule links each activity to the work package that
-- supplies it (project_schedule.work_package = this app's work_packages.wp_no). The
-- earliest start among a package's linked activities is the day work that consumes it
-- begins — its NEED-BY date. Per the PMO, that date is this app's TARGET INSTALLATION.
--
-- This table receives that number so buyers can see, next to their own Target
-- Installation, what the construction schedule actually requires.
--
-- ⚠️ IT IS A SEPARATE TABLE, NOT A WRITE INTO work_packages.target_installation.
-- Target Installation is a procurement-owned field that buyers type and Save in
-- wp-form.html. Having another application silently overwrite it would destroy work
-- with no audit trail and no way to tell a buyer's date from a robot's. The schedule
-- PROPOSES here; the buyer adopts it with one click in the WP form if they agree.
-- Same reason the Planners app mirrors this app instead of reading it live.
--
-- ⚠️ WRITES ARE SERVICE-ROLE ONLY. The Planners `push-need-by` Edge Function holds
-- this project's service key as a server-side secret; no policy grants insert/update
-- to authenticated or anon, so a browser can never fabricate a need-by date.
--
-- Keyed by (project_id, wp_no) — the same key work_packages is unique on, so it joins
-- without needing the Planners app to know this app's uuids.
--
-- Run in the WPM Supabase SQL editor. Idempotent (re-runnable).
-- ---------------------------------------------------------------------------------

create table if not exists planners_need_by (
  project_id            text not null,
  wp_no                 text not null,
  need_by               date,           -- earliest start of the linked activities
  driver_activity_id    text,           -- WHICH activity sets the date (so a buyer can query it)
  driver_activity_name  text,
  linked_activities     integer default 0,
  schedule_data_date    date,           -- the schedule's data date when this was pushed
  synced_at             timestamptz default now(),
  primary key (project_id, wp_no)
);

create index if not exists idx_planners_need_by_proj on planners_need_by(project_id);

-- ⚠️ NO foreign key to work_packages(project_id, wp_no): there is no unique constraint
-- on that pair to reference in every deployment, and more importantly a need-by for a
-- wp_no this app has not created yet (or has renumbered) must still land. An orphan row
-- is a visible data-quality signal; a rejected push is a silent one.

grant select on planners_need_by to authenticated;

alter table planners_need_by enable row level security;

-- READ: any approved user, scoped to their projects exactly like wp_select — except
-- viewers are NOT excluded here. That exclusion exists to keep cost columns out of the
-- REST API, and this table holds no cost, only dates.
drop policy if exists planners_need_by_select on planners_need_by;
create policy planners_need_by_select on planners_need_by
  for select to authenticated
  using (
    internal.get_my_status() = 'approved'
    and (
      internal.get_my_role() in ('super_admin','admin','specialist')
      or project_id = any(internal.get_my_projects())
      or project_id = 'DEMO'
    )
  );

-- No insert/update/delete policy: the Planners push-need-by Edge Function writes with
-- the service role, which bypasses RLS. Adding a write policy here would let any signed-in
-- user invent a need-by date and mislead a buyer into re-planning against it.

-- Sanity check:
--   select * from planners_need_by where project_id = 'SLN101' order by need_by nulls last;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3 of 3 · 2026-09-05_board_view_round_id_fix.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════════════
-- vendor_bid_board_view NEVER GOT round_id. Adding it properly, and fixing the
-- verification that said it had.
-- Run once, in the Supabase SQL Editor, AFTER 2026-09-05_board_view_drop_token.sql.
--
-- ⚠️ ONE MISTAKE IN 2026-09-05_bid_reference_docs.sql, MADE TWICE, AND IT WAS
--    SILENT BOTH TIMES: it asked whether the view had round_id by
--    STRING-MATCHING THE VIEW DEFINITION.
--
--       position('round_id' in src) > 0
--
--    `round_id` appears in that text regardless — in the join:
--       left join public.vendor_bid_rounds r on r.id = i.round_id
--
--    So on the very first run the early-exit guard matched, said "already
--    exposes round_id — nothing to do", and returned. The column was never
--    added. The verification at the end of the file then made the SAME test and
--    agreed. Nothing errored; the report said true; the column did not exist.
--    Its companion check on access_token was right only by luck — that string
--    happens to appear nowhere else in the definition.
--
--    ⇒ NEVER verify a view's columns by string-matching its SQL. Ask
--       information_schema.columns, which is what this file does.
--
-- ⚠️ AND THE WRITE ITSELF WOULD HAVE FAILED TOO, had the guard let it through:
--    it used `create or replace view` to insert a column in the MIDDLE of the
--    select list. A replace may only APPEND — it cannot change the name, type
--    or POSITION of an existing column (42P16). Removing or repositioning one
--    needs DROP + CREATE, which is what this file uses.
--
-- Confirmed live before writing this: the deployed view has 52 columns,
-- access_token correctly absent, round_id absent, everything else intact.
-- Nothing broke — but vendor-portal.html reads the reference pack by round_id,
-- so a vendor could never see the TOR / MPSS pack until this runs.
-- ═══════════════════════════════════════════════════════════════════════════

do $mig$
declare
  src         text;
  cols_before int;
  cols_after  int;
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'vendor_bid_board_view'
                and column_name = 'round_id') then
    raise notice 'round_id is already a column — nothing to do';
    return;
  end if;

  select pg_get_viewdef('public.vendor_bid_board_view'::regclass, true) into src;
  if src is null then
    raise exception 'vendor_bid_board_view not found';
  end if;

  select count(*) into cols_before from information_schema.columns
   where table_schema = 'public' and table_name = 'vendor_bid_board_view';

  -- Insert it beside the other invitation columns. Whatever indentation the
  -- pretty-printer used, exactly one of these matches.
  if position('    i.invited_at,' || chr(10) in src) > 0 then
    src := replace(src, '    i.invited_at,' || chr(10),
                        '    i.invited_at,' || chr(10) || '    i.round_id,' || chr(10));
  elsif position('   i.invited_at,' || chr(10) in src) > 0 then
    src := replace(src, '   i.invited_at,' || chr(10),
                        '   i.invited_at,' || chr(10) || '   i.round_id,' || chr(10));
  elsif position('  i.invited_at,' || chr(10) in src) > 0 then
    src := replace(src, '  i.invited_at,' || chr(10),
                        '  i.invited_at,' || chr(10) || '  i.round_id,' || chr(10));
  else
    raise exception 'could not find the i.invited_at line — add i.round_id by hand';
  end if;

  -- ⚠️ DROP + CREATE. See note 1 above: a replace cannot place a column here.
  --    No CASCADE — a dependency that has appeared since should fail loudly.
  drop view public.vendor_bid_board_view;

  -- ⚠️ security_barrier must be restated: pg_get_viewdef returns only the
  --    SELECT, and losing the barrier would let the planner push a leaky outer
  --    predicate ahead of the vendor scope.
  execute 'create view public.vendor_bid_board_view with (security_barrier = true) as ' || src;

  select count(*) into cols_after from information_schema.columns
   where table_schema = 'public' and table_name = 'vendor_bid_board_view';

  if cols_after <> cols_before + 1 then
    raise exception 'expected exactly one column to be added (% -> %), aborting',
      cols_before, cols_after;
  end if;

  raise notice 'round_id added; % columns', cols_after;
end;
$mig$;

grant select on public.vendor_bid_board_view to authenticated;

-- ── verification — against the COLUMN LIST, not the definition text ───────
select
  (select count(*) = 1 from information_schema.columns
    where table_schema='public' and table_name='vendor_bid_board_view'
      and column_name='round_id')                                        as round_id_is_a_column,
  (select count(*) = 0 from information_schema.columns
    where table_schema='public' and table_name='vendor_bid_board_view'
      and column_name='access_token')                                    as token_is_not_a_column,
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='vendor_bid_board_view')  as total_columns,
  -- nothing lost on the way through
  (select count(*) = 4 from information_schema.columns
    where table_schema='public' and table_name='vendor_bid_board_view'
      and column_name in ('attachment_path','project_status','outcome','wp_no'))
                                                                          as key_columns_kept,
  (select count(*) > 0 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname='public' and c.relname='vendor_bid_board_view'
      and c.reloptions::text like '%security_barrier=true%')             as barrier_kept;


-- ═══════════════════════════════════════════════════════════════════════════
-- 4 of 3 · VERIFICATION — every column must read `t`
-- ═══════════════════════════════════════════════════════════════════════════
with c as (
  select table_name, column_name from information_schema.columns where table_schema = 'public'
), t as (
  select table_name from information_schema.tables where table_schema = 'public'
)
select
  -- #11 bcb_baselines
  (select count(*) = 3 from c
    where table_name = 'work_packages'
      and column_name in ('budget_bcb0','budget_bcb1','budget_bcb2'))        as bcb_columns_present,
  (select count(*) = 0 from public.work_packages
    where budget_bcb0 is null and approved_budget_bcb is not null)           as bcb0_backfilled,
  -- ⚠️ budget_* are MONEY, so they must NOT reach wp_view_public, which is how
  --    the viewer role reads work packages. This asserts the absence.
  (select count(*) = 0 from c
    where table_name = 'wp_view_public'
      and column_name like 'budget_bcb%')                                    as money_kept_out_of_viewer_view,

  -- #28 planners_need_by
  (select count(*) = 1 from t where table_name = 'planners_need_by')         as need_by_table,
  (select count(*) = 1 from c
    where table_name = 'planners_need_by' and column_name = 'need_by')       as need_by_column,
  (select relrowsecurity from pg_class
    where oid = 'public.planners_need_by'::regclass)                         as need_by_rls_on,
  -- no write policy for authenticated: the Planners Edge Function owns the table
  (select count(*) = 0 from pg_policies
    where schemaname = 'public' and tablename = 'planners_need_by'
      and cmd <> 'SELECT')                                                   as need_by_read_only,

  -- board view: round_id in, access_token OUT
  (select count(*) = 1 from c
    where table_name = 'vendor_bid_board_view' and column_name = 'round_id') as board_view_has_round_id,
  (select count(*) = 0 from c
    where table_name = 'vendor_bid_board_view' and column_name = 'access_token')
                                                                             as board_view_token_withheld;
