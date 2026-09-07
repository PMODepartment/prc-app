-- ============================================================================
-- The bidder is TOLD which VAT basis to quote on (2026-09-07)
--
-- Reported from a live bid page: "The bid response doesn't state that the offer
-- is vat-in/vat-ex unlike in the bid management page for Megawide procurement."
-- Correct — staff have carried `tax_basis` / `vat_rate` per round and per bidder
-- since 2026-09-05_bid_vat_basis.sql (the whole reason the comparison can rank
-- bidders on a NET figure), but `bid_by_token` never returned it, so the vendor
-- filling in "Offer amount" had nothing on screen telling them which basis we
-- want. Two bidders reading that differently is a 12% error in the comparison.
--
-- ⚠️ ONLY THE ROUND'S *ASKED-FOR* BASIS IS EXPOSED (r.tax_basis / r.vat_rate).
--    `vendor_bid_invitations.tax_basis` is the STAFF's own confirmation of what
--    that bidder actually quoted ("not confirmed — assume as asked"), i.e. an
--    internal assessment of their submission. It is not theirs to read, and the
--    field list of this function IS the access control — same rule that keeps
--    the budget, the awarded cost and every other bidder's name out of it.
--    Never add i.tax_basis / i.vat_rate here.
--
-- ⚠️ REWRITES bid_by_token BY SOURCE, the same way
--    2026-09-04_bid_negotiated_quotation.sql does, so the negotiated keys that
--    migration injected are preserved. It asserts its anchor line exists and
--    is a no-op when already applied, so it is safe to re-run.
--
-- Prerequisite: 2026-09-05_bid_vat_basis.sql (creates the columns).
-- Run AFTER: 2026-09-04_bid_process.sql, 2026-09-04_bid_negotiated_quotation.sql
-- ============================================================================

-- 1. Refuse clearly if the columns this depends on are not there yet, rather
--    than producing a function that selects a column that does not exist.
do $mig$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'vendor_bid_rounds'
       and column_name = 'tax_basis'
  ) then
    raise exception 'vendor_bid_rounds.tax_basis is missing — run migrations/2026-09-05_bid_vat_basis.sql first';
  end if;
end;
$mig$;

-- 2. Inject the two keys into "the ask" block of bid_by_token.
do $mig$
declare
  src text;
begin
  select p.prosrc into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'bid_by_token'
     and p.pronargs = 1;
  if src is null then
    raise exception 'bid_by_token not found — run migrations/2026-09-04_bid_process.sql first';
  end if;
  if position('asked_tax_basis' in src) > 0 then
    raise notice 'bid_by_token already states the VAT basis — nothing to do';
    return;
  end if;
  -- The anchor sits in "the ask" block and has not been touched by any prior
  -- rewrite (only the 'submitted_at' line has). Asserted rather than assumed.
  if position('    ''payment_terms_required'', r.payment_terms,' in src) = 0 then
    raise exception 'bid_by_token has been edited — add the VAT keys by hand';
  end if;
  src := replace(src,
    '    ''payment_terms_required'', r.payment_terms,',
    '    ''payment_terms_required'', r.payment_terms,' || chr(10) ||
    '    ''asked_tax_basis'', r.tax_basis,'            || chr(10) ||
    '    ''asked_vat_rate'',  r.vat_rate,');
  execute 'create or replace function public.bid_by_token(p_token uuid) returns jsonb '
       || 'language plpgsql stable security definer set search_path = public, internal as '
       || quote_literal(src);
  raise notice 'bid_by_token now states the VAT basis the round asked for';
end;
$mig$;

-- 3. Grants are re-applied because create or replace resets nothing, but a
--    revoke-then-grant keeps this file self-contained and idempotent.
revoke all on function public.bid_by_token(uuid) from public;
grant execute on function public.bid_by_token(uuid) to anon, authenticated;

-- 4. Verification — every column must read true.
select
  (select position('asked_tax_basis' in p.prosrc) > 0
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'bid_by_token'
      and p.pronargs = 1)                                        as states_the_basis,
  (select position('asked_vat_rate' in p.prosrc) > 0
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'bid_by_token'
      and p.pronargs = 1)                                        as states_the_rate,
  -- ⚠️ the bidder must NOT be handed staff's own confirmation of their basis
  (select position('i.tax_basis' in p.prosrc) = 0
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'bid_by_token'
      and p.pronargs = 1)                                        as withholds_staff_confirmation,
  -- the negotiated keys the earlier migration injected must have survived
  (select position('negotiated_amount' in p.prosrc) > 0
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'bid_by_token'
      and p.pronargs = 1)                                        as negotiated_keys_kept,
  (select count(*) = 1
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'bid_by_token')    as exactly_one_overload;
