-- ═══════════════════════════════════════════════════════════════════════════
-- A NEGOTIATED PRICE IS A DOCUMENT, NOT A TYPED NUMBER.
-- Run once, in the Supabase SQL Editor, AFTER 2026-09-04_bid_one_quotation.sql.
--
-- TWO PROBLEMS, AND THE SECOND IS DATA LOSS
-- -----------------------------------------
-- 1. Staff recorded negotiated_amount by typing into a bare number box. Nothing
--    tied that figure to anything the vendor sent, so it rested entirely on the
--    officer keying it correctly, and a reviewer had no way to check it.
--
-- 2. ⚠️ WORSE: a vendor revising on the Bid Board OVERWROTE offer_amount and
--    replaced attachment_path. The original offer was gone. So "initial offer →
--    negotiated offer" could not be reconstructed at all — not for the award
--    record, not for reporting, not for the vendor's own bid history.
--
-- From here the FIRST submission is the offer and every LATER one is the
-- negotiated position, kept alongside it with its own document.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.vendor_bid_invitations
  add column if not exists negotiated_doc_path text,
  add column if not exists negotiated_doc_name text,
  add column if not exists negotiated_at       timestamptz,
  add column if not exists revision_count      integer not null default 0;

comment on column public.vendor_bid_invitations.negotiated_doc_path is
  'The revised quotation behind negotiated_amount. Written by the vendor when they '
  'resubmit, or uploaded by staff when the revision arrived by email.';
comment on column public.vendor_bid_invitations.revision_count is
  'How many times the vendor has resubmitted. 0 = the original offer only.';

-- ── the token RPC: first submission is the offer, later ones negotiate ────
-- ⚠️ SIGNATURE UNCHANGED. PostgREST resolves an overload by ARGUMENT NAMES, so
--    a new parameter would leave two candidates and every vendor's submit would
--    start failing.
create or replace function public.submit_bid_by_token(
  p_token           uuid,
  p_offer_amount    numeric,
  p_offer_currency  text default 'PHP',
  p_lead_time_days  integer default null,
  p_validity_days   integer default null,
  p_payment_terms   text default null,
  p_vendor_notes    text default null,
  p_commercial_path text default null,
  p_commercial_name text default null,
  p_technical_path  text default null,
  p_technical_name  text default null
) returns uuid
language plpgsql
security definer
set search_path = public, internal
as $fn$
declare
  inv     public.vendor_bid_invitations%rowtype;
  q_path  text;
  q_name  text;
  is_rev  boolean;
begin
  select * into inv from public.vendor_bid_invitations where access_token = p_token;
  if inv.id is null then
    raise exception 'This link is not valid.' using errcode = '42501';
  end if;
  if not internal.bid_token_open(p_token) then
    raise exception 'This invitation is closed and can no longer be answered.'
      using errcode = '42501',
            hint = 'Contact your Megawide Procurement contact if you need it re-opened.';
  end if;
  if p_offer_amount is null or p_offer_amount < 0 then
    raise exception 'Enter your offer amount before submitting.' using errcode = '23514';
  end if;

  q_path := coalesce(p_commercial_path, p_technical_path);
  q_name := coalesce(p_commercial_name, p_technical_name);

  -- ⚠️ THE ORIGINAL OFFER IS WRITTEN ONCE AND NEVER AGAIN.
  is_rev := inv.submitted_at is not null;

  update public.vendor_bid_invitations set
    status          = 'submitted',
    -- first time only
    offer_amount    = case when is_rev then offer_amount    else p_offer_amount end,
    attachment_path = case when is_rev then attachment_path else coalesce(q_path, attachment_path) end,
    attachment_name = case when is_rev then attachment_name else coalesce(q_name, attachment_name) end,
    commercial_path = case when is_rev then commercial_path else coalesce(q_path, commercial_path) end,
    commercial_name = case when is_rev then commercial_name else coalesce(q_name, commercial_name) end,
    -- every time after that
    negotiated_amount   = case when is_rev then p_offer_amount else negotiated_amount end,
    negotiated_doc_path = case when is_rev then coalesce(q_path, negotiated_doc_path) else negotiated_doc_path end,
    negotiated_doc_name = case when is_rev then coalesce(q_name, negotiated_doc_name) else negotiated_doc_name end,
    negotiated_at       = case when is_rev then now() else negotiated_at end,
    revision_count      = revision_count + case when is_rev then 1 else 0 end,
    -- these describe the offer as it now stands either way
    offer_currency  = coalesce(p_offer_currency, 'PHP'),
    lead_time_days  = p_lead_time_days,
    validity_days   = p_validity_days,
    payment_terms   = p_payment_terms,
    vendor_notes    = p_vendor_notes,
    -- Only on the FIRST submission: a revision does not reset the clock the
    -- BAC recorded.
    submitted_at    = coalesce(submitted_at, now()),
    declined_reason = null,
    updated_at      = now()
  where id = inv.id;

  return inv.id;
