-- ============================================================================
-- Vendor self-edit guard — CONSOLIDATED, single canonical definition
-- Megawide WPM Dashboard
-- ----------------------------------------------------------------------------
-- Run once in the Supabase SQL Editor (production). Idempotent — safe to
-- re-run. Run it AFTER every other vendor migration.
--
-- ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
-- internal.vendor_edit_guard() was redefined by FIVE separate migrations. The
-- last two branched from DIFFERENT ancestors and were NOT supersets of each
-- other, so whichever one happened to run last silently disabled part of the
-- other:
--
--   1. MIGRATION_vendor_management.sql       status + invite pins
--   2. MIGRATION_vendor_accreditation.sql    + accreditation* + vendor_code
--   3. MIGRATION_vendor_field_ownership.sql  + name / payment_terms /
--                                              vendor_category / vendor_group /
--                                              notes + fill-once TIN
--   4. MIGRATION_vendor_edited_flag.sql      branched from (2):
--                                              + vendor_edited_at stamp,
--                                              WITHOUT (3)'s pins
--   5. MIGRATION_vendor_self_view.sql        branched from (3):
--                                              + server-side updated_by stamp,
--                                              WITHOUT (4)'s vendor_edited_at
--
-- So exactly one of these was broken in any given database, by run order:
--
--   * (4) ran last  ->  a vendor could overwrite their OWN company name,
--                       payment terms, vendor category/group, and staff's
--                       private `notes` — the precise lockdown (3) exists to
--                       enforce. Silent: the write simply succeeded.
--
--   * (5) ran last  ->  vendor_edited_at was never stamped, so a vendor's
--                       edit raised no "Vendor edits" tile/chip in
--                       vendors.html and reached NOBODY. Also silent: the
--                       vendor saw a successful save.
--
-- This file is the UNION of (3) + (4) + (5).
--
-- ⚠️  FROM NOW ON THIS IS THE ONLY PLACE THE FUNCTION IS DEFINED. Change it
--     HERE. Do NOT re-run migrations 1–5 afterwards — each would `create or
--     replace` this body back to its own narrower version and reintroduce
--     exactly the regression above. (Their other statements are still
--     current; it is only their guard block that is superseded.)
--
-- ⚠️  WHEN YOU ADD A STAFF-OWNED COLUMN TO `vendors`, PIN IT IN SECTION 3.
--     RLS decides which ROWS a caller may touch and CANNOT restrict which
--     COLUMNS an UPDATE writes, and a vendor legitimately holds UPDATE on
--     their own row (that is what vendor-portal.html is for) — so a vendor
--     can PATCH any unpinned column straight at the REST API no matter what
--     the portal renders. This trigger is the enforcement; the portal's
--     disabled inputs are only presentation.
--     Keep it in step with vendor-portal.html's STAFF_FIELDS / OVERVIEW_FIELDS
--     and with the column list of `vendor_self_view`.
--
-- No temp tables and no state carried between statements — every statement
-- below stands alone, so the Supabase SQL Editor (which does not run a script
-- as one transaction, and may pool statements across backends) executes this
-- correctly whether you run the file whole or one statement at a time.
--
-- This file owns ONLY the trigger. `vendor_self_view` itself stays owned by
-- MIGRATION_vendor_self_view.sql and is not touched here.
-- ============================================================================


-- ── 1. the flag column this guard stamps ────────────────────────────────────
-- Normally added by MIGRATION_vendor_edited_flag.sql. Added here too because a
-- plpgsql trigger resolves `new.<column>` at RUNTIME: if the column is absent,
-- the guard does not fail now — it fails on EVERY vendor save, which is the
-- worst possible time to find out. Identical DDL to that migration's (nullable
-- timestamptz, no default), so running both is harmless.
--
-- NOT back-filled, deliberately: NULL means "no un-acknowledged self-edit".
-- Back-filling would light up the "Vendor edits" tile for ~1,600 rows no vendor
-- has ever touched — the exact false count that made the first version of that
-- tile (which keyed off status='pending_review') read 516 instead of 0.
alter table vendors add column if not exists vendor_edited_at timestamptz;

comment on column vendors.vendor_edited_at is
  'Set by internal.vendor_edit_guard() on a vendor''s OWN update. NULL = no '
  'un-acknowledged self-edit. Staff clear it via "Mark reviewed" in '
  'vendors.html. Never back-fill: NULL is the correct value for a row no '
  'vendor has edited.';


