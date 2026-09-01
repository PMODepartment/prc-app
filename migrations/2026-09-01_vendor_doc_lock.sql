-- ============================================================================
-- Freeze the documents an approved accreditation rests on
-- Megawide WPM Dashboard
-- ----------------------------------------------------------------------------
-- Run ONCE in the Supabase SQL Editor (production). Idempotent — safe to re-run.
-- No temp tables and no cross-statement state.
--
-- ⚠️ RUN AFTER `2026-09-01_vendor_child_soft_delete.sql` (needs `archived_at`)
-- AND `2026-09-01_vendor_child_audit_trail.sql`. It sorts after both, so for
-- once filename order is right — but see migrations/README.md, which is
-- authoritative.
--
-- WHY
-- ---
-- Step 2 of the vendor-data hardening. A vendor holds UPDATE on their own
-- `vendor_documents` rows, so after being accredited they can overwrite or
-- archive the very BIR 2303 / business permit / invoice the approval was
-- granted on. The accreditation would then stand on nothing, and — worse —
-- there was no way to even notice, because **nothing recorded which documents
-- an approval relied on**: `vendor_documents` has no request link and
-- `vendor_accreditation_requests` has no document list.
--
-- So this migration does two things that only make sense together:
--   1. SNAPSHOTS the evidence at the moment of approval (which documents, which
--      request, who approved, when).
--   2. FREEZES those rows against the vendor.
--
-- SCOPE: `vendor_documents` ONLY. `window.accredReadiness()` builds the
-- checklist from ACCRED_DOC_TYPES over that table plus vendor profile fields;
-- `vendor_certifications` is NOT part of accreditation, so it is deliberately
-- untouched. The profile fields are also untouched: contact details and address
-- are current-state that a vendor should keep updating, not evidence.
--
-- ⚠️ ENFORCED BY TRIGGER, NOT BY THE UI. RLS grants a vendor UPDATE on their
-- own rows and cannot restrict WHICH COLUMNS or WHICH ROWS within that grant,
-- so a vendor could PATCH a locked document straight at the REST API whatever
-- vendor-portal.html renders. The trigger is the enforcement; the portal's
-- hidden button is presentation.
-- ============================================================================

-- ── 1. Lock columns ─────────────────────────────────────────────────────────
-- `locked_request_id` is ON DELETE SET NULL on purpose: if a request row is
-- ever deleted the document is STILL evidence and must stay locked — it just
-- loses the pointer to which approval it supported.
do $$
begin
  if to_regclass('public.vendor_documents') is null then
    raise exception 'vendor_documents does not exist — run 2026-08-20_vendor_accreditation_requests.sql first';
  end if;
  if to_regclass('public.vendor_accreditation_requests') is null then
    raise exception 'vendor_accreditation_requests does not exist — run 2026-08-20_vendor_accreditation_requests.sql first';
  end if;
end $$;

alter table public.vendor_documents add column if not exists locked_at         timestamptz;
alter table public.vendor_documents add column if not exists locked_by         uuid;
alter table public.vendor_documents add column if not exists locked_by_name    text;
alter table public.vendor_documents add column if not exists locked_request_id uuid;

do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_schema = 'public' and constraint_name = 'vendor_documents_locked_request_fk')
  then
    alter table public.vendor_documents
      add constraint vendor_documents_locked_request_fk
      foreign key (locked_request_id)
      references public.vendor_accreditation_requests(id) on delete set null;
  end if;
end $$;

create index if not exists vendor_documents_locked_idx
  on public.vendor_documents (vendor_id) where locked_at is not null;

-- ── 2. The snapshot ─────────────────────────────────────────────────────────
-- Locks every LIVE, not-yet-locked document for a vendor.
-- `locked_at is null` makes it idempotent AND makes FIRST LOCK WIN, so on a
-- renewal each document still traces to the approval it originally supported,
-- and documents uploaded since are picked up by the new approval.
create or replace function internal.lock_vendor_evidence(p_vendor uuid, p_request uuid)
returns integer language plpgsql security definer
set search_path = public as $$
declare actor uuid; actor_name text; n integer;
begin
  actor := auth.uid();
  if actor is not null then
    select coalesce(u.name, u.email) into actor_name from public.users u where u.id = actor;
  end if;
  update public.vendor_documents
     set locked_at         = now(),
         locked_by         = actor,
         locked_by_name    = actor_name,
         locked_request_id = coalesce(p_request, locked_request_id)
   where vendor_id = p_vendor
     and archived_at is null
     and locked_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

comment on function internal.lock_vendor_evidence(uuid, uuid) is
  'INTENTIONAL SECURITY DEFINER. Stamps the accreditation lock on a vendor''s '
  'live documents. Definer so it can resolve the actor''s display name from '
  'public.users (a vendor login sees only its own row) and so the lock applies '
  'regardless of which staff path triggered the approval. Only ever called from '
  'the two AFTER-UPDATE triggers below.';

