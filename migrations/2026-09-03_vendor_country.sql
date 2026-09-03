-- ============================================================================
-- Vendor country — Megawide WPM Dashboard
-- ----------------------------------------------------------------------------
-- Run once in the Supabase SQL Editor (production). Idempotent — safe to re-run.
--
-- WHY
--   The address block had Address + City and nothing else, so an overseas vendor
--   had nowhere to say where they are. The stopgap was telling them to type
--   "City, Country" into the City box — a workaround, not an answer: it cannot
--   be filtered, grouped or matched on, and it silently corrupts City for
--   everyone who follows the instruction.
--
--   It also gives the contact-number fields something to key off. The portal
--   renders the dial code from the country (+63 for the Philippines) the way
--   every other app does, instead of asking the vendor to remember it.
--
-- ⚠️ VENDOR-OWNED, so it MUST be listed in vendor_self_view or the portal
--    renders a box that silently never saves — removing a vendor's SELECT on
--    `vendors` also breaks their UPDATE, because an UPDATE has to FIND its row
--    and Postgres applies the SELECT policies to the rows it reads. It is
--    deliberately NOT pinned in internal.vendor_edit_guard: where a company is
--    located is its own information, exactly like address and city.
--
-- Defaults to 'PH' for every existing row: this directory came from a Philippine
-- SAP masterlist and work-package history, so that is the honest starting value
-- rather than NULL — and a vendor who is elsewhere can change it.
--
-- No temp tables and no state carried between statements — the Supabase SQL
-- Editor does not run a script as one transaction.
-- ============================================================================


-- ── 1. the column ───────────────────────────────────────────────────────────
-- ISO 3166-1 alpha-2. Two characters, so it can be joined against anything
-- later without a normalisation pass; the display name and dial code live in
-- the client (window.COUNTRIES in db.js) where they can change without a
-- migration, the same reasoning as window.GROUP_HEADS and ACCREDITATIONS.
alter table vendors add column if not exists country text;

update vendors set country = 'PH' where country is null;

comment on column vendors.country is
  'ISO 3166-1 alpha-2 country code of the vendor''s address. Display name and '
  'dial code are held client-side in window.COUNTRIES (db.js) so the roster can '
  'change without a migration. Vendor-owned: not pinned in '
  'internal.vendor_edit_guard, and listed in vendor_self_view.';


-- ── 2. re-create vendor_self_view with country added ───────────────────────
-- ⚠️ THE COLUMN LIST IS THE ACCESS CONTROL. A `vendors` column absent here is
--    invisible AND unwritable to a vendor. Carried forward verbatim from
--    2026-09-03_vendor_owner_and_logo.sql with `country` appended — nothing
--    dropped, and the staff-only columns stay omitted:
--      notes, accreditation_notes  — internal remarks and the private reasoning
--                                    behind a standing (a declined vendor still
--                                    learns why, from
--                                    vendor_accreditation_requests.decision_notes).
--      created_by, updated_by, updated_by_name — internal staff ids and names.
--
--    SUPABASE ADVISORY: will be flagged "security_definer_view" — the same
--    accepted exception as wp_view_public. It MUST be definer-style: RLS filters
--    rows, never columns, and every logged-in user shares the one
--    `authenticated` role, so per-role column hiding needs a separate relation.
--    Do not "fix" the advisory — that re-exposes the notes.
drop view if exists public.vendor_self_view;
create view public.vendor_self_view
with (security_barrier = true) as
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
  v.owner_name,
  v.owner_contact_number,
  v.logo_path,
  -- New here (2026-09-03).
  v.country,
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


-- ── 3. verification — every column must read `true` ────────────────────────
select
  (select count(*) = 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'vendors' and column_name = 'country')       as country_added,
  (select count(*) = 0 from vendors where country is null)                                      as every_row_defaulted,
  (select count(*) = 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'vendor_self_view' and column_name = 'country') as vendor_can_see_it,
  (select count(*) = 3 from information_schema.columns
    where table_schema = 'public' and table_name = 'vendor_self_view'
      and column_name in ('owner_name','owner_contact_number','logo_path'))                     as earlier_columns_kept,
  (select count(*) = 0 from information_schema.columns
    where table_schema = 'public' and table_name = 'vendor_self_view'
      and column_name in ('notes','accreditation_notes','created_by',
                          'updated_by','updated_by_name'))                                      as staff_notes_still_hidden,
  (select count(*) >= 32 from information_schema.columns
    where table_schema = 'public' and table_name = 'vendor_self_view')                          as no_column_dropped,
  (select count(*) = 2 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'vendor_self_view'
      and grantee = 'authenticated' and privilege_type in ('SELECT','UPDATE'))                  as grants_restored;
