-- ============================================================================
-- Vendor self-service: richer company profile, required accreditation
-- documents, and an explicit "request accreditation" queue.
--
-- Run ONCE in the Supabase SQL Editor. Every statement is idempotent and
-- self-contained (no temp tables, no state carried between statements) —
-- the SQL Editor does not run a script as a single transaction.
--
-- Requires: MIGRATION_vendor_management.sql (vendors + internal.get_my_*)
--           MIGRATION_vendor_accreditation.sql (vendors.accreditation)
--
-- WHY THIS EXISTS
--   vendors.status (pending_review/approved/…) was retired from the staff UI
--   in 2026-08 — accreditation is the only standing officers see. That left
--   a vendor with no way to say "I have completed my profile, please assess
--   me", and staff with no queue to work. A vendor edit still flips
--   vendors.status back to 'pending_review' server-side, but nothing reads
--   that column any more, so the signal went nowhere. This migration adds
--   the explicit request instead of resurrecting the old status workflow.
--
-- The fields below come from the procurement team's own accreditation
-- checklist ("KC Steps" in EPC. PROC. Vendor Masterdata):
--   Required documents:   BIR 2303 · Company Profile & Business Permits ·
--                         Scanned copy of an invoice
--   Required information: Terms of Payment · Contact Person · Position ·
--                         Contact Number · Email Address
-- plus the SAP Business-Partner fields the masterdata encoding step needs
-- (TIN, telephone, city, vendor category/group).
-- ============================================================================

-- ── 1. Extra vendor profile columns ─────────────────────────────────────────
-- All nullable and additive; the app's deploy guards strip them and warn if
-- this migration has not been run yet.
alter table public.vendors add column if not exists tin              text;
alter table public.vendors add column if not exists contact_position text;
alter table public.vendors add column if not exists telephone        text;
alter table public.vendors add column if not exists city             text;
alter table public.vendors add column if not exists website          text;
alter table public.vendors add column if not exists payment_terms    text;
alter table public.vendors add column if not exists vendor_category  text;  -- Supplier / Subcon / Services
alter table public.vendors add column if not exists vendor_group     text;  -- SAP vendor group, e.g. "Ready Mix Concrete"

comment on column public.vendors.tin is 'BIR TIN / Federal Tax ID — required for accreditation and SAP masterdata encoding.';
comment on column public.vendors.vendor_category is 'Supplier / Subcon / Services — mirrors the SAP Vendor Type column in the masterdata workbook.';

-- ── 2. Accreditation documents ──────────────────────────────────────────────
-- Files live in the SAME private 'vendor-certs' Storage bucket as
-- certifications; its policies key off the FIRST path segment being the
-- vendor id, so document paths must stay '<vendor_id>/…'.
create table if not exists public.vendor_documents (
  id               uuid primary key default gen_random_uuid(),
  vendor_id        uuid not null references public.vendors(id) on delete cascade,
  doc_type         text not null,   -- bir_2303 | company_profile | business_permit | sample_invoice | other
  file_path        text,            -- Storage object path in 'vendor-certs'
  file_name        text,
  notes            text,
  uploaded_at      timestamptz default now(),
  uploaded_by      uuid,
  uploaded_by_name text
);
create index if not exists vendor_documents_vendor_idx on public.vendor_documents(vendor_id);
alter table public.vendor_documents enable row level security;

-- Same shape as vendor_products/certifications/personnel: staff full access,
-- a vendor login limited to rows under their own vendor_id.
drop policy if exists "vendor_documents_select" on public.vendor_documents;
create policy "vendor_documents_select" on public.vendor_documents
  for select to authenticated
  using (
    internal.get_my_status() = 'approved'
    and (
      internal.get_my_role() <> 'vendor'
      or vendor_id = internal.get_my_vendor_id()
    )
  );

drop policy if exists "vendor_documents_write" on public.vendor_documents;
create policy "vendor_documents_write" on public.vendor_documents
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
  );

-- ── 3. Accreditation requests ───────────────────────────────────────────────
create table if not exists public.vendor_accreditation_requests (
  id              uuid primary key default gen_random_uuid(),
  vendor_id       uuid not null references public.vendors(id) on delete cascade,
  kind            text not null default 'new',      -- new | renewal | update
  status          text not null default 'pending',  -- pending | approved | declined | withdrawn
  message         text,                             -- the vendor's note to procurement
  submitted_at    timestamptz default now(),
  submitted_by    uuid,
  decided_at      timestamptz,
  decided_by      uuid,
  decided_by_name text,
  decision_notes  text,
  constraint vendor_accreditation_requests_status_check
    check (status in ('pending','approved','declined','withdrawn'))
);
create index if not exists vendor_accred_req_vendor_idx on public.vendor_accreditation_requests(vendor_id);
create index if not exists vendor_accred_req_status_idx on public.vendor_accreditation_requests(status);

