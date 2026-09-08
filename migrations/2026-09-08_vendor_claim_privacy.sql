-- ============================================================================
-- Clear the TIN from a DECLINED vendor registration after 30 days
-- Megawide WPM Dashboard
-- ----------------------------------------------------------------------------
-- Run ONCE in the Supabase SQL Editor. Idempotent, safe to re-run. No temp
-- tables and no state carried between statements (the SQL Editor does not run
-- a file as one transaction).
--
-- WHY
--   `vendor_claims.claimed_tin` was kept forever, including on claims we
--   DECLINED — i.e. sensitive personal information belonging to people we
--   concluded have no relationship with Megawide, retained indefinitely with
--   nothing to justify it. RA 10173 (Data Privacy Act of 2012) s11(e): personal
--   information is retained only as long as necessary for the purpose it was
--   collected for. Once a registration is declined, that purpose is spent.
--
-- ⚠️ WHY A TIN AND NOT THE REST OF THE ROW. For a corporation the TIN is not
--    personal data at all — a juridical person is not a data subject. But a
--    large share of Megawide's suppliers are SOLE PROPRIETORSHIPS, where the
--    TIN is issued to a natural person, which reads onto s3(l)(3) SENSITIVE
--    personal information ("issued by government agencies peculiar to an
--    individual"). That is the item worth clearing. The company name, the
--    claimant's name, the position, the email and the decision itself are the
--    RECORD OF THE DECISION and stay: they are ordinary business-contact
--    information, and deleting them would destroy the audit trail showing a
--    claim was reviewed and refused.
--
-- ⚠️ 30 DAYS, NOT IMMEDIATELY, and that is a deliberate choice. A declined
--    claim is sometimes reconsidered — a reviewer picks the wrong vendor, or
--    the claimant follows up with proof. Clearing the TIN the instant Decline
--    is pressed would make every reconsidered claim a full re-submission. Thirty
--    days is long enough to fix a mistake and short enough to be defensible.
--
-- ⚠️ THE COLLECTION ITSELF IS NOT WHAT THIS FIXES, and did not need fixing:
--    Megawide is legally obliged to hold supplier TINs (BIR Form 2307, the
--    Summary List of Purchases, the alphalist), the same TIN already arrives on
--    the BIR 2303 every vendor uploads for accreditation, and the field is
--    OPTIONAL on the registration form. What was missing was the notice
--    (see vendor-register.html) and this retention limit.
--
-- ⚠️⚠️ THIS WINDOW IS INTERNAL PRACTICE AND IS DELIBERATELY NOT PUBLISHED.
--    vendor-register.html states NOTHING about retention: it defers to Megawide's
--    corporate Privacy Statement ("as long as necessary to fulfill the purposes"),
--    which is the point of a layered notice — the collection point says what and
--    why, the statement says how long. A published interval would be a falsifiable
--    commitment to a data subject resting on a pg_cron job that anyone with database
--    access can silently disable, after which the page is untrue — worse than never
--    having said it. DO NOT "helpfully" put the number on the page to match this
--    file. The asymmetry IS the design: do better than you promise, never promise
--    better than you do. You may shorten or lengthen this window freely — nothing
--    public depends on it.
-- ============================================================================


-- ── 1. the purge ────────────────────────────────────────────────────────────
-- Returns how many rows it cleared, so a manual run in the SQL Editor says
-- what it did rather than reporting nothing.
create or replace function internal.purge_declined_claim_tins()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare n integer;
begin
  update public.vendor_claims
     set claimed_tin = null
   where status = 'rejected'
     and claimed_tin is not null
     and decided_at is not null
     and decided_at < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end
$fn$;

comment on function internal.purge_declined_claim_tins() is
  'Clears claimed_tin from vendor registrations declined more than 30 days ago. '
  'RA 10173 s11(e) retention limit. Scheduled daily via pg_cron; safe to run by '
  'hand in the SQL Editor at any time.';

-- ⚠️ NOBODY CALLS THIS FROM THE APP. It runs as cron (or by hand in the SQL
--    Editor as the owner). A SECURITY DEFINER function that mutates claim rows
--    has no business being reachable from a browser session.
revoke all on function internal.purge_declined_claim_tins() from public, anon, authenticated;


-- ── 2. schedule it, if pg_cron is available ─────────────────────────────────
-- pg_cron is available on Supabase but has to be enabled for the project
-- (Database -> Extensions). Guarded so this migration still applies cleanly on
-- a database where it is not enabled — the function is then simply run by hand.
do $sched$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'purge-declined-claim-tins') then
      perform cron.unschedule('purge-declined-claim-tins');
    end if;
    perform cron.schedule(
      'purge-declined-claim-tins',
      '17 3 * * *',                    -- daily, 03:17 UTC (11:17 PH) — off-peak
      $cron$select internal.purge_declined_claim_tins();$cron$
    );
    raise notice 'Scheduled: purge-declined-claim-tins runs daily at 03:17 UTC.';
  else
    raise notice 'pg_cron is NOT enabled on this project, so nothing was scheduled.';
    raise notice 'Either enable it (Database -> Extensions -> pg_cron) and re-run this file,';
    raise notice 'or run  select internal.purge_declined_claim_tins();  periodically by hand.';
  end if;
