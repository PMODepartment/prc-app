-- ─────────────────────────────────────────────────────────────────────────────
-- DEMO-08 (Panel boards & distribution) — fill out the ask, and de-duplicate
-- DEMO-04's priced items.
--
-- DEMO project sample data, not schema. Committed for the same reason
-- 2026-07-08_seed_demo_project.sql is: every name and figure here is
-- FICTIONAL, so there is nothing to keep out of a public repo. ⚠️ Never put
-- real vendor or project data in a committed .sql — GitHub Pages serves this
-- whole repo publicly.
--
-- Run in the Supabase SQL Editor. Idempotent: re-running changes nothing.
-- ⚠️ NO TEMP TABLES AND NO CROSS-STATEMENT STATE — the SQL Editor does not run
--    a script as one transaction and may pool statements across backends, the
--    lesson from SEED_vendor_accreditation.sql. Every statement below stands
--    alone and can be run one at a time or all at once.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. DEMO-04: remove the duplicate priced items ───────────────────────────
-- Reported from the live cost comparison: nine lines numbered 1-5, one set
-- priced and one set blank. Two seeding passes with reworded descriptions, and
-- nothing enforces one line per number — so each bidder priced the set they
-- were given and the other half rendered as dashes, which makes the comparison
-- look like it is measuring a scope nobody quoted.
--
-- ⚠️ DELETES ONLY THE UNPRICED COPY, and only where a priced twin exists under
--    the same number. A line somebody has quoted is evidence; if BOTH copies of
--    a number carry prices this deletes neither and leaves it for a human.
delete from public.vendor_bid_items d
where d.round_id in (
        select r.id
          from public.vendor_bid_rounds r
          join public.work_packages w on w.id = r.wp_id
         where w.project_id = 'DEMO' and w.wp_no = 'DEMO-04')
  -- this copy has no prices against it at all …
  and not exists (select 1 from public.vendor_bid_item_prices p where p.item_id = d.id)
  -- … while another line under the same number does
  and exists (
        select 1
          from public.vendor_bid_items k
          join public.vendor_bid_item_prices p on p.item_id = k.id
         where k.round_id = d.round_id
           and k.id <> d.id
           and coalesce(btrim(k.item_no), '') = coalesce(btrim(d.item_no), ''));

-- ── 2. DEMO-08: the priced items ────────────────────────────────────────────
-- A panel-board BOQ. `where not exists` on (round_id, item_no) is what makes
-- this re-runnable without producing exactly the duplicates section 1 cleans up.
insert into public.vendor_bid_items (round_id, item_no, description, spec, unit, quantity, sort_order)
select r.id, v.item_no, v.description, v.spec, v.unit, v.quantity, v.sort_order
  from public.vendor_bid_rounds r
  join public.work_packages w on w.id = r.wp_id
  cross join (values
    ('1', 'Main distribution panel, 1600A',
        '3-phase 4-wire 400V, form 3b, 65kA icu, copper busbar', 'unit', 1, 0),
    ('2', 'Sub-distribution panel, 400A',
        '3-phase 4-wire 400V, form 2b, 36kA icu', 'unit', 6, 1),
    ('3', 'Lighting and power panel, 225A',
        'Surface mount, 42-pole, bolt-on breakers', 'unit', 18, 2),
    ('4', 'Automatic transfer switch, 800A',
        '4-pole, closed transition, utility to genset', 'unit', 1, 3),
    ('5', 'Capacitor bank, 200 kVAR',
        'Automatic, 6-step, detuned 7% reactor', 'unit', 1, 4),
    ('6', 'Panel schedules, testing and commissioning',
        'Including as-built schedules and megger test reports', 'lot', 1, 5)
  ) as v(item_no, description, spec, unit, quantity, sort_order)
 where w.project_id = 'DEMO' and w.wp_no = 'DEMO-08'
   and not exists (
         select 1 from public.vendor_bid_items x
          where x.round_id = r.id and coalesce(btrim(x.item_no), '') = v.item_no);

-- ── 3. DEMO-08: the technical requirements ──────────────────────────────────
-- ⚠️ THE MANDATORY/PREFERRED SPLIT IS THE POINT OF THE SAMPLE. A mandatory line
--    not met disqualifies a bid whatever it costs, so the demo has to contain a
--    cheap bidder who fails one — otherwise it teaches that lowest price wins.
insert into public.vendor_bid_requirements (round_id, requirement, detail, mandatory, sort_order)
select r.id, v.requirement, v.detail, v.mandatory, v.sort_order
  from public.vendor_bid_rounds r
  join public.work_packages w on w.id = r.wp_id
  cross join (values
    ('Type-tested assembly to IEC 61439-2',
        'Certificate from an accredited laboratory, not a declaration', true, 0),
    ('Form 3b separation on the main panel',
        'Busbar separated from functional units and from terminals', true, 1),
    ('65kA icu withstand on the main panel',
        'Matched to the utility fault level at the substation', true, 2),
    ('Copper busbar throughout',
        'Aluminium is not accepted on any distribution board', true, 3),
    ('Local service centre and spares',
        'Within Metro Manila, 24-hour response', false, 4),
    ('Factory witness testing offered',
        'Preferred — Megawide to witness routine tests before shipment', false, 5)
  ) as v(requirement, detail, mandatory, sort_order)
 where w.project_id = 'DEMO' and w.wp_no = 'DEMO-08'
   and not exists (
         select 1 from public.vendor_bid_requirements x
          where x.round_id = r.id and x.requirement = v.requirement);

-- ── 4. Verify ───────────────────────────────────────────────────────────────
-- Expect DEMO-08 to read 6 items / 6 requirements, and DEMO-04 to read one
-- line per number (dup_numbers = 0).
select w.wp_no,
       r.stage,
       (select count(*) from public.vendor_bid_items q        where q.round_id = r.id) as items,
       (select count(*) from public.vendor_bid_requirements q where q.round_id = r.id) as requirements,
       (select count(*) from (
            select btrim(q.item_no) AS n
              from public.vendor_bid_items q
             where q.round_id = r.id and coalesce(btrim(q.item_no), '') <> ''
             group by btrim(q.item_no) having count(*) > 1) d)                         as dup_numbers
  from public.vendor_bid_rounds r
  join public.work_packages w on w.id = r.wp_id
 where w.project_id = 'DEMO' and w.wp_no in ('DEMO-04', 'DEMO-08')
 order by w.wp_no, r.round_no;
