-- ============================================================================
-- Vendor Accreditation status — Megawide WPM Dashboard
-- ----------------------------------------------------------------------------
-- Run once in the Supabase SQL Editor (production). Idempotent — safe to re-run.
--
-- WHY A SEPARATE COLUMN FROM vendors.status
-- vendors.status is the DIRECTORY WORKFLOW state (pending_review / approved /
-- rejected / inactive) — "has a staff member reviewed this record?". Whether a
-- company is ACCREDITED is a different, orthogonal business fact: an approved
-- directory record can belong to an unaccredited vendor, and a problematic
-- (blacklisted / on-hold) vendor still needs an accurate, reviewed record so
-- officers can SEE that it is problematic. Overloading `status` would have made
-- those states mutually exclusive and lost the review workflow. Hence:
--
--   accreditation        accredited | unaccredited | problematic   (nullable)
--   accreditation_notes  free text — accreditation ref, or WHY problematic
--   accreditation_date   when accredited / last assessed
--
-- NULL = "Not Assessed", deliberately NOT defaulted to 'unaccredited'. The
-- ~1,600 existing rows were auto-derived from work-package vendor names, so
-- stamping them all 'unaccredited' would assert a business fact nobody checked
-- — and would hide exactly the vendors that still need assessing. NULL keeps
-- that gap visible and countable ("Not Assessed" KPI tile in vendors.html).
-- Once the masterdata import has stamped the known vendors, the remaining
-- Not-Assessed rows can be bulk-set with Data Tools → "Mark rest Unaccredited".
--
-- Plain `text` + an application-layer roster (window.ACCREDITATIONS in db.js),
-- NOT an enum/CHECK — same reasoning as projects.group_head: the vocabulary can
-- change without a DB migration, and a value dropped from the roster still
-- displays instead of silently blanking.
-- ============================================================================

alter table vendors add column if not exists accreditation       text;
alter table vendors add column if not exists accreditation_notes text;
alter table vendors add column if not exists accreditation_date  date;

create index if not exists idx_vendors_accreditation on vendors(accreditation);

comment on column vendors.accreditation is
  'Accreditation standing: accredited | unaccredited | problematic. NULL = not assessed. Orthogonal to vendors.status (the review workflow).';

-- ── Vendor self-edit guard: accreditation is STAFF-OWNED ───────────────────
-- Recreated (not just re-run) to pin the three accreditation columns — and
-- vendor_code, the staff-owned SAP/ERP identifier — to their previous values on
-- any UPDATE made by the vendor's own login. Without this a vendor could PATCH
-- their own row via the REST API and self-accredit: RLS lets them update their
-- own vendors row (that is the whole point of vendor-portal.html) and RLS
-- cannot restrict WHICH columns an update touches. The rest of the function is
-- unchanged from MIGRATION_vendor_management.sql.
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
    -- Staff-owned fields — a vendor can never set these about themselves.
    new.accreditation := old.accreditation;
    new.accreditation_notes := old.accreditation_notes;
    new.accreditation_date := old.accreditation_date;
    new.vendor_code := old.vendor_code;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_vendor_edit_guard on vendors;
create trigger trg_vendor_edit_guard before update on vendors
  for each row execute function internal.vendor_edit_guard();
