-- ─────────────────────────────────────────────────────────────────────────────
-- BCB baselines (BCB0 … BCB2)
-- Run once in the Supabase SQL Editor. Safe to re-run.
--
-- A project's procurement budget is re-baselined over time (BCB0 original,
-- BCB1/BCB2 revisions). A work package can therefore show savings against BCB0
-- while being overbudget against a later baseline. These columns hold the
-- budget AT EACH BASELINE; `approved_budget_bcb` keeps holding the CURRENT one
-- (the newest baseline that has a figure) so every existing query, chart,
-- export and KPI keeps working unchanged.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE work_packages ADD COLUMN IF NOT EXISTS budget_bcb0 numeric(18,2);
ALTER TABLE work_packages ADD COLUMN IF NOT EXISTS budget_bcb1 numeric(18,2);
ALTER TABLE work_packages ADD COLUMN IF NOT EXISTS budget_bcb2 numeric(18,2);

-- Backfill: everything imported so far is the original baseline.
UPDATE work_packages SET budget_bcb0 = approved_budget_bcb
 WHERE budget_bcb0 IS NULL AND approved_budget_bcb IS NOT NULL;

-- Viewers read work packages through wp_view_public, which must never expose money.
-- These are money columns, so they are deliberately NOT added to that view.
