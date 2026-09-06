-- ─────────────────────────────────────────────────────────────────────────────
-- The bidder prices the lines themselves
--
-- Until now the bid link collected ONE headline figure plus terms and a
-- quotation file, so every per-line rate in the cost comparison was the officer
-- transcribing from a PDF. The ask already travels to the bidder — they receive
-- the priced items through bid_reference_by_token — so the only thing missing
-- was a way for them to answer it line by line.
--
-- ⚠️⚠️ THIS CANNOT BE A TABLE POLICY. vendor_bid_item_prices holds EVERY
--    bidder's prices, and a bidder answering from their link has no login at
--    all: auth.uid() is null, so RLS has nothing to identify them by. The table
--    therefore stays exactly as it is — staff-only, no vendor policy — and the
--    bidder reaches it only through the SECURITY DEFINER RPCs below, which
--    derive the invitation FROM THE TOKEN and never from anything the client
--    sends. Same shape as submit_bid_by_token.
--
-- ⚠️ A SEPARATE RPC, NOT A NEW PARAMETER ON submit_bid_by_token. PostgREST
--    resolves overloads by ARGUMENT NAMES, so adding one would create a second
--    overload and every vendor's submit would start failing on an ambiguous
--    call. That is a live hazard here: submit_bid_by_token has already had to
--    keep its parameter names for exactly this reason.
--
-- Run once, after migrations/2026-09-05_bid_cost_comparison.sql. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Who typed this line ──────────────────────────────────────────────────
-- ⚠️ EXPLICIT, NOT INFERRED. "updated_by is null so it must be the vendor"
--    would be a guess, and the app has been bitten before by inferring intent
--    from an absent value (see free_of_charge). The officer needs to know at a
--    glance which figures are the bidder's own and which are their own
--    transcription, because only one of those is evidence.
alter table public.vendor_bid_item_prices
  add column if not exists entered_by_vendor boolean not null default false;

comment on column public.vendor_bid_item_prices.entered_by_vendor is
  'True when the bidder submitted this line through their own bid link. Set '
  'false again the moment an officer edits it, so the flag always means '
  '"exactly as the bidder sent it".';

-- ── 2. The bidder reads back their OWN lines ────────────────────────────────
-- So a revision starts from what they last sent rather than from an empty form.
-- ⚠️ SCOPED TO inv.id. This is the one function a bidder can call that touches a
--    table holding their competitors' prices; the WHERE clause is the whole of
--    the access control, and it must never widen to round_id.
create or replace function public.bid_lines_by_token(p_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, internal
as $fn$
declare
  inv public.vendor_bid_invitations%rowtype;
begin
  select * into inv from public.vendor_bid_invitations where access_token = p_token;
  -- Same empty answer as an expired token: never confirm a token exists.
  if inv.id is null then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'item_id',   p.item_id,
             'quantity',  p.quantity,
             'unit',      p.unit,
             'unit_rate', p.unit_rate,
             'amount',    p.amount,
             'status',    p.status,
             'note',      p.note))
      from public.vendor_bid_item_prices p
     where p.invitation_id = inv.id), '[]'::jsonb);
end;
$fn$;

revoke all on function public.bid_lines_by_token(uuid) from public;
grant execute on function public.bid_lines_by_token(uuid) to anon, authenticated;

-- ── 3. The bidder writes their own lines ────────────────────────────────────
create or replace function public.submit_bid_lines_by_token(p_token uuid, p_lines jsonb)
returns integer
language plpgsql
security definer
set search_path = public, internal
as $fn$
declare
  inv    public.vendor_bid_invitations%rowtype;
  ln     jsonb;
  v_item uuid;
  v_st   text;
  n      integer := 0;
begin
  select * into inv from public.vendor_bid_invitations where access_token = p_token;
  if inv.id is null then
    raise exception 'This link is not valid.' using errcode = '42501';
  end if;
  -- ⚠️ DEADLINE-GATED, unlike clarifications. This IS pricing, and pricing after
  --    the deadline is exactly what the deadline exists to stop.
  if not internal.bid_token_open(p_token) then
    raise exception 'This bid is closed and can no longer be priced.' using errcode = '42501';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'Lines must be a list.' using errcode = '22023';
  end if;

  for ln in select value from jsonb_array_elements(p_lines)
  loop
    begin
      v_item := nullif(ln->>'item_id', '')::uuid;
    exception when others then
      v_item := null;
    end;
    -- ⚠️ THE ITEM MUST BELONG TO THIS BIDDER'S OWN ROUND. Without this a crafted
    --    payload could write a price row against another round's line item.
    --    Skipped rather than raised: one unknown id must not throw away the rest
    --    of a bidder's pricing.
    if v_item is null or not exists (
      select 1 from public.vendor_bid_items it
       where it.id = v_item and it.round_id = inv.round_id) then
      continue;
    end if;

    v_st := coalesce(nullif(ln->>'status', ''), 'quoted');
    if v_st not in ('quoted', 'included', 'excluded', 'no_bid') then
      v_st := 'quoted';
    end if;

    insert into public.vendor_bid_item_prices
      (invitation_id, item_id, quantity, unit, unit_rate, amount, status, note,
       entered_by_vendor, updated_at, updated_by_name)
    values
      (inv.id, v_item,
       nullif(ln->>'quantity', '')::numeric,
       nullif(ln->>'unit', ''),
       nullif(ln->>'unit_rate', '')::numeric,
       nullif(ln->>'amount', '')::numeric,
       v_st,
       nullif(ln->>'note', ''),
       true, now(), 'Bidder')
    on conflict (invitation_id, item_id) do update
      set quantity          = excluded.quantity,
          unit              = excluded.unit,
          unit_rate         = excluded.unit_rate,
          amount            = excluded.amount,
          status            = excluded.status,
          note              = excluded.note,
          entered_by_vendor = true,
          updated_at        = now(),
          updated_by_name   = 'Bidder';
    n := n + 1;
  end loop;
  return n;
end;
$fn$;

revoke all on function public.submit_bid_lines_by_token(uuid, jsonb) from public;
grant execute on function public.submit_bid_lines_by_token(uuid, jsonb) to anon, authenticated;

comment on function public.submit_bid_lines_by_token(uuid, jsonb) is
  'A bidder prices the round''s line items from their own capability link. The '
  'invitation is derived from the token, every item id is checked against that '
  'invitation''s round, and the table itself stays staff-only.';

-- ── 4. Verify — every row must read true ────────────────────────────────────
select
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'vendor_bid_item_prices'
             and column_name = 'entered_by_vendor')                    as flag_present,
  to_regprocedure('public.bid_lines_by_token(uuid)')        is not null as read_rpc,
  to_regprocedure('public.submit_bid_lines_by_token(uuid,jsonb)')
                                                            is not null as write_rpc,
  -- the table must still have exactly its one staff policy: no vendor path
  (select count(*) = 1 from pg_policies
     where schemaname = 'public' and tablename = 'vendor_bid_item_prices')
                                                                       as staff_only,
  (select prosecdef from pg_proc where oid =
     to_regprocedure('public.submit_bid_lines_by_token(uuid,jsonb)'))   as write_is_definer;
