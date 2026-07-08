-- ============================================================================
-- Demo / Sandbox Project seed  —  Megawide WPM Dashboard
-- ----------------------------------------------------------------------------
-- Creates a read-only DEMO project with 10 realistic sample work packages so
-- new users can explore the dashboard without touching real data.
--
-- The app treats project id 'DEMO' as read-only for EVERYONE (see auth.js
-- canAccessProject + project.html demo banner) and hides it from the Portfolio
-- consolidated charts (index.html) so it never skews real KPIs.
--
-- Safe to re-run: it deletes and re-inserts the DEMO rows each time.
-- Run in the Supabase SQL Editor (production project).
--
-- NOTE: total_awarded / awarding_lead_time / variance are GENERATED columns —
-- never inserted. We set awarded_cost and lead_time instead.
-- ============================================================================

-- 1) Project row (upsert)
insert into public.projects (id, name, location, status, budget_bcb)
values ('DEMO', 'Demo Project — Sample EPC', 'Training Sandbox', 'active', 344500000)
on conflict (id) do update
  set name = excluded.name,
      location = excluded.location,
      status = excluded.status,
      budget_bcb = excluded.budget_bcb;

-- 2) Work packages — wipe any prior DEMO rows, then insert a fresh set
delete from public.work_packages where project_id = 'DEMO';

insert into public.work_packages
  (project_id, cost_code, trade, works, type_of_works, wp_no, description, scope, zone,
   type_of_procurement, type_of_contract, charging_type, proposed_vendors, contractor,
   lead_time, awarding_date, actual_awarding_date, target_delivery, target_completion,
   approved_budget_bcb, awarded_cost, award_status, procurement_status, delivery_status,
   submittal_type, osm, remarks, review_status)
values
  -- ---- Awarded (6) — a mix of savings, plus one over-budget "loss" (WP-03) ----
  ('DEMO','GR-001','General Requirements','Mobilization','Service','DEMO-01',
   'Site mobilization & temporary facilities','Temporary offices, fencing, utilities','Zone A',
   'Negotiated','Lump Sum','Main Contract','BuildRight Services Inc.','BuildRight Services Inc.',
   60,'2025-08-15','2025-08-20','2025-09-30','2025-10-15',
   12000000,11500000,'Awarded','Awarded','Delivered','Not Required','No','Awarded','approved'),

  ('DEMO','SW-010','Site Works','Earthworks','Labor','DEMO-02',
   'Bulk excavation & backfill','Cut/fill, compaction, hauling','Zone A',
   'Competitive Bid','Unit Price','Main Contract','Terra Movers Corp.','Terra Movers Corp.',
   75,'2025-09-10','2025-09-18','2025-12-15','2026-01-10',
   45000000,43200000,'Awarded','Awarded','Delivered','Not Required','No','Awarded','approved'),

  ('DEMO','ST-020','Structural Works','Ready-Mix Concrete','Materials','DEMO-03',
   'Concrete supply for substructure','Class A concrete, delivery to site','Zone B',
   'Competitive Bid','Unit Price','Main Contract','Solid Rock Concrete','Solid Rock Concrete',
   90,'2025-10-01','2025-10-12','2026-03-30','2026-05-15',
   80000000,82500000,'Awarded','Awarded','Production','Approved','Yes','Awarded — over budget','approved'),

  ('DEMO','AR-030','Architectural Works','Masonry','Labor','DEMO-05',
   'CHB laying & plastering','Interior/exterior walls','Zone B',
   'Negotiated','Lump Sum','Main Contract','FinishPro Builders','FinishPro Builders',
   80,'2026-01-20','2026-02-02','2026-06-30','2026-08-15',
   22000000,20800000,'Awarded','Awarded','Detailed Drawings','Submitted','No','Awarded','approved'),

  ('DEMO','ME-040','Mechanical Works','HVAC','Materials','DEMO-07',
   'HVAC equipment supply & install','Chillers, AHUs, ductwork','Zone C',
   'Competitive Bid','Lump Sum','Main Contract','CoolAir Systems','CoolAir Systems',
   120,'2026-02-15','2026-03-01','2026-08-30','2026-10-30',
   55000000,53900000,'Awarded','Awarded','Production','Approved','Yes','Awarded','approved'),

  ('DEMO','PL-050','Plumbing Works','Sanitary','Materials','DEMO-09',
   'Sanitary & plumbing fixtures','Pipes, fittings, fixtures','Zone C',
   'Negotiated','Unit Price','Main Contract','FlowTech Plumbing','FlowTech Plumbing',
   70,'2026-03-10','2026-03-22','2026-07-30','2026-09-15',
   16000000,15400000,'Awarded','Awarded','DP Processing','Submitted','No','Awarded','approved'),

  -- ---- Not yet awarded (4) — backlog: one badly overdue, one current, two future ----
  ('DEMO','ST-021','Structural Works','Reinforcing Steel','Materials','DEMO-04',
   'Rebar supply & fabrication','Cut, bend, deliver rebar','Zone B',
   'Competitive Bid','Unit Price','Main Contract','(To be sourced)',null,
   85,'2026-05-01',null,'2026-09-30','2026-11-15',
   30000000,null,'Not Yet Awarded','Evaluation & Negotiation','Not Awarded','Not Required','No','Not yet Awarded','approved'),

  ('DEMO','AR-031','Architectural Works','Glazing & Curtain Wall','Materials','DEMO-06',
   'Facade glazing & curtain wall','Aluminum framing, glass panels','Zone A',
   'Competitive Bid','Lump Sum','Main Contract','(To be sourced)',null,
   100,'2026-06-25',null,'2026-11-30','2027-01-30',
   18500000,null,'Not Yet Awarded','Solicitation','Not Awarded','Not Required','No','Not yet Awarded','approved'),

  ('DEMO','EL-060','Electrical and Auxiliary Works','Power Distribution','Materials','DEMO-08',
   'Panel boards & distribution','Transformers, panels, cabling','Zone C',
   'Competitive Bid','Lump Sum','Main Contract','(To be sourced)',null,
   110,'2026-09-15',null,'2027-02-28','2027-04-30',
   40000000,null,'Not Yet Awarded','Sourcing','Not Awarded','Not Required','No','Not yet Awarded','approved'),

  ('DEMO','FP-070','Fire Protection Works','Sprinkler System','Materials','DEMO-10',
   'Fire sprinkler supply & install','Pumps, piping, heads','Zone C',
   'Competitive Bid','Lump Sum','Main Contract','(To be sourced)',null,
   95,'2026-10-01',null,'2027-03-31','2027-05-31',
   26000000,null,'Not Yet Awarded','Not Started','Not Awarded','Not Required','Yes','Not yet Awarded','approved');

-- Done. Open it in the app at: project.html?id=DEMO  (read-only for all roles)
