-- Multiple awarded vendors per work package (co-award). Additive + deploy-safe:
-- the existing single vendor_id FK and the free-text contractor column are both
-- left untouched (vendor_id keeps the first/primary awarded vendor for back-compat
-- single-FK readers; contractor keeps the newline-joined display names).
--
--  awarded_vendor_ids     — the co-awarded vendors (mirrors proposed_vendor_ids)
--  awarded_vendor_amounts — each vendor's OWN negotiated awarded amount, index-
--                           aligned with awarded_vendor_ids. The WP's awarded_cost
--                           is the SUM of these (each vendor is awarded based on
--                           their negotiated offer, not an even split of a lump sum).
--
-- No FK constraint (Postgres can't constrain array elements); vendor delete/merge
-- RPCs scrub proposed_vendor_ids but not these yet — low-traffic edge case.
ALTER TABLE work_packages ADD COLUMN IF NOT EXISTS awarded_vendor_ids uuid[] DEFAULT '{}';
ALTER TABLE work_packages ADD COLUMN IF NOT EXISTS awarded_vendor_amounts numeric[] DEFAULT '{}';
