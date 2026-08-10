-- Links the free-text "Proposed Vendors" field on a work package to the vendor directory,
-- the same way Phase 2b linked the Awarded Vendor (work_packages.vendor_id). Multiple vendors
-- can be proposed per WP, so this is an array of ids rather than a single FK column.
--
-- Additive / non-destructive: the existing `proposed_vendors` text column is UNTOUCHED and keeps
-- being populated in parallel (denormalized, human-readable) — every existing reader of that text
-- column (the WP List free-text vendor filter in index.html/project.html, CSV/Excel import+export,
-- etc.) keeps working with no changes. Safe to re-run (IF NOT EXISTS).
--
-- Run once in the Supabase SQL Editor. See CLAUDE.md "Vendor Management — Phase 2b" for the
-- deploy-order-safe retry guard in assets/js/db.js (_isMissingProposedVendorIdsCol/_stripProposedVendorIds)
-- that lets the app keep working before this migration is applied.

ALTER TABLE work_packages
  ADD COLUMN IF NOT EXISTS proposed_vendor_ids uuid[] DEFAULT '{}';

-- No FK constraint on the array elements (Postgres can't FK-constrain array elements natively,
-- and vendor deletion is already handled via delete_vendor_cascade()/merge_vendors() RPCs which
-- would need extra logic to also scrub this array — out of scope for this pass, left as free ids).