-- ── 3. Fire it on BOTH routes to "accredited" ───────────────────────────────
-- (a) a request being approved, and (b) staff setting the standing directly
-- (the detail form, the grid, or bulkSetAccreditation) — which is by far the
-- commoner path today and would otherwise never lock anything.
create or replace function internal.lock_evidence_on_request()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  if new.status = 'approved' and coalesce(old.status, '') is distinct from 'approved' then
    perform internal.lock_vendor_evidence(new.vendor_id, new.id);
  end if;
  return new;
end $$;

create or replace function internal.lock_evidence_on_accredit()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  if new.accreditation = 'accredited' and coalesce(old.accreditation, '') is distinct from 'accredited' then
    perform internal.lock_vendor_evidence(new.id, null);
  end if;
  return new;
end $$;

drop trigger if exists trg_lock_evidence_on_request on public.vendor_accreditation_requests;
create trigger trg_lock_evidence_on_request
  after update on public.vendor_accreditation_requests
  for each row execute function internal.lock_evidence_on_request();

drop trigger if exists trg_lock_evidence_on_accredit on public.vendors;
create trigger trg_lock_evidence_on_accredit
  after update on public.vendors
  for each row execute function internal.lock_evidence_on_accredit();

-- ── 4. The freeze ───────────────────────────────────────────────────────────
-- ⚠️ RAISES rather than silently pinning the old values, unlike
-- internal.vendor_edit_guard. That guard covers a MIXED row (some columns the
-- vendor owns, some staff own), so pinning is the only sensible outcome. Here
-- the WHOLE ROW is frozen, so a silent no-op would leave the vendor believing
-- they had replaced a document when they had not. Telling them is safer.
--
-- Archiving is an UPDATE, so this blocks that too — which is the point: a
-- vendor must not be able to make approved evidence disappear.
create or replace function internal.vendor_doc_lock_guard()
returns trigger language plpgsql security definer
set search_path = public as $$
declare caller_role text;
begin
  select u.role into caller_role from public.users u where u.id = auth.uid();
  -- Staff, service role and the SQL editor (auth.uid() NULL → no users row →
  -- NULL role) pass straight through. Only a vendor login is constrained.
  if caller_role is distinct from 'vendor' then
    return new;
  end if;
  if old.locked_at is not null then
    raise exception
      'This document is part of an approved accreditation and cannot be changed or removed.'
      using errcode = '42501',
            hint = 'Upload a replacement document instead — Megawide Procurement will review it.';
  end if;
  return new;
end $$;

comment on function internal.vendor_doc_lock_guard() is
  'INTENTIONAL SECURITY DEFINER. Blocks a vendor login from updating or '
  'archiving a vendor_documents row that an approved accreditation rests on. '
  'Definer to read the caller''s role from public.users. RLS cannot express '
  'this: it grants a vendor UPDATE on their own rows and cannot restrict which '
  'of those rows or columns the statement touches.';

drop trigger if exists trg_vendor_doc_lock_guard on public.vendor_documents;
create trigger trg_vendor_doc_lock_guard
  before update on public.vendor_documents
  for each row execute function internal.vendor_doc_lock_guard();

-- ── 5. Back-fill: already-accredited vendors ────────────────────────────────
-- The triggers only fire on a TRANSITION. 500-odd vendors were stamped
-- 'accredited' by the one-time SQL seeds and would otherwise never lock. Their
-- live documents are locked here with a NULL actor and NULL request, which is
-- honest: nobody clicked approve, and we cannot say who did.
update public.vendor_documents d
   set locked_at = now()
  from public.vendors v
 where d.vendor_id = v.id
   and v.accreditation = 'accredited'
   and d.archived_at is null
   and d.locked_at is null;

-- ── 6. Verification — EVERY column must read true ───────────────────────────
select
  (select count(*) = 4 from information_schema.columns
     where table_schema='public' and table_name='vendor_documents'
       and column_name in ('locked_at','locked_by','locked_by_name','locked_request_id'))  as lock_cols_present,
  (select count(*) = 1 from pg_trigger
     where tgname='trg_vendor_doc_lock_guard' and not tgisinternal)                        as freeze_trigger_installed,
  (select count(*) = 1 from pg_trigger
     where tgname='trg_lock_evidence_on_request' and not tgisinternal)                     as request_trigger_installed,
  (select count(*) = 1 from pg_trigger
     where tgname='trg_lock_evidence_on_accredit' and not tgisinternal)                    as accredit_trigger_installed,
  (select bool_and(prosecdef) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='internal'
       and p.proname in ('lock_vendor_evidence','lock_evidence_on_request',
                         'lock_evidence_on_accredit','vendor_doc_lock_guard'))             as all_security_definer,
  (select count(*) = 0 from public.vendor_documents d join public.vendors v on v.id=d.vendor_id
     where v.accreditation='accredited' and d.archived_at is null and d.locked_at is null) as accredited_evidence_all_locked;
