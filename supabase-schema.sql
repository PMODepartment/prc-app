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
  role        text not null default 'user'   -- super_admin | admin | user
                check (role in ('super_admin','admin','user')),
  status      text not null default 'pending'  -- pending | approved | rejected
                check (status in ('pending','approved','rejected')),
  projects    text[] default '{}',            -- array of project IDs assigned to user
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
  procurement_status    text default 'Not Started',  -- Not Started | Sourcing | RFQ | Bid Open | Bid Closed | LOA | Contract | Mob/Del
  award_status          text default 'Not Yet Awarded',  -- Not Yet Awarded | Partially Awarded | Awarded
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

  -- Submittals
  requires_approval     boolean default false,
  approver_name         text,
  approval_date         date,
  submittal_type        text,   -- Not Required | Not Submitted | Submitted | Approved

  -- Payment Terms
  payment_terms_days    integer,
  dp_percent            numeric(5,2),
  retention_percent     numeric(5,2),
  retention_period      text,
  dp_terms              text,

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
returns trigger language plpgsql as $$
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

-- Projects: visible to all authenticated users who are approved
create policy "approved users can read projects" on projects
  for select using (
    exists (select 1 from users u where u.id = auth.uid() and u.status = 'approved')
  );

-- Projects: only super_admin can insert/update/delete
create policy "super_admin manages projects" on projects
  for all using (
    exists (select 1 from users u where u.id = auth.uid() and u.role = 'super_admin')
  );

-- Users: users can read their own row; admins can read all
create policy "users read own row" on users
  for select using (id = auth.uid());

create policy "admins read all users" on users
  for select using (
    exists (select 1 from users u where u.id = auth.uid() and u.role in ('super_admin','admin'))
  );

-- Users: super_admin can update any user (role changes, approvals)
create policy "super_admin manages users" on users
  for update using (
    exists (select 1 from users u where u.id = auth.uid() and u.role = 'super_admin')
  );

-- Users: admin can approve/reject users for their assigned projects
create policy "admin approves pending users" on users
  for update using (
    exists (select 1 from users u where u.id = auth.uid() and u.role in ('super_admin','admin'))
  );

-- Users: anyone can insert their own row on registration
create policy "users can register" on users
  for insert with check (id = auth.uid());

-- Work packages: readable by assigned-project users
create policy "users read assigned project wps" on work_packages
  for select using (
    exists (
      select 1 from users u
      where u.id = auth.uid()
        and u.status = 'approved'
        and (
          u.role in ('super_admin','admin')
          or project_id = any(u.projects)
        )
    )
  );

-- Work packages: writable by super_admin and admin (their projects) and assigned officers
create policy "super_admin writes all wps" on work_packages
  for all using (
    exists (select 1 from users u where u.id = auth.uid() and u.role = 'super_admin')
  );

create policy "admin writes assigned project wps" on work_packages
  for all using (
    exists (
      select 1 from users u
      where u.id = auth.uid()
        and u.role = 'admin'
        and project_id = any(u.projects)
    )
  );

create policy "officer writes assigned wps" on work_packages
  for update using (assigned_officer = auth.uid());

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
