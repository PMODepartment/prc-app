-- ─────────────────────────────────────────────────────────────────────────────
-- Retire the pre-2026-07 Procurement Status labels
--
-- The approved roster is  Not Started · Sourced · Solicited · Evaluated · Awarded
-- (see "Status option sets", CLAUDE.md). Measured live with a server-side count,
-- so no 1000-row cap: 1,870 work packages, 0 with a null status, and FOUR off the
-- roster.
--
--   DEMO    DEMO-04  Rebar supply & fabrication      Evaluation & Negotiation
--   DEMO    DEMO-06  Facade glazing & curtain wall   Solicitation
--   DEMO    DEMO-08  Panel boards & distribution     Sourcing
--   STM101  55       Additional Requirements ...     Not Awarded
--
-- ⚠️ THIS MIGRATION CHANGES THREE OF THEM, NOT FOUR. The first three are the
--    retired labels for roster values and the rename carries no information:
--    Sourcing IS Sourced, Solicitation IS Solicited, Evaluation & Negotiation IS
--    Evaluated. Those are the same mappings already encoded in
--    `VendorDb.bidRounds.procRank` against the roster's own positions, so this is
--    not a guess and the work package means exactly what it meant before.
--
-- ⚠️ STM101 WP 55 IS DELIBERATELY LEFT ALONE — see section 3. "Not Awarded" is an
--    AWARD status sitting in the PROCUREMENT column, so there is no synonym to
--    rename it to; any value would be inferred rather than translated, and that
--    row carries ₱38.7M of provisional cost and a list of proposed vendors, so
--    "Not Started" would plainly understate it while anything higher would be
--    invented. Its award dimension is already recorded correctly
--    (award_status = 'Not Yet Awarded'). A person who knows how far that package
--    actually got should set it — one dropdown on the WP form.
--
-- ⚠️ EVERY WORK PACKAGE ALREADY ON THE ROSTER IS UNTOUCHED, by construction: the
--    WHERE clause matches only the three retired labels. 1,866 of 1,870 rows are
--    not considered at all.
--
-- ⚠️ TOUCHES `procurement_status` ONLY. award_status, costs, vendors and dates are
--    left exactly as they are.
--
-- ⚠️ NO AUDIT STAMP. work_packages' updated_by/updated_at are stamped by the
--    CLIENT (`_auditStamp` in db.js), so a raw statement leaves them alone — which
--    is correct: this is data hygiene, not an officer's edit.
--
-- Run once, in the Supabase SQL editor. Safe to re-run: a second pass reports
-- UPDATE 0. Each statement is self-contained — no temp tables, no session state.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. WHAT WILL CHANGE — read this before running section 2 ────────────────
select
  project_id,
  wp_no,
  left(coalesce(description, ''), 60) as description,
  procurement_status                  as from_status,
  case
    when procurement_status ilike 'sourcing'                then 'Sourced'
    when procurement_status ilike 'solicitation'            then 'Solicited'
    when procurement_status ilike 'evaluation%negotiation%' then 'Evaluated'
  end                                 as to_status,
  award_status
from public.work_packages
where procurement_status ilike any (array['sourcing', 'solicitation', 'evaluation%negotiation%'])
order by project_id, wp_no;

-- ── 2. APPLY ────────────────────────────────────────────────────────────────
update public.work_packages
set procurement_status = case
      when procurement_status ilike 'sourcing'                then 'Sourced'
      when procurement_status ilike 'solicitation'            then 'Solicited'
      when procurement_status ilike 'evaluation%negotiation%' then 'Evaluated'
    end
where procurement_status ilike any (array['sourcing', 'solicitation', 'evaluation%negotiation%']);

-- ── 3. LEFT FOR A PERSON TO DECIDE — expected: STM101 WP 55 ─────────────────
-- Not a failure. These carry a value that is not a retired label and has no
-- synonym on the roster, so no rename is possible. Set each one from the WP form
-- once you know how far that package actually got.
select
  project_id, wp_no,
  left(coalesce(description, ''), 60) as description,
  procurement_status                  as off_roster_value,
  award_status, awarded_cost,
  left(coalesce(contractor, ''), 60)  as vendors
from public.work_packages
where procurement_status is not null
  and procurement_status not in
      ('Not Started', 'Sourced', 'Solicited', 'Evaluated', 'Awarded')
order by project_id, wp_no;

-- ── 4. VERIFY — retired_labels must read 0 ──────────────────────────────────
select
  count(*) filter (
    where procurement_status ilike any (array['sourcing', 'solicitation', 'evaluation%negotiation%'])
  )                                                              as retired_labels,
  count(*) filter (
    where procurement_status is not null
      and procurement_status not in
          ('Not Started', 'Sourced', 'Solicited', 'Evaluated', 'Awarded')
  )                                                              as still_off_roster,
  count(*)                                                       as total
from public.work_packages;
