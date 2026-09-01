-- Normalize WP No. to the agreed DIGIT-ONLY format by stripping a leading "WP-"/"WP " prefix
-- (the Excel importer previously stored "WP-<n>"). Run once in the Supabase SQL Editor (prod).
-- Safe to re-run — only rows that still start with the prefix are touched.
UPDATE work_packages
SET wp_no = regexp_replace(wp_no, '^WP[-\s]?', '', 'i')
WHERE wp_no ~* '^WP[-\s]?[0-9]';

-- Verify (optional): should return no rows afterward.
-- SELECT project_id, wp_no FROM work_packages WHERE wp_no ~* '^WP[-\s]?[0-9]';
