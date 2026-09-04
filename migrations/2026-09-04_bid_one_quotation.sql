-- ═══════════════════════════════════════════════════════════════════════════
-- ONE ATTACHMENT, CALLED THE QUOTATION.
-- Run once, in the Supabase SQL Editor, AFTER 2026-09-04_bid_process.sql.
--
-- WHY
-- ---
-- BP 2.2.3 says a vendor submits a Technical Bid and a Commercial Bid, and that
-- was modelled as two separate uploads. In practice the quotation Megawide
-- receives already carries the technical description of what is being priced —
-- splitting it asks the vendor to cut one document in half for our benefit.
-- Decision 2026-09-04: one upload, called the quotation.
--
-- ⚠️ AND IT WAS ALREADY BROKEN. There are two vendor surfaces and they wrote
--    DIFFERENT COLUMNS:
--      vendor-portal.html (Bid Board)  -> attachment_path   (a direct update)
--      bid-response.html  (token link) -> commercial_path   (this RPC)
--    while bids.html read ONLY commercial_path / technical_path. So a quotation
--    submitted from the portal showed the buyer NO file at all — the offer
--    looked like it arrived with nothing attached. Section 2 recovers those.
--
-- attachment_path / attachment_name are the columns of record from here.
-- commercial_* are kept in step by the RPC so anything still reading them works.
-- technical_* are left alone: nothing writes them any more, and dropping them
-- would throw away files vendors have already uploaded.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. no round asks for two envelopes any more ───────────────────────────
-- ⚠️ This is what disarms the "needs a Technical Bid" refusal for every round
--    that already exists, not just new ones.
alter table public.vendor_bid_rounds alter column two_envelope set default false;
update public.vendor_bid_rounds set two_envelope = false where two_envelope;

-- ── 2. recover the files each surface hid from the other ──────────────────
update public.vendor_bid_invitations
   set attachment_path = commercial_path,
       attachment_name = coalesce(attachment_name, commercial_name)
 where attachment_path is null
   and commercial_path is not null;

-- A round that was genuinely two-envelope may have only a technical file and no
-- price document. Better the buyer sees it than nothing.
update public.vendor_bid_invitations
   set attachment_path = technical_path,
       attachment_name = coalesce(attachment_name, technical_name)
 where attachment_path is null
   and technical_path is not null;

update public.vendor_bid_invitations
   set commercial_path = attachment_path,
       commercial_name = coalesce(commercial_name, attachment_name)
 where commercial_path is null
   and attachment_path is not null;

-- ── 3. the token RPC: one quotation, no technical gate ────────────────────
-- ⚠️ THE SIGNATURE IS UNCHANGED ON PURPOSE. PostgREST resolves an overload by
--    ARGUMENT NAMES, so adding p_attachment_* would leave two candidates and
--    rpc('submit_bid_by_token') would start failing for every vendor. The
--    commercial_* parameters keep their names and now mean "the quotation".
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
  inv    public.vendor_bid_invitations%rowtype;
  q_path text;
  q_name text;
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

  -- The quotation, whichever parameter it arrived in. p_technical_* is accepted
  -- only so an older page that still sends it does not lose the file.
  q_path := coalesce(p_commercial_path, p_technical_path);
  q_name := coalesce(p_commercial_name, p_technical_name);

  -- No "technical bid is required" refusal any more: there is one document.

  update public.vendor_bid_invitations set
    status          = 'submitted',
    offer_amount    = p_offer_amount,
    offer_currency  = coalesce(p_offer_currency, 'PHP'),
    lead_time_days  = p_lead_time_days,
    validity_days   = p_validity_days,
    payment_terms   = p_payment_terms,
    vendor_notes    = p_vendor_notes,
    attachment_path = coalesce(q_path, attachment_path),
    attachment_name = coalesce(q_name, attachment_name),
    commercial_path = coalesce(q_path, commercial_path),
    commercial_name = coalesce(q_name, commercial_name),
    submitted_at    = coalesce(submitted_at, now()),
    declined_reason = null,
    updated_at      = now()
  where id = inv.id;

  return inv.id;
end;
$fn$;

revoke all on function public.submit_bid_by_token(uuid, numeric, text, integer, integer, text, text, text, text, text, text) from public;
grant execute on function public.submit_bid_by_token(uuid, numeric, text, integer, integer, text, text, text, text, text, text) to anon, authenticated;

-- ── 4. verification — every column must read true ─────────────────────────
select
  (select count(*) from public.vendor_bid_rounds where two_envelope) = 0     as no_two_envelope_rounds,
  not exists (select 1 from public.vendor_bid_invitations
               where attachment_path is null
                 and (commercial_path is not null or technical_path is not null))
                                                                             as every_file_reachable,
  (select p.prosrc not like '%Technical Bid%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'submit_bid_by_token')        as technical_gate_gone,
  (select p.prosrc like '%attachment_path = coalesce(q_path%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'submit_bid_by_token')        as writes_attachment,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'submit_bid_by_token') = 1    as exactly_one_overload;
