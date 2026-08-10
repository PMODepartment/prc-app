-- ============================================================================
-- Vendor Management Dashboard — Phase 2a  —  Megawide WPM Dashboard
-- ----------------------------------------------------------------------------
-- Run once in the Supabase SQL Editor (production, PRO tier — needed for
-- Storage used by certification file uploads). Idempotent — safe to re-run.
--
-- Scope (Phase 2a): vendor directory, vendor self-service portal (contact /
-- products / certifications / personnel), staff approval workflow, staff-only
-- reference rates. Deliberately EXCLUDES work_packages.vendor_id and
-- vendor_bids — those are Phase 2b, once vendor data is seeded and stable.
--
-- Flow: staff creates a vendor skeleton (company name + invite email) in
-- vendors.html → the vendor gets a link to vendor-register.html?vendor=<id>
-- → they set a password (Supabase Auth, role='vendor', linked via
-- users.vendor_id) → they land on vendor-portal.html and fill in their own
-- contact/products/certifications → status flips to 'pending_review' →
-- staff approves in vendors.html → vendor becomes visible in the directory.
-- Any edit AFTER approval flips status back to 'pending_review' (trigger),
-- so the live directory always reflects staff-reviewed data.
-- ============================================================================

-- ── VENDORS ───────────────────────────────────────────────────────────────
create table if not exists vendors (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  trade_categories  text[] default '{}',          -- subset of the 10 canonical WP trades
  contact_person    text,
  contact_number    text,
  contact_email     text,
  address           text,
  notes             text,

  status            text not null default 'pending_review'
                      check (status in ('pending_review','approved','inactive','rejected')),

  -- Invite (staff creates the skeleton + invite email; vendor claims it once)
  invite_email      text not null,
  invite_claimed_at timestamptz,

  created_at        timestamptz default now(),
  updated_at        timestamptz default now(),
  created_by        uuid references users(id),
  updated_by        uuid references users(id),
  updated_by_name   text
);

create index if not exists idx_vendors_status on vendors(status);
create index if not exists idx_vendors_invite_email on vendors(lower(invite_email));

-- ── VENDOR PRODUCTS / SERVICES OFFERED ───────────────────────────────────
create table if not exists vendor_products (
  id            uuid primary key default gen_random_uuid(),
  vendor_id     uuid not null references vendors(id) on delete cascade,
  category      text,        -- one of the 10 canonical trades
  description   text not null,
  unit          text,
  notes         text,
  created_at    timestamptz default now()
);
create index if not exists idx_vendor_products_vendor on vendor_products(vendor_id);

-- ── VENDOR CERTIFICATIONS ─────────────────────────────────────────────────
create table if not exists vendor_certifications (
  id             uuid primary key default gen_random_uuid(),
  vendor_id      uuid not null references vendors(id) on delete cascade,
  cert_name      text not null,
  cert_number    text,
  issuing_body   text,
  issue_date     date,
  expiry_date    date,
  file_path      text,        -- Storage object path in the 'vendor-certs' bucket
  notes          text,
  created_at     timestamptz default now()
);
create index if not exists idx_vendor_certs_vendor on vendor_certifications(vendor_id);

-- ── VENDOR PERSONNEL (stakeholder contacts) ──────────────────────────────
create table if not exists vendor_personnel (
  id             uuid primary key default gen_random_uuid(),
  vendor_id      uuid not null references vendors(id) on delete cascade,
  name           text not null,
  role_title     text,        -- e.g. Sales Rep, Project Engineer, Finance Contact
  contact_number text,
  email          text,
  is_primary     boolean default false,
  created_at     timestamptz default now()
);
create index if not exists idx_vendor_personnel_vendor on vendor_personnel(vendor_id);

-- ── VENDOR RATES (staff-only reference data; manual entry in Phase 2a) ──
create table if not exists vendor_rates (
  id               uuid primary key default gen_random_uuid(),
  vendor_id        uuid not null references vendors(id) on delete cascade,
  project_id       text references projects(id),
  trade            text,
  item_description text not null,
  unit             text,
  rate             numeric(18,2),
  currency         text default 'PHP',
  date_quoted      date,
  source           text,     -- quotation | negotiation | awarded contract
  notes            text,
  created_at       timestamptz default now(),
  created_by       uuid references users(id)
);
create index if not exists idx_vendor_rates_vendor on vendor_rates(vendor_id);

-- ── USERS: vendor role + vendor_id link ──────────────────────────────────
alter table users add column if not exists vendor_id uuid references vendors(id);
create index if not exists idx_users_vendor on users(vendor_id);

