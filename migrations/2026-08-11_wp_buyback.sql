-- ─────────────────────────────────────────────────────────────────────────────
-- Buyback work packages (2026-08-11)
-- Run once in the Supabase SQL Editor. Safe to re-run (both statements are
-- IF NOT EXISTS / additive).
--
-- Some work packages are procured under a BUYBACK arrangement: the vendor takes
-- the item back at the end of its use, so part of the awarded cost is recovered.
-- The recovered portion is real, realized savings, so it must be netted off the
-- WP's effective awarded cost — otherwise the dashboard books the full awarded
-- cost as spend and understates savings.
--
--   buyback_value  = awarded_cost x (1 - buyback_depreciation_percent)
--   effective cost = awarded_cost - buyback_value
--                  = awarded_cost x buyback_depreciation_percent
--
-- i.e. the depreciation % is how much of the value is LOST (consumed) and is
-- therefore the part that stays as real cost; the remainder is bought back.
-- e.g. Awarded PHP 10M at 30% depreciation -> PHP 7M bought back (savings),
-- PHP 3M effective cost.
--
-- Stored as a DECIMAL fraction (0.30 = 30%), exactly like dp_percent /
-- retention_percent — the WP form and the review grid both take a whole
-- percent from the user and divide by 100 before saving.
--
-- See window.buybackValue() / window.effectiveAwardedCost() in assets/js/db.js —
-- every KPI, chart, forecast and export routes its money through those, so this
-- one column changes the whole ledger consistently. See CLAUDE.md.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE work_packages ADD COLUMN IF NOT EXISTS buyback boolean DEFAULT false;
ALTER TABLE work_packages ADD COLUMN IF NOT EXISTS buyback_depreciation_percent numeric(5,4);
-- ALTERNATIVE INPUT MODE (2026-08-11): the buyback can be entered as an EXACT AMOUNT
-- instead of a depreciation %. When buyback_amount is set it WINS over the % (it is the
-- figure the user actually typed); the % column is then left null, and vice versa, so the
-- two can never drift. buybackValue() clamps the amount to [0, awarded_cost].
ALTER TABLE work_packages ADD COLUMN IF NOT EXISTS buyback_amount numeric(18,2);

-- NOTE: `buyback` itself is a status modifier (not money), but
-- buyback_depreciation_percent is cost-bearing — do NOT add that one to
-- wp_view_public (the cost-free relation plain `viewer` reads). Adding the
-- boolean alone is optional and safe if you want viewers to see the badge.
