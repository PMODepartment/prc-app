-- Add the OSM flag column (Yes/No) to work packages. Run once in the Supabase
-- SQL Editor (prod). Safe to re-run (IF NOT EXISTS). The WP form writes this and
-- the WP List has an OSM filter; without the column, saving a WP would error.
ALTER TABLE work_packages ADD COLUMN IF NOT EXISTS osm text DEFAULT 'No';

-- Optional: backfill any NULLs to 'No'.
-- UPDATE work_packages SET osm = 'No' WHERE osm IS NULL;