alter table users drop constraint if exists users_role_check;
alter table users add constraint users_role_check
  check (role in ('super_admin','admin','specialist','manager','user','viewer','viewer_budget','vendor'));

-- ── updated_at triggers (reuse the shared trigger function) ─────────────
drop trigger if exists trg_vendors_updated on vendors;
create trigger trg_vendors_updated before update on vendors
  for each row execute function update_updated_at();

-- ── Vendor self-edit guard: any UPDATE made by the vendor's own login
-- forces status back to 'pending_review', regardless of what they send —
-- so the live directory only ever reflects staff-approved data. Staff
-- updates (any other role) pass through untouched.
create or replace function internal.vendor_edit_guard()
returns trigger language plpgsql security definer
set search_path = public as $$
declare caller_role text;
begin
  select role into caller_role from public.users where id = auth.uid() limit 1;
  if caller_role = 'vendor' then
    new.status := 'pending_review';
    new.invite_email := old.invite_email;          -- vendor can't reassign their own invite
    new.invite_claimed_at := old.invite_claimed_at;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_vendor_edit_guard on vendors;
create trigger trg_vendor_edit_guard before update on vendors
  for each row execute function internal.vendor_edit_guard();

-- ── Claim invite on vendor registration: stamps invite_claimed_at so the
-- same invite link/email can't be used to register a second login.
-- SECURITY DEFINER because the newly-registered vendor has no UPDATE grant
-- on vendors yet at the moment their users row is inserted.
create or replace function internal.claim_vendor_invite()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  if new.role = 'vendor' and new.vendor_id is not null then
    update public.vendors set invite_claimed_at = now()
      where id = new.vendor_id and invite_claimed_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_claim_vendor_invite on users;
create trigger trg_claim_vendor_invite after insert on users
  for each row execute function internal.claim_vendor_invite();

-- ── RLS: new helper — caller's own vendor_id (null for internal staff) ──
create or replace function internal.get_my_vendor_id()
returns uuid language sql security definer stable
set search_path = public as $$
  select vendor_id from public.users where id = auth.uid() limit 1;
$$;
grant execute on function internal.get_my_vendor_id() to authenticated;

alter table vendors               enable row level security;
alter table vendor_products       enable row level security;
alter table vendor_certifications enable row level security;
alter table vendor_personnel      enable row level security;
alter table vendor_rates          enable row level security;

-- ── VENDORS ───────────────────────────────────────────────────────────────
-- Internal staff (every role except 'vendor') see every vendor row (needed
-- for the approval queue). A vendor login sees only their own row.
drop policy if exists "vendors_select" on vendors;
create policy "vendors_select" on vendors
  for select to authenticated
  using (
    internal.get_my_status() = 'approved'
    and (
      internal.get_my_role() <> 'vendor'
      or id = internal.get_my_vendor_id()
    )
  );

-- Only staff (not viewer/viewer_budget/vendor) can create a new vendor
-- skeleton (the invite step).
drop policy if exists "vendors_insert" on vendors;
create policy "vendors_insert" on vendors
  for insert to authenticated
  with check (
    internal.get_my_status() = 'approved'
    and internal.get_my_role() not in ('viewer','viewer_budget','vendor')
  );

-- Staff can update any vendor row (approve/edit/deactivate). A vendor login
-- can update ONLY their own row — the vendor_edit_guard trigger above
-- forces status back to pending_review on any such edit.
drop policy if exists "vendors_update" on vendors;
create policy "vendors_update" on vendors
  for update to authenticated
  using (
    internal.get_my_status() = 'approved'
    and (
      internal.get_my_role() not in ('viewer','viewer_budget','vendor')
      or id = internal.get_my_vendor_id()
    )
  );

-- Only admin/super_admin can delete a vendor record.
drop policy if exists "vendors_delete" on vendors;
create policy "vendors_delete" on vendors
  for delete to authenticated
  using (internal.get_my_role() in ('super_admin','admin'));

-- ── VENDOR CHILD TABLES (products / certifications / personnel) ─────────
-- Same shape for all three: staff full access; vendor login limited to
-- rows under their own vendor_id.
do $$
declare t text;
begin
  foreach t in array array['vendor_products','vendor_certifications','vendor_personnel']
  loop
    execute format('drop policy if exists "%1$s_select" on %1$s', t);
    execute format($f$
      create policy "%1$s_select" on %1$s
        for select to authenticated
        using (
          internal.get_my_status() = 'approved'
          and (
            internal.get_my_role() <> 'vendor'
            or vendor_id = internal.get_my_vendor_id()
          )
        )
    $f$, t);

    execute format('drop policy if exists "%1$s_write" on %1$s', t);
    execute format($f$
      create policy "%1$s_write" on %1$s
        for all to authenticated
        using (
          internal.get_my_status() = 'approved'
          and (
            internal.get_my_role() not in ('viewer','viewer_budget','vendor')
            or vendor_id = internal.get_my_vendor_id()
          )
        )
        with check (
          internal.get_my_status() = 'approved'
          and (
            internal.get_my_role() not in ('viewer','viewer_budget','vendor')
            or vendor_id = internal.get_my_vendor_id()
          )
        )
    $f$, t);
  end loop;
