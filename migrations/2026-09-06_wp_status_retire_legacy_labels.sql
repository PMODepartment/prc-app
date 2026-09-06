-- ─────────────────────────────────────────────────────────────────────────────
-- Retire the pre-2026-07 Procurement Status labels
--
-- The approved roster is  Not Started · Sourced · Solicited · Evaluated · Awarded
-- (see "Status option sets", CLAUDE.md). A handful of rows predate it and still
-- carry the labels it replaced, plus one row carrying an AWARD status in the
-- PROCUREMENT status column. Live tally across ~1,000 work packages when this was
-- written: 1 Sourcing, 1 Solicitation, 1 Evaluation & Negotiation, 1 Not Awarded.
--
-- Nothing computes wrongly today — `VendorDb.bidRounds.procRank` deliberately
-- knows the three legacy labels so they are not mistaken for "further back than
-- Not Started". What they do is READ wrongly, and more so since a bid round began
-- showing its own stage in the present tense: a work package can print "Sourcing"
-- (its own retired stored value) directly under a round pill printing "Sourcing"
-- (the present tense of Sourced), and the two mean different things.
--
-- ⚠️ THE THREE LEGACY MAPPINGS ARE NOT A GUESS. They are the same ones already
--    encoded in procRank — Sourcing → 1, Solicitation → 2, Evaluation &
--    Negotiation → 3 — against the roster's own positions.
--
-- ⚠️ "Not Awarded" IS AN AWARD STATUS, NOT A PROCUREMENT ONE, so it says nothing
--    about how far procurement got and cannot be mapped across. It is derived
--    from the row itself instead: an awarded row becomes Awarded, anything else
--    becomes Not Started — the honest floor. That is the same proc ⇄ award
--    invariant the importer and the WP form maintain (Known Issues #18).
--
-- ⚠️ THIS TOUCHES `procurement_status` ONLY. `award_status`, costs, vendors and
--    dates are left exactly as they are.
--
-- ⚠️ NO AUDIT STAMP. work_packages' updated_by/updated_at are stamped by the
--    CLIENT (`_auditStamp` in db.js), so a raw statement leaves them alone — which
--    is correct: this is data hygiene, not an officer's edit, and attributing it
--    to whoever happens to run it would be worse than leaving it blank.
--
-- Run once, in the Supabase SQL editor. Safe to re-run: the WHERE clause matches
-- only off-roster values, so a second pass reports UPDATE 0.
-- Each statement is self-contained — no temp tables, no session state.
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
    when award_status = 'Awarded'                           then 'Awarded'
    else 'Not Started'
  end                                 as to_status,
  award_status,
  awarded_cost
from public.work_packages
where procurement_status is not null
  and procurement_status not in
      ('Not Started', 'Sourced', 'Solicited', 'Evaluated', 'Awarded')
order by project_id, wp_no;

-- ── 2. APPLY ────────────────────────────────────────────────────────────────
update public.work_packages
set procurement_status = case
      when procurement_status ilike 'sourcing'                then 'Sourced'
      when procurement_status ilike 'solicitation'            then 'Solicited'
      when procurement_status ilike 'evaluation%negotiation%' then 'Evaluated'
      when award_status = 'Awarded'                           then 'Awarded'
      else 'Not Started'
    end
where procurement_status is not null
  and procurement_status not in
      ('Not Started', 'Sourced', 'Solicited', 'Evaluated', 'Awarded');

-- ── 3. VERIFY — off_roster must read 0 ──────────────────────────────────────
select
  count(*) filter (
    where procurement_status is not null
      and procurement_status not in
          ('Not Started', 'Sourced', 'Solicited', 'Evaluated', 'Awarded')
  )                                                              as off_roster,
  count(*) filter (where procurement_status is null)             as unset,
  count(*)                                                       as total
from public.work_packages;

-- ── 4. The roster, for the record ───────────────────────────────────────────
select procurement_status, count(*) as n
from public.work_packages
group by procurement_status
order by n desc;
