-- ============================================================================
-- Which vendor migrations have actually been run?  — read-only, safe any time
-- ----------------------------------------------------------------------------
-- Paste into the Supabase SQL Editor. Every column should read `true`. A `false`
-- names the migration to run, in the order listed.
--
-- Why this exists: an unrun migration does NOT announce itself. The client
-- guards degrade quietly, so a missing column or table shows up as a BLANK
-- PANEL in the vendor portal — an empty Products list, an Accreditation tab
-- stuck on "Checking…", a personnel photo that never appears — rather than as
-- an error. This tells you in one query.
--
-- ⚠️ Run order matters where noted; migrations/README.md is authoritative.
-- ============================================================================

with t as (
  select table_name from information_schema.tables where table_schema = 'public'
), c as (
  select table_name, column_name from information_schema.columns where table_schema = 'public'
), f as (
  select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'internal')
)
select
  -- Phase 2a / 2b foundations
  (select count(*) = 1 from t where table_name = 'vendors')                                  as m_vendor_management,
  (select count(*) = 1 from t where table_name = 'vendor_bids')                              as m_vendor_phase2b,
  (select count(*) = 1 from c where table_name = 'vendors' and column_name = 'vendor_code')  as m_vendor_code,
  (select count(*) = 1 from c where table_name = 'vendors' and column_name = 'accreditation') as m_accreditation,

  -- Accreditation requests + the DOCUMENTS table the portal uploads into.
  -- ⚠️ If this is false the Accreditation tab cannot load at all.
  (select count(*) = 1 from t where table_name = 'vendor_accreditation_requests')            as m_accred_requests,
  (select count(*) = 1 from t where table_name = 'vendor_documents')                         as m_vendor_documents,

  -- Product taxonomy (Trade -> Works -> deeper), used by the catalogue picker
  (select count(*) = 1 from t where table_name = 'product_taxonomy')                         as m_product_taxonomy,
  (select count(*) = 1 from c where table_name = 'vendor_products' and column_name = 'taxonomy_id') as m_product_taxonomy_link,

  -- Field ownership / self-view / guard consolidation
  (select count(*) = 1 from t where table_name = 'vendor_self_view')                         as m_vendor_self_view,
  (select count(*) = 1 from c where table_name = 'vendors' and column_name = 'payment_terms') as m_profile_fields,
  (select count(*) = 1 from c where table_name = 'vendors' and column_name = 'vendor_edited_at') as m_vendor_edited_flag,

  -- Archive / audit / lock / history on the child tables.
  -- ⚠️ 2026-09-02_vendor_catalogue.sql expects archived_at to exist already.
  (select count(*) = 1 from c where table_name = 'vendor_products' and column_name = 'archived_at')  as m_child_soft_delete,
  (select count(*) = 1 from c where table_name = 'vendor_products' and column_name = 'updated_by')   as m_child_audit_trail,
  (select count(*) = 1 from c where table_name = 'vendor_documents' and column_name = 'locked_at')   as m_doc_lock,
  (select count(*) = 1 from t where table_name = 'vendor_history')                                   as m_history_restore,

  -- ⚠️ THE LIKELY CULPRIT for the blank Products panel and the missing
  -- personnel photo: photo_path and every catalogue column live here.
  (select count(*) = 1 from c where table_name = 'vendor_personnel' and column_name = 'photo_path')  as m_catalogue_personnel_photo,
  (select count(*) = 1 from c where table_name = 'vendor_products'  and column_name = 'photo_path')  as m_catalogue_product_photo,
  (select count(*) = 1 from c where table_name = 'vendor_products'  and column_name = 'supply_scope') as m_catalogue_specs,

  -- Self-registration + this week's owner/logo columns
  (select count(*) = 1 from t where table_name = 'vendor_claims')                            as m_self_registration,
  (select count(*) = 1 from c where table_name = 'vendors' and column_name = 'owner_name')   as m_owner_and_logo,
  (select count(*) = 1 from c where table_name = 'vendors' and column_name = 'logo_path')    as m_logo_column,
  (select count(*) = 1 from c where table_name = 'vendor_self_view' and column_name = 'logo_path') as m_logo_in_self_view;
