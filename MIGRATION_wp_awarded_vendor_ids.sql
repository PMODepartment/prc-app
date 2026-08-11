-- Multiple awarded vendors per work package (co-award). Additive + deploy-safe:
-- the existing single vendor_id FK and the free-text contractor column are both
-- left untouched (vendor_id keeps the first/primary awarded vendor for back-compat
-- single-FK readers; contractor keeps the newline-joined display names). This
-- array mirrors proposed_vendor_ids exactly. No FK constraint (Postgres can't
-- constrain array elements); vendor delete/merge RPCs scrub proposed_vendor_ids
-- but not this one yet — low-traffic edge case.
ALTER TABLE work_packages ADD COLUMN IF NOT EXISTS awarded_vendor_ids uuid[] DEFAULT '{}';
