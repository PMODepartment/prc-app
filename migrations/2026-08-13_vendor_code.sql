-- ============================================================================
-- Vendor Code (external SAP/ERP ID) — Megawide WPM Dashboard
-- ----------------------------------------------------------------------------
-- Run once in the Supabase SQL Editor (production). Idempotent — safe to re-run.
--
-- Source: "Conso PO List. 2026 05 11.xlsx" (SAP-style PO/JO export), whose `Raw`
-- sheet carries a `Vendor Code` column (format V-00XXX) alongside `Vendor Name`
-- on every one of its 135,567 PO/JO line items. Across 1,461 distinct codes,
-- only 97 have more than one associated name string, and nearly all of those
-- are just case/spacing variants of the same company (e.g. "Jm2 Builders
-- Incorporated" vs "JM2 Builders Incorporated") — i.e. Vendor Code is a FAR
-- more reliable vendor identity key than the free-text name matching this
-- app's directory has relied on until now (the entire reason the Split/Merge
-- duplicate-cleanup tools in vendors.html exist).
--
-- Nullable/additive: a vendor created before this migration, or one with no
-- match in the PO export, simply has vendor_code = null and works exactly as
-- before. NOT unique-constrained at the DB level (a small number of codes are
-- shared across near-duplicate rows in the source data — see the Split tool's
-- documented edge cases) — dedup is enforced at the application layer (the
-- backfill script below skips a code already assigned to a vendor).
-- ============================================================================

alter table vendors add column if not exists vendor_code text;
create index if not exists idx_vendors_vendor_code on vendors(vendor_code);