end;
$fn$;

revoke all on function public.submit_bid_by_token(uuid, numeric, text, integer, integer, text, text, text, text, text, text) from public;
grant execute on function public.submit_bid_by_token(uuid, numeric, text, integer, integer, text, text, text, text, text, text) to anon, authenticated;


-- ── the vendor must SEE their revision, or they think it did not save ─────
-- ⚠️ bid_by_token builds its json field by field and that allow-list IS the
--    access control. These four are the vendor's OWN figures, so there is
--    nothing to withhold — but they still have to be added deliberately.
--    Everything else in this function is unchanged; NEVER add a budget, an
--    awarded cost, or any column naming another bidder.
do $mig$
declare
  src text;
begin
  select p.prosrc into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'bid_by_token'
     and p.pronargs = 1;
  if src is null then
    raise exception 'bid_by_token not found — run 2026-09-04_bid_process.sql first';
  end if;
  if position('negotiated_amount' in src) > 0 then
    raise notice 'bid_by_token already exposes the negotiated figures — nothing to do';
    return;
  end if;
  -- Inject the four keys next to the rest of "the answer so far", by rewriting
  -- one anchor line. Textual, but exact and asserted both ways.
  if position('    ''submitted_at'',    i.submitted_at,' in src) = 0 then
    raise exception 'bid_by_token has been edited — add the negotiated keys by hand';
  end if;
  src := replace(src,
    '    ''submitted_at'',    i.submitted_at,',
    '    ''negotiated_amount'',   i.negotiated_amount,'   || chr(10) ||
    '    ''negotiated_doc_name'', i.negotiated_doc_name,' || chr(10) ||
    '    ''negotiated_at'',       i.negotiated_at,'       || chr(10) ||
    '    ''revision_count'',      i.revision_count,'      || chr(10) ||
    '    ''submitted_at'',    i.submitted_at,');
  execute 'create or replace function public.bid_by_token(p_token uuid) returns jsonb '
       || 'language plpgsql stable security definer set search_path = public, internal as '
       || quote_literal(src);
  raise notice 'bid_by_token now returns the negotiated figures';
end;
$mig$;

revoke all on function public.bid_by_token(uuid) from public;
grant execute on function public.bid_by_token(uuid) to anon, authenticated;

-- Staff read the base table directly, so bids.html picks the new columns up
-- with no view change. vendor_bid_board_view is the VENDOR's read and is
-- deliberately left alone here: the Bid Board shows a vendor their own offer,
-- and bid_by_token above is what carries the revision back to them.

-- ── verification — every column must read true ───────────────────────
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'vendor_bid_invitations'
      and column_name in ('negotiated_doc_path','negotiated_doc_name',
                          'negotiated_at','revision_count')) = 4          as columns_added,
  (select p.prosrc like '%is_rev := inv.submitted_at is not null%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'submit_bid_by_token')     as first_submission_is_the_offer,
  (select p.prosrc like '%negotiated_amount   = case when is_rev%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'submit_bid_by_token')     as revision_negotiates,
  (select p.prosrc like '%negotiated_amount%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'bid_by_token')            as vendor_sees_revision,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'submit_bid_by_token') = 1 as exactly_one_overload;
