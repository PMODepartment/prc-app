-- ═══════════════════════════════════════════════════════════════════════════
-- TERMS OF REFERENCE / DESIGN CRITERIA ON THE ROUND.
-- Run once, in the Supabase SQL Editor, AFTER 2026-09-04_bid_negotiated_quotation.sql.
--
-- WHY
-- ---
-- A bidder was given a paragraph of scope text and asked for a price. For a
-- materials enquiry that is enough; for anything with a specification it is
-- not. The pumps case: diameter, material, length, capacity, quantity — none of
-- it fits in a scope note, and without it every bidder prices something
-- slightly different and the comparison is meaningless.
--
-- Two things, and they are NOT the same:
--   1. DOCUMENTS — the terms of reference (TOR), the MPSS, drawings, the BOQ.
--      Files, issued with the RFQ, the same set to every bidder.
--   2. LINE ITEMS — the MPSS: per item, the specification and quantity a bidder
--      prices against. Structured, because it is what makes two quotations
--      comparable line by line.
--
-- ⚠️ THE APP DOES NOT BUILD THE COST COMPARISON. That stays outside, in the
--    per-package template (see the note in bids.html). This is the ASK — what
--    Megawide sends out — not the analysis of what comes back.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. reference documents issued with the round ──────────────────────────
create table if not exists public.vendor_bid_documents (
  id          uuid primary key default gen_random_uuid(),
  round_id    uuid not null references public.vendor_bid_rounds(id) on delete cascade,
  kind        text not null default 'reference'
              check (kind in ('reference','tor','mpss','drawing','boq','other')),
  title       text not null,
  file_path   text,
  file_name   text,
  note        text,
  sort_order  integer not null default 0,
  created_at  timestamptz default now(),
  created_by  uuid,
  created_by_name text
);
create index if not exists idx_bid_docs_round on public.vendor_bid_documents(round_id);

-- ── 2. the priced line items (MPSS) ───────────────────────────────────────
-- One row per thing the bidder prices. Quantity and unit are what make two
-- quotations comparable; spec is the free text that says which 150 mm pump.
create table if not exists public.vendor_bid_items (
  id          uuid primary key default gen_random_uuid(),
  round_id    uuid not null references public.vendor_bid_rounds(id) on delete cascade,
  item_no     text,
  description text not null,
  spec        text,
  unit        text,
  quantity    numeric(18,3),
  remarks     text,
  sort_order  integer not null default 0,
  created_at  timestamptz default now()
);
create index if not exists idx_bid_items_round on public.vendor_bid_items(round_id);

-- ── 3. RLS ────────────────────────────────────────────────────────────────
alter table public.vendor_bid_documents enable row level security;
alter table public.vendor_bid_items     enable row level security;

-- Staff: the same write audience as the rest of Bid Management.
drop policy if exists bid_docs_staff  on public.vendor_bid_documents;
create policy bid_docs_staff on public.vendor_bid_documents
  for all to authenticated
  using (internal.get_my_role() in ('super_admin','admin','specialist','manager','user'))
  with check (internal.get_my_role() in ('super_admin','admin','specialist','manager','user'));

drop policy if exists bid_items_staff on public.vendor_bid_items;
create policy bid_items_staff on public.vendor_bid_items
  for all to authenticated
  using (internal.get_my_role() in ('super_admin','admin','specialist','manager','user'))
  with check (internal.get_my_role() in ('super_admin','admin','specialist','manager','user'));

-- ⚠️ A LOGGED-IN VENDOR READS THESE THROUGH ITS OWN INVITATION, NOT BY ROUND.
--    Selecting on round_id alone would let any vendor read the ask for a round
--    they were never invited to. The clause below requires an invitation of
--    THEIRS on that round.
drop policy if exists bid_docs_vendor on public.vendor_bid_documents;
create policy bid_docs_vendor on public.vendor_bid_documents
  for select to authenticated
  using (exists (select 1 from public.vendor_bid_invitations i
                  where i.round_id = vendor_bid_documents.round_id
                    and i.vendor_id = internal.get_my_vendor_id()));

drop policy if exists bid_items_vendor on public.vendor_bid_items;
create policy bid_items_vendor on public.vendor_bid_items
  for select to authenticated
  using (exists (select 1 from public.vendor_bid_invitations i
                  where i.round_id = vendor_bid_items.round_id
                    and i.vendor_id = internal.get_my_vendor_id()));