-- A vendor can only ever have ONE request in flight. Partial unique index, so
-- historical decided rows are unconstrained and the full history is kept.
create unique index if not exists vendor_accred_req_one_pending
  on public.vendor_accreditation_requests(vendor_id)
  where status = 'pending';

alter table public.vendor_accreditation_requests enable row level security;

-- Read: staff see everything; a vendor sees only their own requests.
drop policy if exists "vendor_accred_req_select" on public.vendor_accreditation_requests;
create policy "vendor_accred_req_select" on public.vendor_accreditation_requests
  for select to authenticated
  using (
    internal.get_my_status() = 'approved'
    and (
      internal.get_my_role() <> 'vendor'
      or vendor_id = internal.get_my_vendor_id()
    )
  );

-- Insert: a vendor may raise a request for THEMSELVES; staff may raise one on
-- a vendor's behalf. Read-only roles may not.
drop policy if exists "vendor_accred_req_insert" on public.vendor_accreditation_requests;
create policy "vendor_accred_req_insert" on public.vendor_accreditation_requests
  for insert to authenticated
  with check (
    internal.get_my_status() = 'approved'
    and (
      internal.get_my_role() not in ('viewer','viewer_budget','vendor')
      or vendor_id = internal.get_my_vendor_id()
    )
  );

-- Update: staff decide. A vendor may touch their own row only to withdraw it —
-- enforced by the trigger below, since RLS cannot restrict WHICH columns move.
drop policy if exists "vendor_accred_req_update" on public.vendor_accreditation_requests;
create policy "vendor_accred_req_update" on public.vendor_accreditation_requests
  for update to authenticated
  using (
    internal.get_my_status() = 'approved'
    and (
      internal.get_my_role() not in ('viewer','viewer_budget','vendor')
      or vendor_id = internal.get_my_vendor_id()
    )
  );

drop policy if exists "vendor_accred_req_delete" on public.vendor_accreditation_requests;
create policy "vendor_accred_req_delete" on public.vendor_accreditation_requests
  for delete to authenticated
  using (internal.get_my_role() in ('super_admin','admin'));

-- A vendor must never be able to approve their own accreditation request.
-- RLS grants row access but cannot restrict columns, so pin the decision
-- fields the same way internal.vendor_edit_guard pins the staff-owned
-- columns on vendors. The ONLY transition a vendor may make is
-- pending -> withdrawn on their own row.
create or replace function internal.vendor_request_guard()
returns trigger
language plpgsql
security definer
set search_path = public, internal
as $$
begin
  if internal.get_my_role() = 'vendor' then
    if tg_op = 'INSERT' then
      new.status          := 'pending';
      new.decided_at      := null;
      new.decided_by      := null;
      new.decided_by_name := null;
      new.decision_notes  := null;
    else
      if new.status is distinct from old.status and new.status <> 'withdrawn' then
        new.status := old.status;
      end if;
      new.decided_at      := old.decided_at;
      new.decided_by      := old.decided_by;
      new.decided_by_name := old.decided_by_name;
      new.decision_notes  := old.decision_notes;
      new.vendor_id       := old.vendor_id;
      new.submitted_at    := old.submitted_at;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists vendor_request_guard_trg on public.vendor_accreditation_requests;
create trigger vendor_request_guard_trg
  before insert or update on public.vendor_accreditation_requests
  for each row execute function internal.vendor_request_guard();

-- ── 4. Keep the vendor-owned profile columns vendor-editable ────────────────
-- internal.vendor_edit_guard (MIGRATION_vendor_accreditation.sql) pins the
-- STAFF-owned columns on a vendor self-edit — accreditation*, vendor_code,
-- status, invite_*. The new columns in section 1 are supplied BY the vendor,
-- so they are deliberately NOT pinned and need no change to that trigger.
-- If you add another staff-owned column to vendors, pin it there.

-- ── 5. Sanity check ─────────────────────────────────────────────────────────
select
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='vendors'
       and column_name in ('tin','contact_position','telephone','city','website',
                           'payment_terms','vendor_category','vendor_group'))          as vendor_columns_added,
  (select count(*) from information_schema.tables
     where table_schema='public' and table_name='vendor_documents')                    as vendor_documents_table,
  (select count(*) from information_schema.tables
     where table_schema='public' and table_name='vendor_accreditation_requests')       as requests_table;
-- Expect: 8 | 1 | 1