-- ── 2. pre-flight: every column this guard pins must already exist ──────────
-- Same runtime-resolution hazard as above. Fail LOUDLY and name the migration
-- that owns each missing column, rather than creating them here — several
-- carry an index, a CHECK or a comment that belongs to their own migration,
-- and a bare column created here would diverge from it.
do $$
declare missing text;
begin
  select string_agg(format('    %s  (owned by %s)', req.col, req.mig), E'\n' order by req.col)
    into missing
  from (values
    ('status',              'MIGRATION_vendor_management.sql'),
    ('invite_email',        'MIGRATION_vendor_management.sql'),
    ('invite_claimed_at',   'MIGRATION_vendor_management.sql'),
    ('name',                'MIGRATION_vendor_management.sql'),
    ('notes',               'MIGRATION_vendor_management.sql'),
    ('updated_at',          'MIGRATION_vendor_management.sql'),
    ('updated_by',          'MIGRATION_vendor_management.sql'),
    ('updated_by_name',     'MIGRATION_vendor_management.sql'),
    ('accreditation',       'MIGRATION_vendor_accreditation.sql'),
    ('accreditation_notes', 'MIGRATION_vendor_accreditation.sql'),
    ('accreditation_date',  'MIGRATION_vendor_accreditation.sql'),
    ('vendor_code',         'MIGRATION_vendor_code.sql'),
    ('tin',                 'MIGRATION_vendor_accreditation_requests.sql'),
    ('payment_terms',       'MIGRATION_vendor_accreditation_requests.sql'),
    ('vendor_category',     'MIGRATION_vendor_accreditation_requests.sql'),
    ('vendor_group',        'MIGRATION_vendor_accreditation_requests.sql')
  ) as req(col, mig)
  where not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'vendors'
       and column_name  = req.col
  );

  if missing is not null then
    raise exception E'public.vendors is missing column(s) this guard pins:\n%\n\nRun the migration(s) named above first, then re-run this file. Creating the trigger now would only move the failure to every vendor save.', missing;
  end if;
end $$;


-- ── 3. the guard — union of migrations (3), (4) and (5) ─────────────────────
create or replace function internal.vendor_edit_guard()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  caller_role text;
  caller_name text;