end $$;

-- ── VENDOR RATES — staff-only, money data (never exposed to a vendor login,
-- and hidden from 'viewer' the same way budget is hidden elsewhere in the app;
-- 'viewer_budget' can see it since that role is allowed cost data).
drop policy if exists "vendor_rates_select" on vendor_rates;
create policy "vendor_rates_select" on vendor_rates
  for select to authenticated
  using (
    internal.get_my_status() = 'approved'
    and internal.get_my_role() in ('super_admin','admin','specialist','manager','user','viewer_budget')
  );

drop policy if exists "vendor_rates_write" on vendor_rates;
create policy "vendor_rates_write" on vendor_rates
  for all to authenticated
  using (
    internal.get_my_status() = 'approved'
    and internal.get_my_role() in ('super_admin','admin','specialist','manager','user')
  )
  with check (
    internal.get_my_status() = 'approved'
    and internal.get_my_role() in ('super_admin','admin','specialist','manager','user')
  );

-- ── USERS: tighten users_select so a vendor login only ever sees their own
-- row (internal staff still see everyone, unchanged) — replaces the old
-- "true" blanket policy from supabase-schema.sql.
drop policy if exists "users_select" on users;
create policy "users_select" on users
  for select to authenticated
  using (
    internal.get_my_role() <> 'vendor'
    or id = auth.uid()
  );

-- ── USERS: allow the vendor self-registration insert (claims a staff-issued
-- invite). Distinct from the existing plain "users_insert" policy for
-- ordinary self-registration (role='user'), which is untouched.
drop policy if exists "users_insert_vendor" on users;
create policy "users_insert_vendor" on users
  for insert to authenticated
  with check (
    id = auth.uid()
    and role = 'vendor'
    and status = 'approved'
    and vendor_id is not null
    and exists (
      select 1 from vendors v
      where v.id = vendor_id
        and v.invite_claimed_at is null
        and lower(v.invite_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  );

-- ── USERS: widen users_update's self-update WITH CHECK to also pin
-- vendor_id (a vendor login can't reassign themselves to a different
-- vendor company by patching their own row).
drop policy if exists "users_update" on users;
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
      and vendor_id is not distinct from internal.get_my_vendor_id()
    )
  );

-- ============================================================================
-- STORAGE — certification file uploads (requires PRO tier: the project was
-- transferred to a Pro org in 2026-08 specifically to unlock this).
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('vendor-certs', 'vendor-certs', false)
on conflict (id) do nothing;

-- Path convention: <vendor_id>/<cert_id>_<filename>. RLS is enforced by
-- inspecting the first path segment against the caller's own vendor_id
-- (for a vendor login) or allowing any path for staff.
drop policy if exists "vendor_certs_storage_select" on storage.objects;
create policy "vendor_certs_storage_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'vendor-certs'
    and (
      internal.get_my_role() <> 'vendor'
      or (storage.foldername(name))[1] = internal.get_my_vendor_id()::text
    )
  );

drop policy if exists "vendor_certs_storage_write" on storage.objects;
create policy "vendor_certs_storage_write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'vendor-certs'
    and (
      internal.get_my_role() not in ('viewer','viewer_budget')
      and (
        internal.get_my_role() <> 'vendor'
        or (storage.foldername(name))[1] = internal.get_my_vendor_id()::text
      )
    )
  );

drop policy if exists "vendor_certs_storage_delete" on storage.objects;
create policy "vendor_certs_storage_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'vendor-certs'
    and (
      internal.get_my_role() not in ('viewer','viewer_budget')
      and (
        internal.get_my_role() <> 'vendor'
        or (storage.foldername(name))[1] = internal.get_my_vendor_id()::text
      )
    )
  );

-- ============================================================================
-- After running this migration:
-- 1. Confirm the 'vendor-certs' Storage bucket exists (Storage tab).
-- 2. Staff creates the first vendor skeleton via vendors.html, which sends
--    (manually, for now — no email automation in Phase 2a) the vendor a
--    link: vendor-register.html?vendor=<id>
-- 3. Phase 2b will add work_packages.vendor_id + vendor_bids on top of this.
-- ============================================================================