end
$sched$;


-- ── 3. clear anything already past the window ───────────────────────────────
select internal.purge_declined_claim_tins() as tins_cleared_now;


-- ── 4. verification — every column must read true ───────────────────────────
-- ⚠️⚠️ NOTHING IN THIS STATEMENT MAY NAME cron.job, AND THAT IS NOT A STYLE
--    RULE — the first version of this file did, and the whole statement died
--    with 42P01 on a database where pg_cron is not enabled.
--
--    A plain SQL statement is parsed IN FULL before any of it runs, so a
--    `case when <guard> then (select ... from cron.job) end` does NOT protect
--    you: the planner resolves cron.job at parse time and fails, however
--    unreachable that branch is at runtime. This is the same trap already
--    recorded for CHECK_migration_status.sql, in its other form.
--
--    Section 2 gets away with it only because it is plpgsql: a DO/function body
--    defers parsing of its SQL statements until they actually execute, so an
--    un-taken branch naming a missing relation is never parsed at all.
--    ⇒ Reach a possibly-missing relation from plpgsql, or through the catalogs
--      (to_regclass), never from a bare SELECT.
select
  (select count(*) = 1 from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'internal' and p.proname = 'purge_declined_claim_tins')  as purge_fn_exists,
  (select p.prosecdef from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'internal' and p.proname = 'purge_declined_claim_tins')  as is_security_definer,
  not has_function_privilege('authenticated',
        'internal.purge_declined_claim_tins()', 'execute')                     as not_callable_by_app,
  (select count(*) = 0 from public.vendor_claims
    where status = 'rejected' and claimed_tin is not null
      and decided_at < now() - interval '30 days')                             as no_stale_tins_left;


-- ── 5. is it actually scheduled? ────────────────────────────────────────────
-- Reported as a NOTICE rather than a column, for the reason in section 4.
-- to_regclass() returns NULL for a missing relation instead of raising, and it
-- is safe even when the whole `cron` SCHEMA is absent.
do $verify$
declare scheduled boolean;
begin
  if to_regclass('cron.job') is null then
    raise notice '--------------------------------------------------------------';
    raise notice 'pg_cron is NOT enabled, so NOTHING IS PURGED AUTOMATICALLY yet.';
    raise notice 'The function exists and works — it just has nothing running it.';
    raise notice 'Either: Database -> Extensions -> enable pg_cron, then re-run this file,';
    raise notice 'or run   select internal.purge_declined_claim_tins();   periodically.';
    raise notice '--------------------------------------------------------------';
  else
    execute 'select exists (select 1 from cron.job where jobname = $1)'
       into scheduled using 'purge-declined-claim-tins';
    if scheduled then
      raise notice 'OK: cron job "purge-declined-claim-tins" is scheduled (daily, 03:17 UTC).';
    else
      raise notice 'pg_cron IS enabled but the job is NOT scheduled — re-run this file.';
    end if;
  end if;
end
$verify$;
