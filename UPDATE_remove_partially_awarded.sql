-- ─────────────────────────────────────────────────────────────────────────────
-- Remove the "Partially Awarded" award status entirely. Run once in the Supabase
-- SQL Editor (prod). Safe to re-run (only touches rows still on that value).
--
-- Policy: a WP is either Awarded or Not Yet Awarded — there is no partial state.
-- Reclassify existing "Partially Awarded" rows using the same rule as the award
-- safeguard: it counts as Awarded only if it has an awarded cost AND a vendor;
-- otherwise it reverts to Not Yet Awarded.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE work_packages
SET award_status = CASE
  WHEN COALESCE(awarded_cost, 0) > 0 AND NULLIF(TRIM(contractor), '') IS NOT NULL
    THEN 'Awarded'
  ELSE 'Not Yet Awarded'
END
WHERE award_status = 'Partially Awarded';

-- Verify (optional): should return no rows afterward.
-- SELECT project_id, wp_no, award_status FROM work_packages WHERE award_status = 'Partially Awarded';
