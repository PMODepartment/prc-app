-- ═══════════════════════════════════════════════════════════════════════════
-- Personnel owns the people. vendors.contact_* / owner_* become MIRRORS.
-- Run once, in the Supabase SQL Editor, AFTER 2026-09-03_vendor_owner_and_logo.sql.
--
-- WHY
-- ---
-- The portal asked for the same people twice. Contact Person / Position /
-- Contact Number / Email sat as free text on Company Information AND as rows in
-- the Personnel tab, and a vendor who typed them into Company Information got a
-- saved record with an EMPTY Personnel tab — reported 2026-09-04. The two copies
-- were never reconciled in that direction (syncPrimaryContact only ever pushed
-- Personnel -> vendors, never the reverse).
--
-- So Personnel becomes the single editor for every named person, and the
-- vendors.* columns stay as the mirror every other consumer already reads
-- (window.accredReadiness, the staff cards, the analytics, the WP vendor
-- pickers, the RFQ composer). Nothing downstream changes.
--
-- ⚠️ THE OWNER IS NOT THE CONTACT, AND THERE CAN BE SEVERAL.
--    A single owner_name text column cannot hold "Mr and Mrs Cruz", which is an
--    ordinary shape for a Philippine family-owned supplier. is_owner is a FLAG
--    on the person, so a vendor can mark as many as they actually have, and the
--    mirror joins them. The role_title stays free text for everyone else —
--    "Sales Manager", "Project Engineer" — because that genuinely varies by
--    vendor. Owner is the ONE designation Megawide needs to read reliably, so
--    it gets a column of its own rather than being buried in that free text.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. the flag ───────────────────────────────────────────────────────────
alter table public.vendor_personnel
  add column if not exists is_owner boolean not null default false;

comment on column public.vendor_personnel.is_owner is
  'This person is an owner / proprietor of the vendor. Several rows may carry it. '
  'vendors.owner_name and vendors.owner_contact_number are mirrors of the flagged rows.';

create index if not exists idx_vendor_personnel_owner
  on public.vendor_personnel(vendor_id) where is_owner;

-- ── 2. carry across what vendors already told us ──────────────────────────
-- ⚠️ WITHOUT THIS the owner data is STRANDED: the Company Information fields
--    become read-only mirrors, so a vendor whose owner lives only in
--    vendors.owner_name would have no way to edit it and no Personnel row to
--    edit it from. Two steps, both idempotent and both conservative.

-- 2a. Flag a personnel row that IS the recorded owner (same normalised name).
--     Only ever ADDS a flag; never clears one somebody set deliberately.
update public.vendor_personnel p
   set is_owner = true
  from public.vendors v
 where p.vendor_id = v.id
   and p.is_owner is not true
   and nullif(btrim(coalesce(v.owner_name, '')), '') is not null
   and lower(regexp_replace(btrim(p.name),       '\s+', ' ', 'g'))
     = lower(regexp_replace(btrim(v.owner_name), '\s+', ' ', 'g'));

-- 2b. Create the row where the owner exists only on the vendor record.
--     ⚠️ Guarded on there being NO name-matching row, so re-running cannot
--        produce a second copy.
insert into public.vendor_personnel (vendor_id, name, role_title, contact_number, is_owner)
select v.id,
       btrim(v.owner_name),
       'Owner / Proprietor',
       nullif(btrim(coalesce(v.owner_contact_number, '')), ''),
       true
  from public.vendors v
 where nullif(btrim(coalesce(v.owner_name, '')), '') is not null
   and not exists (
         select 1 from public.vendor_personnel p
          where p.vendor_id = v.id
            and lower(regexp_replace(btrim(p.name),       '\s+', ' ', 'g'))
              = lower(regexp_replace(btrim(v.owner_name), '\s+', ' ', 'g')));

-- 2c. Same for the PRIMARY CONTACT. vendors.contact_person / _position /
--     _number / _email are mirrors from now on, so a vendor whose contact
--     exists only on the company record would open the portal to four blank
--     read-only boxes and conclude the data was lost.
insert into public.vendor_personnel
       (vendor_id, name, role_title, contact_number, email, is_primary)
select v.id,
       btrim(v.contact_person),
       nullif(btrim(coalesce(v.contact_position, '')), ''),
       nullif(btrim(coalesce(v.contact_number, '')), ''),
       nullif(btrim(coalesce(v.contact_email, '')), ''),
       true
  from public.vendors v
 where nullif(btrim(coalesce(v.contact_person, '')), '') is not null
   and not exists (
         select 1 from public.vendor_personnel p
          where p.vendor_id = v.id
            and lower(regexp_replace(btrim(p.name),           '\s+', ' ', 'g'))
              = lower(regexp_replace(btrim(v.contact_person), '\s+', ' ', 'g')));

-- 2d. Where a name-matching row already existed, make sure ONE of the vendor's
--     rows is flagged primary — otherwise primaryPerson() finds nobody and the
--     mirror reads empty. Only fills a gap; never re-points an existing flag.
update public.vendor_personnel p
   set is_primary = true
  from public.vendors v
 where p.vendor_id = v.id
   and nullif(btrim(coalesce(v.contact_person, '')), '') is not null
   and lower(regexp_replace(btrim(p.name),           '\s+', ' ', 'g'))
     = lower(regexp_replace(btrim(v.contact_person), '\s+', ' ', 'g'))
   and not exists (select 1 from public.vendor_personnel q
                    where q.vendor_id = v.id and q.is_primary);

-- ── 3. verification — every column must read true ─────────────────────────
select
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'vendor_personnel'
             and column_name = 'is_owner')                                as has_is_owner,
  exists (select 1 from pg_indexes
           where schemaname = 'public' and indexname = 'idx_vendor_personnel_owner')
                                                                          as has_owner_index,
  -- no vendor still has an owner name with nowhere to edit it
  not exists (
    select 1 from public.vendors v
     where nullif(btrim(coalesce(v.owner_name, '')), '') is not null
       and not exists (select 1 from public.vendor_personnel p
                        where p.vendor_id = v.id and p.is_owner))         as every_owner_has_a_row,
  -- and no contact stranded on the company record with no row to edit it from
  not exists (
    select 1 from public.vendors v
     where nullif(btrim(coalesce(v.contact_person, '')), '') is not null
       and not exists (select 1 from public.vendor_personnel p
                        where p.vendor_id = v.id and p.is_primary))       as every_contact_has_a_row;
