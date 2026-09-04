-- ════════════════════════════════════════════════════════════════════════════
-- Bid process: the award basis Megawide actually uses, and threaded
-- clarifications.  Run me AFTER migrations/2026-09-04_bid_process.sql.
--
-- WHY
-- ---
-- Two corrections that came out of driving a live round (2026-09-04).
--
-- (a) The evaluation carried `technical_result` in ('pass','conditional','fail')
--     and a free `technical_score`. Neither is traceable to the Megawide process
--     mapping — grep the BP notes and they appear nowhere but the page's own
--     code. The award basis, per Procurement, is actually two things:
--        1. compliance with the technical requirements (design criteria / TOR)
--        2. the lowest bid in the cost comparison
--     So compliance is a YES/NO fact against the TOR, not a graded verdict, and
--     the ranking comes from the comparison workbook rather than a typed score.
--
--     ⚠️ The old columns are LEFT IN PLACE and simply stop being written.
--        Dropping them would destroy the evaluation already recorded on live
--        rounds, and buys nothing.
--
-- (b) Clarifications were one flat stream per bidder, so a technical question
--     and a payment-terms question interleaved. A category turns that stream
--     into threads without inventing a thread-id to maintain: messages sharing
--     a category ARE the thread.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Compliance with the technical requirements ───────────────────────────
alter table vendor_bid_invitations
  add column if not exists technical_compliant boolean;

comment on column vendor_bid_invitations.technical_compliant is
  'Does this bid meet the technical requirements (design criteria / terms of '
  'reference)? One of the two stated bases for award, the other being the '
  'lowest bid in the cost comparison. NULL = not yet assessed. Replaces the '
  'pass/conditional/fail technical_result, which was not from the process map.';

-- ── 2. Clarification categories ─────────────────────────────────────────────
-- The roster is deliberately plain text with a CHECK rather than an enum, so it
-- can change without a type migration — the same reasoning as vendors.accreditation.
alter table vendor_bid_clarifications
  add column if not exists category text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vbc_category_check') then
    alter table vendor_bid_clarifications
      add constraint vbc_category_check
      check (category is null or category in
             ('technical','commercial','schedule','documents','other'));
  end if;
end $$;

comment on column vendor_bid_clarifications.category is
  'Which thread this message belongs to for one bidder: technical | commercial '
  '| schedule | documents | other. NULL on rows written before this migration; '
  'the UI files those under "other". Messages sharing a category ARE the thread.';

create index if not exists idx_vbc_thread
  on vendor_bid_clarifications (invitation_id, category, created_at);

-- ── 3. the vendor's reply carries the thread it belongs to ──────────────────
-- ⚠️ DROP THE OLD SIGNATURE, do not merely add a new one. PostgREST resolves
--    overloads by ARGUMENT NAMES, so leaving clarify_bid_by_token(uuid,text)
--    beside a 3-argument version makes rpc('clarify_bid_by_token') ambiguous and
--    every vendor reply starts failing. Same trap as the 5-argument
--    submit_vendor_claim in 2026-09-03_vendor_claim_tin_only.sql.
drop function if exists public.clarify_bid_by_token(uuid, text);

create or replace function public.clarify_bid_by_token(
  p_token uuid, p_message text, p_category text default null)
returns uuid
language plpgsql
security definer
set search_path = public, internal
as $fn$
declare
  inv public.vendor_bid_invitations%rowtype;
  cat text;
  new_id uuid;
begin
  select * into inv from public.vendor_bid_invitations where access_token = p_token;
  if inv.id is null then
    raise exception 'This link is not valid.' using errcode = '42501';
  end if;
  if btrim(coalesce(p_message,'')) = '' then
    raise exception 'Write your reply first.' using errcode = '23514';
  end if;
  -- ⚠️ Still deliberately NOT gated on bid_token_open: clarification happens
  --    AFTER the bid deadline, so the check that stops late PRICING must not
  --    stop a reply. Closed once the round is awarded or cancelled.
  if exists (select 1 from public.vendor_bid_rounds
              where id = inv.round_id and stage in ('awarded','cancelled')) then
    raise exception 'This bid is closed.' using errcode = '42501';
  end if;

  -- An unknown category is filed under 'other' rather than rejected: a vendor
  -- reply must never be lost to a vocabulary mismatch.
  cat := lower(btrim(coalesce(p_category, '')));
  if cat not in ('technical','commercial','schedule','documents','other') then
    cat := 'other';
  end if;

  insert into public.vendor_bid_clarifications
    (invitation_id, round_id, author, message, category, created_by_name)
  values
    (inv.id, inv.round_id, 'vendor', btrim(p_message), cat,
     (select name from public.vendors where id = inv.vendor_id))
  returning id into new_id;
  return new_id;
end;
$fn$;

revoke all on function public.clarify_bid_by_token(uuid, text, text) from public;
grant execute on function public.clarify_bid_by_token(uuid, text, text) to anon, authenticated;

-- ── 4. the vendor reads the thread it is replying to ────────────────────────
create or replace function public.bid_clarifications_by_token(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, internal
as $fn$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'author', c.author, 'message', c.message,
           'category', coalesce(c.category, 'other'),
           'created_at', c.created_at,
           -- A staff author shows as the department, never an individual.
           'from', case when c.author = 'staff' then 'Megawide Procurement'
                        else coalesce(c.created_by_name, 'You') end
         ) order by c.created_at), '[]'::jsonb)
    from public.vendor_bid_clarifications c
    join public.vendor_bid_invitations i on i.id = c.invitation_id
   where i.access_token = p_token;
$fn$;

revoke all on function public.bid_clarifications_by_token(uuid) from public;
grant execute on function public.bid_clarifications_by_token(uuid) to anon, authenticated;

-- ── 5. verification — every column must read `true` ─────────────────────────
select
  (select count(*) = 1 from information_schema.columns
    where table_schema='public' and table_name='vendor_bid_invitations'
      and column_name='technical_compliant')                                as compliance_column,
  (select count(*) = 1 from information_schema.columns
    where table_schema='public' and table_name='vendor_bid_clarifications'
      and column_name='category')                                           as category_column,
  (select count(*) = 1 from pg_constraint where conname='vbc_category_check') as category_checked,
  (select count(*) = 1 from pg_indexes where indexname='idx_vbc_thread')     as thread_index,
  -- exactly ONE clarify_bid_by_token, or PostgREST cannot resolve the call
  (select count(*) = 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='clarify_bid_by_token')           as exactly_one_overload,
  (select p.pronargs = 3 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='clarify_bid_by_token')           as takes_category,
  (select bool_and(p.prosecdef) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in
      ('clarify_bid_by_token','bid_clarifications_by_token'))                as still_definer;
