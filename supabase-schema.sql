-- ============================================================
-- Megawide EPC Procurement Dashboard — Supabase Schema
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ── PROJECTS ──────────────────────────────────────────────────
create table if not exists projects (
  id          text primary key,           -- e.g. 'AVR101'
  name        text not null,
  location    text,
  description text,
  status      text default 'active',      -- active | completed | on_hold
  budget_bcb  numeric(18,2),
  start_date  date,
  end_date    date,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ── USERS (extends Supabase auth.users) ──────────────────────
create table if not exists users (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text,
  email       text unique not null,
  role        text not null default 'user'   -- super_admin | admin | specialist | manager | user | viewer
                check (role in ('super_admin','admin','specialist','manager','user','viewer')),
  status      text not null default 'pending'  -- pending | approved | rejected
                check (status in ('pending','approved','rejected')),
  projects    text[] default '{}',            -- array of project IDs assigned to user
  last_login  timestamptz,                     -- stamped by auth.js / login.html on each sign-in (activity tracking)
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ── WORK PACKAGES ─────────────────────────────────────────────
create table if not exists work_packages (
  id                    uuid primary key default uuid_generate_v4(),

  -- Identity
  project_id            text references projects(id) on delete cascade,
  wp_no                 text not null,
  cost_code             text,
  description           text not null,
  detailed_description  text,

  -- Classification
  zone                  text,
  trade                 text,
  type_of_service       text,
  type_of_procurement   text,
  type_of_contract      text,
  proposed_vendors      text,

  -- Procurement Schedule
  lead_time             integer,
  awarding_date         date,
  actual_awarding_date  date,
  awarding_lead_time    integer generated always as (
                          case when actual_awarding_date is not null and awarding_date is not null
                          then actual_awarding_date - awarding_date else null end
                        ) stored,
  target_delivery       date,
  target_installation   date,
  target_completion     date,

  -- Procurement Status
  procurement_status    text default 'Not Started',  -- Not Started | Sourcing | Solicitation | Evaluation | Negotiation | Awarded
  award_status          text default 'Not Yet Awarded',  -- Not Yet Awarded | Partially Awarded | Awarded
  delivery_status       text default 'Not Awarded',  -- Not Awarded | Awarded | Detailed Drawings | Production | In-Transit Delivery | Installation | Delivered | Not Installed | DP Processing
  awarding_status       text,   -- DUE | NOT DUE
  purchase_request      text,   -- WITH PR | WITHOUT PR
  responsible_team      text,
  contractor            text,
  po_jo_count           integer default 0,
  po_jo_numbers         text,

  -- Budget & Contract
  approved_budget_bcb   numeric(18,2),
  awarded_cost          numeric(18,2),
  additionals           numeric(18,2) default 0,
  total_awarded         numeric(18,2) generated always as (
                          coalesce(awarded_cost,0) + coalesce(additionals,0)
                        ) stored,
  variance              numeric(18,2) generated always as (
                          case when approved_budget_bcb is not null and awarded_cost is not null
                          then approved_budget_bcb - (coalesce(awarded_cost,0) + coalesce(additionals,0))
                          else null end
                        ) stored,

  -- Approval Matrix
  approver              text,             -- Approver initials/name
  support_team          text,             -- Support person initials/name

  -- Insurance Bonds
  surety_bond           text default 'No',       -- Yes | No
  performance_bond      text default 'No',       -- Yes | No
  warranty_bond         text default 'No',       -- Yes | No

  -- Material / Subcon Submittals
  requires_approval     boolean default false,
  approver_name         text,
  approval_date         date,
  submittal_document_type text,           -- Methodology | Technical Data Sheet | Sample | Mock-up | Swatch Board
  submittal_type        text default 'Not Required',   -- Not Required | Submitted | Approved

  -- Payment Terms
  payment_terms_days    integer,          -- e.g. 7 | 15 | 30 | 45 | 60
  dp_percent            numeric(5,4),     -- e.g. 0.15 = 15%
  dp_terms              text,             -- e.g. One-time
  dp_notes              text,             -- e.g. No DP | Progress Billing | 15% DP, 30 Days
  dp_release_date       date,
  dp_amount             numeric(18,2),
  retention_percent     numeric(5,4),     -- e.g. 0.10 = 10%
  retention_amount      numeric(18,2),
  retention_period      text,

  -- Review workflow
  review_status         text default 'approved'  -- approved | pending_review | rejected
                          check (review_status in ('approved','pending_review','rejected')),
  review_notes          text,
  assigned_officer      uuid references users(id),

  -- Remarks
  remarks               text,

  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

-- ── CLAIMS REGISTER ──────────────────────────────────────────
create table if not exists claims (
  id                uuid primary key default gen_random_uuid(),
  project_id        text not null references projects(id) on delete cascade,

  claim_no          text,           -- e.g. CLM-001
  claim_type        text not null,  -- Extension of Time (EOT) | Change Order
  party             text not null,  -- Client | Vendor
  description       text not null,
  wp_no             text,           -- optional link to work package
  contractor        text,           -- vendor/contractor name

  date_filed        date,
  amount_claimed    numeric(18,2),
  basis             text,           -- basis/grounds for claim

  status            text default 'Draft',  -- Draft | Filed | Under Review | Approved | Partially Approved | Rejected | Withdrawn
  date_resolved     date,
  approved_amount   numeric(18,2),

  remarks           text,

  -- Review workflow (same as WPs)
  review_status     text default 'pending_review'
                      check (review_status in ('pending_review','approved','rejected')),
  review_notes      text,
  submitted_by      uuid references users(id),

  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create index if not exists idx_claims_project on claims(project_id);
create index if not exists idx_claims_review on claims(review_status);
create index if not exists idx_claims_type on claims(claim_type);
create index if not exists idx_claims_party on claims(party);

create trigger trg_claims_updated before update on claims
  for each row execute function update_updated_at();

-- ── INDEXES for fast dashboard queries ───────────────────────
create index if not exists idx_wp_project on work_packages(project_id);
create index if not exists idx_wp_award_status on work_packages(award_status);
create index if not exists idx_wp_trade on work_packages(trade);
create index if not exists idx_wp_zone on work_packages(zone);
create index if not exists idx_wp_review on work_packages(review_status);
create index if not exists idx_users_status on users(status);
create index if not exists idx_users_role on users(role);

-- ── UPDATED_AT trigger ────────────────────────────────────────
create or replace function update_updated_at()
returns trigger language plpgsql
set search_path = public
as $$
begin new.updated_at = now(); return new; end; $$;

create trigger trg_wp_updated before update on work_packages
  for each row execute function update_updated_at();
create trigger trg_users_updated before update on users
  for each row execute function update_updated_at();
create trigger trg_projects_updated before update on projects
  for each row execute function update_updated_at();

-- ── ROW LEVEL SECURITY ────────────────────────────────────────
alter table projects       enable row level security;
alter table users          enable row level security;
alter table work_packages  enable row level security;
alter table claims         enable row level security;

-- ── Private schema for RLS helpers (not exposed to PostgREST/anon) ───────────
-- Avoids "Public Can Execute SECURITY DEFINER Function" warnings.
create schema if not exists internal;
grant usage on schema internal to authenticated;

create or replace function internal.get_my_role()
returns text language sql security definer stable
set search_path = public as $$
  select role from public.users where id = auth.uid() limit 1;
$$;

create or replace function internal.get_my_status()
returns text language sql security definer stable
set search_path = public as $$
  select status from public.users where id = auth.uid() limit 1;
$$;

create or replace function internal.get_my_projects()
returns text[] language sql security definer stable
set search_path = public as $$
  select coalesce(projects, '{}') from public.users where id = auth.uid() limit 1;
$$;

grant execute on function internal.get_my_role()     to authenticated;
grant execute on function internal.get_my_status()   to authenticated;
grant execute on function internal.get_my_projects() to authenticated;

-- ── PROJECTS ──────────────────────────────────────────────────
-- Any approved authenticated user can read projects
create policy "projects_select" on projects
  for select to authenticated
  using (internal.get_my_status() = 'approved');

-- super_admin and admin can create/update/delete projects
create policy "projects_write" on projects
  for all to authenticated
  using (internal.get_my_role() in ('super_admin','admin'))
  with check (internal.get_my_role() in ('super_admin','admin'));

-- ── USERS ─────────────────────────────────────────────────────
-- Any authenticated user can read all users (needed for dropdowns, user management)
create policy "users_select" on users
  for select to authenticated
  using (true);

-- Own row insert only (registration flow) — a registrant may ONLY create a
-- plain pending user; role/status are pinned server-side so the client can't
-- self-register as an approved admin.
create policy "users_insert" on users
  for insert to authenticated
  with check (
    id = auth.uid()
    and role = 'user'
    and status = 'pending'
  );

-- Own row update (last_login, name…) OR admin/super_admin (approvals, role changes).
-- The WITH CHECK stops self-elevation: a self-update must leave role/status/projects
-- unchanged (compared to the current stored values); only admins may change them.
create policy "users_update" on users
  for update to authenticated
  using (
    id = auth.uid()
    or internal.get_my_role() in ('super_admin','admin')
  )
  with check (
    internal.get_my_role() in ('super_admin','admin')
    or (
      id = auth.uid()
      and role = internal.get_my_role()
      and status = internal.get_my_status()
      and coalesce(projects, '{}') = internal.get_my_projects()
    )
  );

-- ── WORK PACKAGES ─────────────────────────────────────────────
-- SELECT: super_admin/admin/specialist see all; others see only assigned projects.
-- VIEWERS are blocked from the base table (they read the cost-free wp_view_public
-- view instead — see below) so cost columns can't be pulled via the REST API.
create policy "wp_select" on work_packages
  for select to authenticated
  using (
    internal.get_my_status() = 'approved'
    and internal.get_my_role() <> 'viewer'
    and (
      internal.get_my_role() in ('super_admin','admin','specialist')
      or project_id = any(internal.get_my_projects())
    )
  );

-- SELECT (DEMO): the read-only sandbox is readable by every approved user
-- (OR'd with wp_select above — only widens read access to project_id='DEMO')
create policy "wp_select_demo" on work_packages
  for select to authenticated
  using (
    internal.get_my_status() = 'approved'
    and project_id = 'DEMO'
  );

-- INSERT: super_admin/admin anywhere; specialist/manager/user only on their
-- assigned projects (specialist VIEWS all but EDITS assigned-only — P1).
create policy "wp_insert" on work_packages
  for insert to authenticated
  with check (
    internal.get_my_status() = 'approved'
    and internal.get_my_role() <> 'viewer'
    and (
      internal.get_my_role() in ('super_admin','admin')
      or project_id = any(internal.get_my_projects())
    )
  );

-- UPDATE: same scope as insert — specialist limited to assigned projects.
create policy "wp_update" on work_packages
  for update to authenticated
  using (
    internal.get_my_status() = 'approved'
    and internal.get_my_role() <> 'viewer'
    and (
      internal.get_my_role() in ('super_admin','admin')
      or project_id = any(internal.get_my_projects())
    )
  );

-- DELETE: super_admin/admin anywhere; specialist/manager/user only on their
-- assigned projects (same edit scope as insert/update). Lets contributors run a
-- full Replace import (delete-then-insert) on projects they own. Viewer denied.
create policy "wp_delete" on work_packages
  for delete to authenticated
  using (
    internal.get_my_status() = 'approved'
    and internal.get_my_role() <> 'viewer'
    and (
      internal.get_my_role() in ('super_admin','admin')
      or project_id = any(internal.get_my_projects())
    )
  );

-- Cost-free, security-definer view for VIEWERS (who are denied on the base table
-- above). Runs as owner so it bypasses the caller's RLS — therefore it re-implements
-- the row scope in its WHERE and OMITS every money column (approved_budget_bcb,
-- awarded_cost, additionals, total_awarded, variance, dp_percent, dp_amount,
-- retention_percent, retention_amount). Non-viewers read the base table directly;
-- the client picks the relation by role (db.js _wpRel()).
-- MAINTENANCE: when you ADD a work_packages column, add it here too — non-cost only.
create or replace view wp_view_public as
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
  from work_packages wp
  where internal.get_my_status() = 'approved'
    and (
      internal.get_my_role() in ('super_admin','admin','specialist')
      or wp.project_id = any(internal.get_my_projects())
      or wp.project_id = 'DEMO'
    );

grant select on wp_view_public to authenticated;

-- ── CLAIMS ────────────────────────────────────────────────────
create policy "claims_select" on claims
  for select to authenticated
  using (
    internal.get_my_status() = 'approved'
    and (
      internal.get_my_role() in ('super_admin','admin','specialist')
      or project_id = any(internal.get_my_projects())
    )
  );

create policy "claims_insert" on claims
  for insert to authenticated
  with check (
    internal.get_my_status() = 'approved'
    and internal.get_my_role() <> 'viewer'
    and (
      internal.get_my_role() in ('super_admin','admin')
      or project_id = any(internal.get_my_projects())
    )
  );

create policy "claims_update" on claims
  for update to authenticated
  using (
    internal.get_my_status() = 'approved'
    and internal.get_my_role() <> 'viewer'
    and (
      internal.get_my_role() in ('super_admin','admin')
      or project_id = any(internal.get_my_projects())
    )
  );

create policy "claims_delete" on claims
  for delete to authenticated
  using (internal.get_my_role() = 'super_admin');

-- ── SEED: insert the AVR101 project ──────────────────────────
insert into projects (id, name, location, description, status)
values ('AVR101', 'AVR101 — Avesta Residences (Gen Req & Tower 1)', 'Quezon City', 'Avesta Residences Tower 1 EPC procurement', 'active')
on conflict (id) do nothing;

-- ============================================================
-- After running this schema:
-- 1. Go to Authentication → Email Templates → customize if needed
-- 2. Run the data migration script (seed-supabase.js) to load WP data
-- 3. Manually create the first super_admin user via the Dashboard
--    or via: UPDATE users SET role='super_admin' WHERE email='fmlozano@megawide.com.ph';
-- ============================================================
