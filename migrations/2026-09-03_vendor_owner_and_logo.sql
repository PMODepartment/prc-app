-- ============================================================================
-- Vendor owner details + company logo — Megawide WPM Dashboard
-- ----------------------------------------------------------------------------
-- Run once in the Supabase SQL Editor (production). Idempotent — safe to re-run.
--
-- WHY
--   1. The accreditation email Procurement actually sends asks for "Owner" and
--      "Contact # of Owner" under Required Information, but the app stored
--      neither — so the in-app checklist (window.accredReadiness) could never
--      match the document staff were chasing over email. Now it can.
--   2. The vendor detail page shows the company logo, which needs somewhere to
--      remember it.
--
-- ⚠️ ALL THREE ARE VENDOR-OWNED, so they must be listed in vendor_self_view or
--    the portal renders boxes that silently never save (removing a vendor's
--    SELECT on `vendors` also breaks their UPDATE — an UPDATE has to FIND its
--    row and Postgres applies the SELECT policies to the rows it reads; that
--    exact mistake once made every vendor Save report success and change
--    nothing). They are deliberately NOT pinned in internal.vendor_edit_guard:
--    who owns the company and how to reach them is the vendor's own
--    information, exactly like contact_person, and the logo is their asset.
--
-- No temp tables and no state carried between statements — the Supabase SQL
-- Editor does not run a script as one transaction, so every statement below
-- stands alone.
-- ============================================================================


-- ── 1. the columns ──────────────────────────────────────────────────────────
alter table vendors add column if not exists owner_name            text;
alter table vendors add column if not exists owner_contact_number  text;
alter table vendors add column if not exists logo_path             text;

comment on column vendors.owner_name is
  'Owner / proprietor of the vendor company. Asked for under "Required '
  'Information" in the accreditation email, and part of the accreditation '
  'readiness checklist (window.accredReadiness). Vendor-owned.';
comment on column vendors.owner_contact_number is
  'Direct contact number for the owner, distinct from contact_number (the '
  'day-to-day contact person). Vendor-owned.';
comment on column vendors.logo_path is
  'Storage path of the company logo in the private vendor-certs bucket, '
  'written by VendorDb.uploadVendorFile(vendorId, ''logo'', file). ⚠️ The path '
  'MUST keep its <vendorId>/ prefix — that bucket''s Storage policies '
  'authorize on the first path segment. Private object: render it through a '
  'signed URL, never a public one. Vendor-owned.';


-- ── 2. re-create vendor_self_view with the three new columns ────────────────
-- ⚠️ THE COLUMN LIST IS THE ACCESS CONTROL. A `vendors` column that is absent
--    here is invisible AND unwritable to a vendor; one that is present is both
--    readable and writable by them (the guard still pins the staff-owned ones
--    underneath). Carried forward verbatim from
--    2026-08-20_vendor_self_view.sql + 2026-09-02_vendor_catalogue.sql, with
--    owner_name / owner_contact_number / logo_path appended — nothing dropped.
--
--    STILL DELIBERATELY OMITTED (staff-only, do not add):
--      notes, accreditation_notes  — internal remarks and the private
--                                    reasoning behind a standing. A declined
--                                    vendor still learns why, from
--                                    vendor_accreditation_requests.decision_notes,
--                                    which is written FOR them.
--      created_by, updated_by, updated_by_name — internal staff ids and names.
--
--    SUPABASE ADVISORY: this will be flagged "security_definer_view" — the same
--    accepted exception as wp_view_public. It MUST be definer-style; the point
--    is to bypass the base-table RLS while re-deriving the caller's own scope
--    and omitting columns. `security_invoker = on` is impossible: every
--    logged-in user shares the one `authenticated` Postgres role and RLS cannot
--    hide columns. Do not "fix" the advisory — that re-exposes the notes.
drop view if exists public.vendor_self_view;
create view public.vendor_self_view
with (security_barrier = true) as   -- stop a leaky outer predicate being pushed
                                    -- ahead of the scope conditions below
select
  v.id,
  v.name,
  v.status,
  v.invite_email,
  v.invite_claimed_at,
  v.trade_categories,
  v.accreditation,
  v.accreditation_date,
  v.vendor_code,
  v.tin,
  v.telephone,
  v.contact_number,
  v.contact_email,
  v.address,
  v.city,
  v.contact_person,
  v.contact_position,
  v.vendor_category,
  v.vendor_group,
  v.payment_terms,
  v.can_surety_bond,
  v.can_performance_bond,
  v.can_warranty_bond,
  v.can_provide_submittals,
  v.payment_terms_days,
  v.website,
  -- New here (2026-09-03): owner details asked for by the accreditation email,
  -- and the company logo.
  v.owner_name,
  v.owner_contact_number,
  v.logo_path,
  v.created_at,
  v.updated_at
from public.vendors v
where internal.get_my_status() = 'approved'
  and v.id = internal.get_my_vendor_id()
with cascaded check option;

grant select, update on public.vendor_self_view to authenticated;

comment on view public.vendor_self_view is
  'A vendor login''s ONLY read/write surface on its own vendors row. '
  'INTENTIONAL SECURITY DEFINER (accepted exception, same as wp_view_public): '
  'RLS filters rows, never columns, so hiding the staff-only columns from a '
  'vendor requires a separate definer relation. Carries the vendor''s UPDATEs '
  'as well as their SELECTs, because an UPDATE must find its row through the '
  'SELECT policies. internal.vendor_edit_guard still fires on the base table, '
  'so staff-owned columns stay pinned even where this view exposes them for '
  'reading. Omits notes / accreditation_notes / created_by / updated_by / '
  'updated_by_name.';


-- ── 3. verification — every column below must read `t` ─────────────────────
select
  (select count(*) = 3 from information_schema.columns
    where table_schema = 'public' and table_name = 'vendors'
      and column_name in ('owner_name','owner_contact_number','logo_path'))   as columns_added,
  (select count(*) = 3 from information_schema.columns
    where table_schema = 'public' and table_name = 'vendor_self_view'
      and column_name in ('owner_name','owner_contact_number','logo_path'))   as vendor_can_see_them,
  (select count(*) = 0 from information_schema.columns
    where table_schema = 'public' and table_name = 'vendor_self_view'
      and column_name in ('notes','accreditation_notes','created_by',
                          'updated_by','updated_by_name'))                    as staff_notes_still_hidden,
  (select count(*) >= 29 from information_schema.columns
    where table_schema = 'public' and table_name = 'vendor_self_view')        as no_column_dropped,
  (select count(*) = 2 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'vendor_self_view'
      and grantee = 'authenticated' and privilege_type in ('SELECT','UPDATE')) as grants_restored;