begin
  -- auth.uid() returns the CALLER even inside a SECURITY DEFINER function, so
  -- this self-authorizes. A null uid (service role, SQL editor, a cron job)
  -- finds no users row, leaving caller_role NULL — staff and system updates
  -- therefore pass straight through untouched. Only a vendor's own login is
  -- constrained. `is distinct from` so the NULL case is explicit.
  select role, coalesce(name, email)
    into caller_role, caller_name
    from public.users
   where id = auth.uid()
   limit 1;

  if caller_role is distinct from 'vendor' then
    return new;
  end if;

  -- ── any vendor self-edit flags the row for staff ───────────────────────────
  -- vendor_edited_at is the TRUE self-edit signal that vendors.html reads
  -- (_vendorEdited). `status` is written too but is vestigial: it was the old
  -- signal and read wrong, because 'pending_review' is also the legacy
  -- import/creation default, so it counted hundreds of rows no vendor had ever
  -- touched. Do NOT reintroduce status as the flag.
  new.status           := 'pending_review';
  new.vendor_edited_at := now();

  -- ── invite / login plumbing ────────────────────────────────────────────────
  -- A vendor must not be able to reassign their own invite, or re-open a
  -- claimed one so a second login could be minted against it.
  new.invite_email      := old.invite_email;
  new.invite_claimed_at := old.invite_claimed_at;

  -- ── accreditation: Megawide's judgement ABOUT the vendor ───────────────────
  -- Without this a vendor could PATCH themselves 'accredited' and blank the
  -- reason behind a 'problematic' flag. Decision feedback reaches them through
  -- vendor_accreditation_requests.decision_notes, which is written FOR them.
  new.accreditation       := old.accreditation;
  new.accreditation_notes := old.accreditation_notes;
  new.accreditation_date  := old.accreditation_date;

  -- ── identity, classification, commercial terms ─────────────────────────────
  -- name            : renaming breaks the link to the masterlist and to their
  --                   own WPs, and would let one company take another's name.
  -- vendor_code     : the SAP BP identity — the most reliable dedup key there is.
  -- payment_terms   : a commercial term MEGAWIDE agrees. A vendor could
  --                   otherwise have set themselves to "7 Days".
  -- vendor_category / vendor_group : Megawide's SAP classification, not a
  --                   vendor self-declaration.
  -- notes           : STAFF-INTERNAL remarks about this vendor. The Add Vendor
  --                   modal and the portal once edited the SAME column, so a
  --                   vendor could overwrite what staff had written about them.
  new.vendor_code     := old.vendor_code;
  new.name            := old.name;
  new.payment_terms   := old.payment_terms;
  new.vendor_category := old.vendor_category;
  new.vendor_group    := old.vendor_group;
  new.notes           := old.notes;

  -- ── TIN is FILL-ONCE ──────────────────────────────────────────────────────
  -- Offered while blank (it is on the accreditation checklist, and the vendor
  -- is the one who has it), frozen once on file because it is tied to the BIR
  -- 2303 they uploaded.
  if old.tin is not null and btrim(old.tin) <> '' then
    new.tin := old.tin;
  end if;

  -- ── audit stamp, server-side ───────────────────────────────────────────────
  -- updated_by / updated_by_name are NOT columns of vendor_self_view (they can
  -- carry a Megawide officer's name), so a vendor's client cannot send them.
  -- Stamping here is therefore both necessary AND unforgeable: a vendor edit is
  -- always attributed to that vendor. (updated_at is also set by the sibling
  -- trg_vendors_updated trigger, which fires after this one by name order and
  -- sets the same now() — harmless.)
  new.updated_at      := now();
  new.updated_by      := auth.uid();
  new.updated_by_name := caller_name;

  return new;
end;
$$;


-- ── 4. (re)attach the trigger ──────────────────────────────────────────────
drop trigger if exists trg_vendor_edit_guard on public.vendors;
create trigger trg_vendor_edit_guard
  before update on public.vendors
  for each row execute function internal.vendor_edit_guard();


-- ── 5. the accepted SECURITY DEFINER exception ─────────────────────────────
comment on function internal.vendor_edit_guard() is
  'CANONICAL definition — MIGRATION_vendor_edit_guard_consolidated.sql. '
  'Supersedes the guard blocks in MIGRATION_vendor_management.sql, '
  '_accreditation, _field_ownership, _edited_flag and _self_view; re-running '
  'any of those would regress this body. INTENTIONAL SECURITY DEFINER: it must '
  'read public.users to learn the caller''s role, which RLS would otherwise '
  'hide from a vendor. It self-authorizes via auth.uid() (the caller, even '
  'inside a definer function) and takes no caller-supplied SQL, so it cannot '
  'be misused. Pins every staff-owned vendors column against a direct REST '
  'PATCH by the vendor''s own login, stamps vendor_edited_at so staff see the '
  'edit, and stamps the audit trail server-side so it cannot be forged. '
  'ADD ANY NEW STAFF-OWNED COLUMN TO THIS FUNCTION.';


-- ── 6. verification — every column below must read `t` ─────────────────────
-- Run this on its own afterwards if you executed the file statement by
-- statement. Anything reading `f` means the consolidation did not take, or an
-- older migration has been re-run on top of it.
select
  (select count(*) = 1
     from pg_trigger t
     join pg_class c on c.oid = t.tgrelid
     join pg_namespace tn on tn.oid = c.relnamespace
    where tn.nspname = 'public'
      and c.relname  = 'vendors'
      and t.tgname   = 'trg_vendor_edit_guard'
      and not t.tgisinternal
      and t.tgenabled = 'O')                       as trigger_installed_and_enabled,
  p.prosrc like '%new.vendor_edited_at%'           as flags_vendor_edits,
  p.prosrc like '%new.name%'                       as pins_name,
  p.prosrc like '%new.payment_terms%'              as pins_payment_terms,
  p.prosrc like '%new.vendor_category%'            as pins_vendor_category,
  p.prosrc like '%new.vendor_group%'               as pins_vendor_group,
  p.prosrc like '%new.notes%'                      as pins_staff_notes,
  p.prosrc like '%new.vendor_code%'                as pins_vendor_code,
  p.prosrc like '%new.accreditation%'              as pins_accreditation,
  p.prosrc like '%new.invite_email%'               as pins_invite,
  p.prosrc like '%btrim(old.tin)%'                 as tin_fill_once,
  p.prosrc like '%new.updated_by_name%'            as stamps_audit_server_side,
  p.prosrc like '%is distinct from%'               as staff_updates_pass_through,
  p.prosecdef                                      as is_security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'internal'
  and p.proname = 'vendor_edit_guard';
