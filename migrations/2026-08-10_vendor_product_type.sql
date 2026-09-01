-- ============================================================================
-- Vendor offering type: Materials | Labor | Service (2026-08-10)
-- Run once in the Supabase SQL Editor. Additive + idempotent.
--
-- Some vendors supply materials, others provide labor or services.
-- vendor_products modeled every offering as a "product"; this adds a nullable
-- item_type so each offering can be classified with the SAME three values the
-- WP form's Type field uses (Materials / Labor / Service). Nullable (no default,
-- no CHECK) so it's fully additive — existing rows read as unspecified until
-- edited; the app only ever writes one of those three, and the WP backfill
-- copies the WP's own type_of_works.
-- ============================================================================
alter table vendor_products add column if not exists item_type text;

comment on column vendor_products.item_type is
  'Offering type: ''Materials'' | ''Labor'' | ''Service'' (nullable = unspecified), matching the WP form Type field. Written by the vendor portal / staff detail form and the WP backfill (from work_packages.type_of_works).';
