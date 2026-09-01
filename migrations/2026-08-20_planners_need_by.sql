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
