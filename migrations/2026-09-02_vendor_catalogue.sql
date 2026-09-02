-- ============================================================================
-- Vendor catalogue — close the gap between what a vendor can offer and what a
-- work package actually asks for
-- Megawide WPM Dashboard
-- ----------------------------------------------------------------------------
-- Run ONCE in the Supabase SQL Editor. Idempotent — safe to re-run.
-- No temp tables and no cross-statement state.
--
-- ⚠️ AFTER RUNNING THIS, RE-RUN `2026-08-20_vendor_self_view.sql`.
-- The three new `vendors` columns are VENDOR-OWNED (they are the vendor's own
-- declaration about itself), but a vendor reads and writes its row through
-- `vendor_self_view`, which lists columns EXPLICITLY. A column missing from that
-- view is invisible and unwritable to the vendor, so the portal would render
-- empty boxes that never save. Section 5 below FAILS LOUDLY until the view is
-- rebuilt, rather than letting that ship silently.
--
-- That view has exactly ONE definition, in its own migration — the same
-- single-definition rule that `internal.vendor_edit_guard` had to be
-- consolidated back into after five files fought over it. Do NOT recreate the
-- view here; edit it there and re-run that file.
--
-- WHY
-- ---
-- `vendor_products` carried category / description / unit / notes / item_type /
-- taxonomy_id — four meaningful fields. A work package specifies roughly
-- fifteen sourcing-relevant attributes, so a buyer could not answer basic
-- questions from the directory: how long is the lead time, is it supply-only or
-- supply-and-install, what brand and grade, can this vendor post a performance
-- bond, can they produce submittals.
--
-- ⚠️ This deliberately does NOT mirror all 54 work-package columns. Most of
-- those are per-AWARD facts (award dates, awarded cost, PO/JO numbers, delivery
-- status) that belong to a transaction, not to a catalogue. What is added here
-- is CAPABILITY: what this vendor can supply, how fast, on what commercial
-- terms. Anything that is only true of one purchase stays on the work package.
-- ============================================================================

-- ── 1. Catalogue item ───────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.vendor_products') is null then
    raise exception 'vendor_products does not exist — run 2026-08-10_vendor_management.sql first';
  end if;
end $$;

-- Identification. For Materials the brand/model/grade IS the specification, and
-- a buyer matching a WP's `works` + `type_of_works` needs it to compare offers.
alter table public.vendor_products add column if not exists brand              text;
alter table public.vendor_products add column if not exists model              text;   -- model / grade / spec designation
alter table public.vendor_products add column if not exists origin             text;   -- country of origin

-- ⭐ The single most-used sourcing filter, and the one field whose absence was
-- most obvious: work_packages.lead_time is in days, so this matches it exactly.
alter table public.vendor_products add column if not exists lead_time_days     integer;

-- Maps onto work_packages.type_of_contract / type_of_works: whether the vendor
-- is quoting the material, the labour, or both. Free text (not an enum) for the
-- same reason projects.group_head is — the vocabulary can change without a
-- migration. The UI offers a fixed list.
alter table public.vendor_products add column if not exists supply_scope       text;

-- Capacity and commercial reach.
alter table public.vendor_products add column if not exists min_order_qty      numeric(18,3);
alter table public.vendor_products add column if not exists capacity_per_month numeric(18,3);
alter table public.vendor_products add column if not exists coverage_area      text;
alter table public.vendor_products add column if not exists warranty_months    integer;

-- Indicative pricing. NOT a quotation and never treated as one — a real price
-- comes from vendor_bids against a specific work package. This is for early
-- budgeting only, which is why it carries its own validity date: an indicative
-- price with no expiry silently becomes a lie.
alter table public.vendor_products add column if not exists indicative_price   numeric(18,2);
alter table public.vendor_products add column if not exists price_currency     text default 'PHP';
alter table public.vendor_products add column if not exists price_valid_until  date;

-- Files live in the existing private `vendor-certs` bucket under the SAME
-- <vendor_id>/… prefix its Storage policies key off — no new bucket, no new
-- policy. Read back through a signed URL like certs and documents already are.
alter table public.vendor_products add column if not exists photo_path         text;
alter table public.vendor_products add column if not exists spec_file_path     text;

-- Every catalogue view filters to live rows of one vendor.
create index if not exists vendor_products_live_idx
  on public.vendor_products (vendor_id) where archived_at is null;

-- ── 2. Company-level capability ─────────────────────────────────────────────
-- These answer work-package requirements that are properties of the COMPANY,
-- not of any one item: work_packages.surety_bond / performance_bond /
-- warranty_bond and requires_approval + submittal_document_type.
--
-- ⚠️ VENDOR-OWNED, so they are deliberately NOT pinned in
-- internal.vendor_edit_guard — they are the vendor's own declaration, the same
-- as their contact details. Staff verify them at accreditation.
alter table public.vendors add column if not exists can_surety_bond        boolean;
alter table public.vendors add column if not exists can_performance_bond   boolean;
alter table public.vendors add column if not exists can_warranty_bond      boolean;
alter table public.vendors add column if not exists can_provide_submittals boolean;
-- Structured companion to the existing free-text `payment_terms` ("60 Days"),
-- so terms can actually be compared and filtered. The text column is left alone
-- — it holds real data imported from the masterlist.
alter table public.vendors add column if not exists payment_terms_days     integer;

-- ── 3. Personnel photo ──────────────────────────────────────────────────────
-- Patterns the Planning app's Stakeholder Map, where a profile card leads with
-- a face and falls back to initials.
alter table public.vendor_personnel add column if not exists photo_path text;

-- ── 4. Report what is now on file ───────────────────────────────────────────
select
  (select count(*) from public.vendor_products where archived_at is null)                    as live_offerings,
  (select count(*) from public.vendor_products where archived_at is null and lead_time_days is not null) as with_lead_time,
  (select count(*) from public.vendor_products where archived_at is null and photo_path is not null)     as with_photo,
  (select count(*) from public.vendors where can_performance_bond is not null)                as bond_capability_declared;

-- ── 5. Verification — EVERY column must read true ───────────────────────────
-- The last one is the important one: it fails until vendor_self_view has been
-- rebuilt, which is what stops the portal shipping fields a vendor cannot save.
select
  (select count(*) = 14 from information_schema.columns
     where table_schema='public' and table_name='vendor_products'
       and column_name in ('brand','model','origin','lead_time_days','supply_scope',
                           'min_order_qty','capacity_per_month','coverage_area','warranty_months',
                           'indicative_price','price_currency','price_valid_until',
                           'photo_path','spec_file_path'))                       as product_cols_added,
  (select count(*) = 5 from information_schema.columns
     where table_schema='public' and table_name='vendors'
       and column_name in ('can_surety_bond','can_performance_bond','can_warranty_bond',
                           'can_provide_submittals','payment_terms_days'))       as vendor_cols_added,
  (select count(*) = 1 from information_schema.columns
     where table_schema='public' and table_name='vendor_personnel'
       and column_name='photo_path')                                             as personnel_photo_added,
  (select count(*) = 5 from information_schema.columns
     where table_schema='public' and table_name='vendor_self_view'
       and column_name in ('can_surety_bond','can_performance_bond','can_warranty_bond',
                           'can_provide_submittals','payment_terms_days'))
                                                          as self_view_rebuilt_RERUN_2026_08_20_IF_FALSE;
