-- ─────────────────────────────────────────────────────────────────────────────
-- Remove the "Partially Awarded" award status entirely. Run once in the Supabase
-- SQL Editor (prod). Safe to re-run (only touches rows still on that value).
--
-- Policy: a WP is either Awarded or Not Yet Awarded — there is no partial state.
-- ALL "Partially Awarded" rows become "Not Yet Awarded". Their partial awarded
-- cost is also CLEARED (awarded_cost / additionals → NULL/0, so total_awarded → 0),
-- because a partial cost left in place would (a) be counted as if fully awarded and
-- (b) inflate the project's apparent savings (full BCB vs a partial cost). A
-- Not-Yet-Awarded WP must carry no awarded cost — enter the real figure only once
-- it is fully awarded.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE work_packages
SET award_status = 'Not Yet Awarded',
    awarded_cost = NULL,
    additionals  = 0
WHERE award_status = 'Partially Awarded';

-- Verify (optional): both queries should return no rows afterward.
-- SELECT project_id, wp_no, award_status FROM work_packages WHERE award_status = 'Partially Awarded';
-- SELECT project_id, wp_no, awarded_cost FROM work_packages
--   WHERE award_status = 'Not Yet Awarded' AND coalesce(awarded_cost,0) > 0;
