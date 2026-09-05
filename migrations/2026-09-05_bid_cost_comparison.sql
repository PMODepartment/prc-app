-- ============================================================================
-- Bid Management: the cost comparison and the technical comparison
-- Run ONCE, in the Supabase SQL Editor, AFTER 2026-09-05_bid_reference_docs.sql
-- ============================================================================
--
-- WHY
-- ---
-- Until now a bidder was ONE headline figure (vendor_bid_invitations.offer_amount)
-- and ONE boolean (technical_compliant). That cannot answer the question a
-- buyer actually has to answer:
--
--   "Vendor A meets every line of the TOR but is dear. Vendor B is cheaper but
--    misses three requirements. Vendor C is cheapest on the busducts and the
--    dearest on the accessories. Which do we award?"
--
-- The real cost comparison workbooks (e.g. "MCC. PRC. 4PH Busducts - Cost
-- Comparison") are a line-item BOQ with QTY / UoM / RATE / TOTAL per bidder,
-- against the same item list, plus a set of technical attributes each bidder
-- either meets or does not. This adds exactly that, as data:
--
--   vendor_bid_requirements         the TOR lines a bidder is judged against
--   vendor_bid_requirement_results  per bidder, per requirement: met / not
--   vendor_bid_item_prices          per bidder, per priced item: rate + amount
--   vendor_bid_item_budget          per item, the BUDGETED rate and amount
--
-- THE BUDGET IS A SEPARATE TABLE, AND THAT IS THE WHOLE REASON IT EXISTS.
--   The obvious move is: alter table vendor_bid_items add column budget_rate.
--   It is wrong. An invited vendor holds SELECT on vendor_bid_items (they must
--   -- it is the ask they price against) and RLS FILTERS ROWS, NEVER COLUMNS,
--   so a budget column on that table is readable by every bidder at the REST
--   API however carefully the app avoids rendering it. Our budget is the
--   ceiling we will pay; handing it to the people quoting against it destroys
--   the negotiation. The budget therefore lives in its own table with NO vendor
--   policy at all. Same reasoning as wp_view_public and vendor_self_view.
--
-- vendor_bid_item_prices and vendor_bid_requirement_results are STAFF-ONLY
--   for the same class of reason: a row in either is one bidder's position, and
--   the table holds every bidder's. A vendor must never read them.
--
-- vendor_bid_requirements IS vendor-readable -- it is part of the ask, like
--   the documents and the priced items, and a bidder cannot meet a requirement
--   nobody told them about. Scoped through their OWN invitation, never by
--   round_id alone.
-- ============================================================================

-- -- 1. the technical requirements (the ask) ---------------------------------
create table if not exists public.vendor_bid_requirements (
  id          uuid primary key default gen_random_uuid(),
  round_id    uuid not null references public.vendor_bid_rounds(id) on delete cascade,
  requirement text not null,
  detail      text,
  -- A mandatory line that is not met disqualifies the bid however cheap it is.
  -- A non-mandatory one is a preference: it is reported, not enforced.
  mandatory   boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz default now()
);
create index if not exists idx_bid_reqs_round on public.vendor_bid_requirements(round_id);

-- -- 2. per bidder, per requirement -------------------------------------------
create table if not exists public.vendor_bid_requirement_results (
  id             uuid primary key default gen_random_uuid(),
  invitation_id  uuid not null references public.vendor_bid_invitations(id) on delete cascade,
  requirement_id uuid not null references public.vendor_bid_requirements(id) on delete cascade,
  result         text check (result in ('met','partial','not_met','na')),
  note           text,
  updated_at     timestamptz default now(),
  updated_by     uuid,
  updated_by_name text,
  unique (invitation_id, requirement_id)
);
create index if not exists idx_bid_reqres_inv on public.vendor_bid_requirement_results(invitation_id);

-- -- 3. per bidder, per priced item -- the cost comparison itself -------------
create table if not exists public.vendor_bid_item_prices (
  id            uuid primary key default gen_random_uuid(),
  invitation_id uuid not null references public.vendor_bid_invitations(id) on delete cascade,
  item_id       uuid not null references public.vendor_bid_items(id) on delete cascade,
  -- The bidder's OWN quantity and unit. They frequently differ from the ask --
  -- one quotes 348 LM where another quotes 306 -- and that difference is a
  -- finding, not an error to normalise away.
  quantity      numeric(18,3),
  unit          text,
  unit_rate     numeric(18,4),
  -- Stored, not derived: the workbooks carry lump-sum lines and lines whose
  -- total is given directly, so qty x rate is not always the figure quoted.
  amount        numeric(18,2),
  -- 'included' is a real answer in these sheets (the cost sits inside another
  -- line) and must not be read as zero or as missing.
  status        text check (status in ('quoted','included','excluded','no_bid')) default 'quoted',
  note          text,
  updated_at    timestamptz default now(),
  updated_by    uuid,
  updated_by_name text,
  unique (invitation_id, item_id)
);
create index if not exists idx_bid_prices_inv  on public.vendor_bid_item_prices(invitation_id);
create index if not exists idx_bid_prices_item on public.vendor_bid_item_prices(item_id);

-- -- 4. the budgeted rate per item -- STAFF ONLY (see the header) -------------
create table if not exists public.vendor_bid_item_budget (
  item_id       uuid primary key references public.vendor_bid_items(id) on delete cascade,
  round_id      uuid not null references public.vendor_bid_rounds(id) on delete cascade,
  budget_rate   numeric(18,4),
  budget_amount numeric(18,2),
  updated_at    timestamptz default now()
);
create index if not exists idx_bid_itembudget_round on public.vendor_bid_item_budget(round_id);

-- -- 5. RLS -------------------------------------------------------------------
alter table public.vendor_bid_requirements        enable row level security;
alter table public.vendor_bid_requirement_results enable row level security;
alter table public.vendor_bid_item_prices         enable row level security;
alter table public.vendor_bid_item_budget         enable row level security;

-- Staff: the same write audience as the rest of Bid Management.
drop policy if exists bid_reqs_staff on public.vendor_bid_requirements;
create policy bid_reqs_staff on public.vendor_bid_requirements
  for all to authenticated
  using (internal.get_my_role() in ('super_admin','admin','specialist','manager','user'))
  with check (internal.get_my_role() in ('super_admin','admin','specialist','manager','user'));

drop policy if exists bid_reqres_staff on public.vendor_bid_requirement_results;
create policy bid_reqres_staff on public.vendor_bid_requirement_results
  for all to authenticated
  using (internal.get_my_role() in ('super_admin','admin','specialist','manager','user'))
  with check (internal.get_my_role() in ('super_admin','admin','specialist','manager','user'));

drop policy if exists bid_prices_staff on public.vendor_bid_item_prices;
create policy bid_prices_staff on public.vendor_bid_item_prices
  for all to authenticated
  using (internal.get_my_role() in ('super_admin','admin','specialist','manager','user'))
  with check (internal.get_my_role() in ('super_admin','admin','specialist','manager','user'));

drop policy if exists bid_itembudget_staff on public.vendor_bid_item_budget;
create policy bid_itembudget_staff on public.vendor_bid_item_budget
  for all to authenticated
  using (internal.get_my_role() in ('super_admin','admin','specialist','manager','user'))
  with check (internal.get_my_role() in ('super_admin','admin','specialist','manager','user'));

-- THE REQUIREMENTS ARE THE ONLY ONE A VENDOR MAY READ, and only through their
-- OWN invitation. There is deliberately no vendor policy on the three other
-- tables -- they hold every bidder's position, including our budget.
drop policy if exists bid_reqs_vendor on public.vendor_bid_requirements;
create policy bid_reqs_vendor on public.vendor_bid_requirements
  for select to authenticated
  using (exists (select 1 from public.vendor_bid_invitations i
                  where i.round_id = vendor_bid_requirements.round_id
                    and i.vendor_id = internal.get_my_vendor_id()));

-- -- 6. the anonymous bidder gets the requirements too ------------------------
-- Most bidders answer from the token link with NO LOGIN, so the policy above
-- reaches none of them. bid_reference_by_token is extended rather than
-- replaced, and ITS FIELD LIST IS THE ACCESS CONTROL -- it names the columns it
-- returns, so nothing from the three staff-only tables can leak through it.
create or replace function public.bid_reference_by_token(p_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, internal
as $fn$
declare
  v_round uuid;
  v_docs  jsonb;
  v_items jsonb;
  v_reqs  jsonb;
begin
  select i.round_id into v_round
    from vendor_bid_invitations i
   where i.access_token = p_token;

  -- The same empty answer for an unknown token as for a valid one with nothing
  -- attached. Never confirm that a token exists.
  if v_round is null then
    return jsonb_build_object('documents', '[]'::jsonb, 'items', '[]'::jsonb,
                              'requirements', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'kind', d.kind, 'title', d.title,
           'file_path', d.file_path, 'file_name', d.file_name,
           'note', d.note) order by d.sort_order, d.created_at), '[]'::jsonb)
    into v_docs
    from vendor_bid_documents d
   where d.round_id = v_round;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', it.id, 'item_no', it.item_no, 'description', it.description,
           'spec', it.spec, 'unit', it.unit, 'quantity', it.quantity,
           'remarks', it.remarks) order by it.sort_order, it.created_at), '[]'::jsonb)
    into v_items
    from vendor_bid_items it
   where it.round_id = v_round;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', rq.id, 'requirement', rq.requirement, 'detail', rq.detail,
           'mandatory', rq.mandatory) order by rq.sort_order, rq.created_at), '[]'::jsonb)
    into v_reqs
    from vendor_bid_requirements rq
   where rq.round_id = v_round;

  return jsonb_build_object('documents', v_docs, 'items', v_items,
                            'requirements', v_reqs);
