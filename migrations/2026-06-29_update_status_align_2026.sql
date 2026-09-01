-- ─────────────────────────────────────────────────────────────────────────────
-- One-off migration: align existing procurement_status / delivery_status values
-- to the updated option sets. Run once in the Supabase SQL Editor (prod).
-- Safe to re-run (idempotent — each UPDATE only touches rows still on a legacy value).
--
-- Procurement Status options (new):  Not Started | Sourcing | Solicitation |
--                                    Evaluation & Negotiation | Awarded
-- Delivery Status options (new):     Not Awarded | DP Processing | Detailed Drawings |
--                                    Production | Delivered | Installed
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Procurement Status: map legacy stages to the closest new stage ──
UPDATE work_packages SET procurement_status = 'Solicitation'
  WHERE procurement_status IN ('RFQ', 'Bid Open');
UPDATE work_packages SET procurement_status = 'Evaluation & Negotiation'
  WHERE procurement_status IN ('Bid Closed');
UPDATE work_packages SET procurement_status = 'Awarded'
  WHERE procurement_status IN ('LOA', 'Contract', 'Mob / Del', 'Mob/Del');
-- 'Not Started' and 'Sourcing' are unchanged (already valid).

-- ── Delivery Status: map legacy values to the closest new value ──
UPDATE work_packages SET delivery_status = 'DP Processing'
  WHERE delivery_status IN ('Awarded');
UPDATE work_packages SET delivery_status = 'Delivered'
  WHERE delivery_status IN ('In-Transit Delivery', 'Not Installed');
UPDATE work_packages SET delivery_status = 'Installed'
  WHERE delivery_status IN ('Installation');
-- 'Not Awarded', 'DP Processing', 'Detailed Drawings', 'Production', 'Delivered'
-- are unchanged (already valid).

-- ── Verify (optional): list any values that are still outside the new option sets ──
-- SELECT DISTINCT procurement_status FROM work_packages
--   WHERE procurement_status IS NOT NULL
--     AND procurement_status NOT IN ('Not Started','Sourcing','Solicitation','Evaluation & Negotiation','Awarded');
-- SELECT DISTINCT delivery_status FROM work_packages
--   WHERE delivery_status IS NOT NULL
--     AND delivery_status NOT IN ('Not Awarded','DP Processing','Detailed Drawings','Production','Delivered','Installed');
