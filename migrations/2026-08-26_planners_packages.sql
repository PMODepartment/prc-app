-- CONTRACT PACKAGES from the Planners app -----------------------------------------
-- A project is bought as several contract packages — "Package 1 — Tower 1 and General
-- Requirements", "Package 2 — Towers 2-7". They come off the contract documents, the
-- Planners app owns them, and every other app CONSUMES them: procurement needs to know
-- which lot a work package is bought for, so spend, awards and deliveries can be read
-- per package the way the schedule and the billing already are.
--
-- ⚠️ IT IS A MIRROR, NOT A LIVE READ. This app and the Planners app are SEPARATE
-- Supabase projects (cayjeqeleenizbdzrums vs bgupuqnkqhixpuctyder) and share no
-- tables, so a package cannot be selected across the wire. The Planners
-- `push-packages` Edge Function writes this table with this project's service-role
-- key — exactly the shape planners_need_by already uses, and the mirror image of the
-- Planners app's own wpm_work_packages mirror of this one.
--
-- ⚠️ WRITES ARE SERVICE-ROLE ONLY. No policy grants insert/update/delete to
-- authenticated or anon, so a browser can never invent a contract package. Packages
-- are contractual facts; one being fabricated here and then cited in a claim is the
-- failure this rule prevents.
--
-- ⚠️ THE LINK COLUMN IS OWNED BY THIS APP. work_packages.planners_package_id is set by
-- BUYERS in this app, never by the push — the push only refreshes the list of packages
-- to choose from. One app silently re-filing another team's records is unrecoverable.
--
-- Run in the WPM Supabase SQL editor. Idempotent (re-runnable).
-- ---------------------------------------------------------------------------------

create table if not exists planners_packages (
  -- The Planners uuid, kept as the identity so a rename or a re-code does not orphan
  -- every work package linked to it.
  planners_package_id uuid primary key,
  -- The PLANNERS project id, which is what the push scopes its replace by.
  planners_project_id text not null,
  -- This app's project id (via Cash Flow's existing wpm_project_id mapping), so the
  -- picker can filter to the project the buyer is actually in.
  project_id          text,
  code                text not null,
  name                text not null,
  description         text,
  status              text default 'active',
  sort_order          int  default 0,
  start_date          date,
  end_date            date,
  contract_amount     numeric,
  synced_at           timestamptz default now()
);
create index if not exists planners_packages_project_idx on planners_packages (project_id, sort_order);
create index if not exists planners_packages_src_idx     on planners_packages (planners_project_id);

alter table planners_packages enable row level security;

-- Read-only to every signed-in user of this app; writes come only from the Edge
-- Function's service-role key, which bypasses RLS.
drop policy if exists planners_packages_read on planners_packages;
create policy planners_packages_read on planners_packages
  for select to authenticated using (true);
grant select on planners_packages to authenticated;

-- ---------------------------------------------------------------------------------
-- The link: which contract package is this work package bought for?
-- ---------------------------------------------------------------------------------
-- ⚠️ NO FOREIGN KEY, deliberately. The mirror is refreshed by delete-then-insert
-- scoped to a project, so a FK would either block the refresh or cascade real buyer
-- data away. A package that disappears upstream leaves the id in place and the UI
-- reads it as "(package no longer in Planners)" — visible, and recoverable.
--
-- ⚠️ NULL = not yet assigned, and it must stay a normal state. Most existing work
-- packages predate contract packages; defaulting them to any lot would misreport
-- every package total on day one. No back-fill.
alter table work_packages add column if not exists planners_package_id uuid;
create index if not exists work_packages_planners_package_idx
  on work_packages (planners_package_id);

comment on column work_packages.planners_package_id is
  'Contract package (Planners app) this work package is bought for. Set by buyers in this app; the list of packages is mirrored in by the Planners push-packages function. NULL = not yet assigned.';

-- ---------------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------------
--   select code, name, project_id from planners_packages order by sort_order;
--        -- empty until the Planners app runs: Actions -> Push packages
--   select column_name from information_schema.columns
--    where table_name = 'work_packages' and column_name = 'planners_package_id';   -- expect 1