end;
$fn$;

revoke all on function public.bid_reference_by_token(uuid) from public;
grant execute on function public.bid_reference_by_token(uuid) to anon, authenticated;

-- -- 7. verification -- every column must read true ---------------------------
select
  to_regclass('public.vendor_bid_requirements')        is not null as requirements_table,
  to_regclass('public.vendor_bid_requirement_results') is not null as results_table,
  to_regclass('public.vendor_bid_item_prices')         is not null as prices_table,
  to_regclass('public.vendor_bid_item_budget')         is not null as item_budget_table,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'vendor_bid_item_budget') = 1
      as budget_staff_only,
  not exists (select 1 from pg_policies
               where schemaname = 'public'
                 and tablename in ('vendor_bid_item_prices','vendor_bid_item_budget',
                                   'vendor_bid_requirement_results')
                 and coalesce(qual, '') like '%get_my_vendor_id%')
      as no_vendor_path_to_staff_tables,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'vendor_bid_requirements') = 2
      as requirements_readable_by_bidder,
  position('requirements' in pg_get_functiondef(
     'public.bid_reference_by_token(uuid)'::regprocedure)) > 0
      as token_rpc_returns_requirements,
  position('budget_rate' in pg_get_functiondef(
     'public.bid_reference_by_token(uuid)'::regprocedure)) = 0
      as token_rpc_withholds_budget;