-- ── 4. the anonymous bidder gets them too ─────────────────────────────────
-- ⚠️ MOST BIDDERS ANSWER FROM THE TOKEN LINK WITH NO LOGIN AT ALL, so the RLS
--    above reaches none of them. Without this the reference documents would be
--    invisible to exactly the people who need to price against them.
--    Definer, scoped to ONE open invitation, and it returns nothing but the ask.
create or replace function public.bid_reference_by_token(p_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, internal
as $fn$
declare
  inv public.vendor_bid_invitations%rowtype;
  res jsonb;
begin
  select * into inv from public.vendor_bid_invitations where access_token = p_token;
  if inv.id is null then
    -- Same answer as an expired token: never confirm a token exists.
    return jsonb_build_object('documents', '[]'::jsonb, 'items', '[]'::jsonb);
  end if;
  select jsonb_build_object(
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', d.id, 'kind', d.kind, 'title', d.title,
               'file_name', d.file_name, 'file_path', d.file_path, 'note', d.note)
             order by d.sort_order, d.created_at)
        from public.vendor_bid_documents d where d.round_id = inv.round_id), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', it.id, 'item_no', it.item_no, 'description', it.description,
               'spec', it.spec, 'unit', it.unit, 'quantity', it.quantity, 'remarks', it.remarks)
             order by it.sort_order, it.created_at)
        from public.vendor_bid_items it where it.round_id = inv.round_id), '[]'::jsonb)
  ) into res;
  return res;
end;
$fn$;

revoke all on function public.bid_reference_by_token(uuid) from public;
grant execute on function public.bid_reference_by_token(uuid) to anon, authenticated;

-- ── 5. Storage: the reference pack lives in the bid bucket ────────────────
-- ⚠️ Anonymous bidders must be able to READ these, which the private
--    bid-submissions bucket does not allow. A separate PUBLIC-read bucket, and
--    that is a deliberate decision: a terms of reference is what we are handing
--    to every bidder anyway, and the alternative is minting a signed URL per
--    file per anonymous page load. NOTHING VENDOR-SUBMITTED GOES IN HERE — that
--    stays in bid-submissions, which is private and stays private.
insert into storage.buckets (id, name, public)
values ('bid-reference', 'bid-reference', true)
on conflict (id) do nothing;

drop policy if exists bid_ref_read  on storage.objects;
create policy bid_ref_read on storage.objects
  for select using (bucket_id = 'bid-reference');

drop policy if exists bid_ref_write on storage.objects;
create policy bid_ref_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'bid-reference'
              and internal.get_my_role() in ('super_admin','admin','specialist','manager','user'));

drop policy if exists bid_ref_delete on storage.objects;
create policy bid_ref_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'bid-reference'
         and internal.get_my_role() in ('super_admin','admin','specialist','manager','user'));

-- ── 6. verification ───────────────────────────────────────────────────────
select
  exists (select 1 from information_schema.tables
           where table_schema='public' and table_name='vendor_bid_documents')  as docs_table,
  exists (select 1 from information_schema.tables
           where table_schema='public' and table_name='vendor_bid_items')      as items_table,
  -- a vendor policy must scope through its OWN invitation, never round_id alone
  (select count(*) from pg_policies
    where schemaname='public' and tablename='vendor_bid_documents'
      and policyname='bid_docs_vendor' and qual like '%get_my_vendor_id%') = 1  as docs_vendor_scoped,
  (select count(*) from pg_policies
    where schemaname='public' and tablename='vendor_bid_items'
      and policyname='bid_items_vendor' and qual like '%get_my_vendor_id%') = 1 as items_vendor_scoped,
  exists (select 1 from storage.buckets where id='bid-reference' and public)    as reference_bucket_public,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='bid_reference_by_token') = 1        as token_reader;

-- ── 7. the logged-in vendor needs the round id to read the pack ───────────
-- ⚠️ NOT the access_token. That is a bearer capability for the anonymous link
--    and must not be handed to a page that already has a session — it would
--    turn a portal login into a forwardable token. round_id is inert on its
--    own: the RLS policies in section 3 still require an invitation of THEIRS
--    on that round, so knowing the id grants nothing by itself.
do $mig$
declare src text;
begin
  select pg_get_viewdef('public.vendor_bid_board_view'::regclass, true) into src;
  if src is null then
    raise exception 'vendor_bid_board_view not found — run 2026-09-03_vendor_bid_board.sql first';
  end if;
  if position('round_id' in src) > 0 then
    raise notice 'vendor_bid_board_view already exposes round_id — nothing to do';
    return;
  end if;
  if position('i.invited_at' in src) = 0 then
    raise exception 'vendor_bid_board_view has been edited — add i.round_id by hand';
  end if;
  src := replace(src, 'i.invited_at,', 'i.invited_at,' || chr(10) || '    i.round_id,');
  execute 'create or replace view public.vendor_bid_board_view as ' || src;
  raise notice 'vendor_bid_board_view now exposes round_id';
end;
$mig$;

grant select on public.vendor_bid_board_view to authenticated;

select
  (select position('round_id' in pg_get_viewdef('public.vendor_bid_board_view'::regclass, true)) > 0)
                                                                              as board_view_has_round_id,
  (select position('access_token' in pg_get_viewdef('public.vendor_bid_board_view'::regclass, true)) = 0)
                                                                              as token_still_withheld;
