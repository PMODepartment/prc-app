-- ═══════════════════════════════════════════════════════════════════════════
-- REMOVE access_token FROM vendor_bid_board_view.
-- Run once, in the Supabase SQL Editor, AFTER 2026-09-05_bid_reference_docs.sql.
--
-- WHY
-- ---
-- 2026-09-05_bid_reference_docs.sql ends with a verification SELECT whose
-- token_still_withheld column came back FALSE. It was right:
-- migrations/2026-09-04_bid_process.sql line ~705 selects `i.access_token` into
-- the vendor board view, and has done since it was run.
--
-- ⚠️ THIS IS NOT A CROSS-VENDOR LEAK. The view is filtered to
--    i.vendor_id = internal.get_my_vendor_id(), so a vendor only ever saw
--    their OWN invitation tokens — the same ones already emailed to them.
--    Nothing to revoke, nothing exposed to a third party.
--
-- ⚠️ BUT A TOKEN IS A BEARER CAPABILITY THAT NEEDS NO LOGIN, AND IT OUTLIVES
--    THE SESSION. Once it is in the portal's JavaScript it can be scraped by
--    anything running on that page, it lands in memory and in screenshots, and
--    — the part that matters — it KEEPS WORKING AFTER A PASSWORD CHANGE.
--    Disabling a vendor's portal login does nothing to a token they, or anyone
--    they forwarded the email to, still hold. A page that already has a session
--    has no need of it, so it should not be handed one.
--
-- Nothing reads it from this view: bids.html builds the RFQ link from the BASE
-- TABLE as staff, and vendor-portal.html deliberately reads the reference pack
-- by round_id through RLS. Verified across the whole client before writing this.
-- ═══════════════════════════════════════════════════════════════════════════

do $mig$
declare
  src        text;
  cols_before int;
  cols_after  int;
begin
  select pg_get_viewdef('public.vendor_bid_board_view'::regclass, true) into src;
  if src is null then
    raise exception 'vendor_bid_board_view not found';
  end if;

  if position('access_token' in src) = 0 then
    raise notice 'access_token is already absent — nothing to do';
    return;
  end if;

  select count(*) into cols_before from information_schema.columns
   where table_schema = 'public' and table_name = 'vendor_bid_board_view';

  -- ⚠️ Strip ONE line, not every mention. Matching the bare word would also hit
  --    a comment or another identifier; the select-list entry is what we want.
  src := replace(src, '    i.access_token,' || chr(10), '');
  src := replace(src, '   i.access_token,'  || chr(10), '');
  src := replace(src, '  i.access_token,'   || chr(10), '');
  if position('access_token' in src) > 0 then
    raise exception 'could not remove access_token cleanly — the select list is '
      'not in the expected shape; edit the view by hand';
  end if;

  -- ⚠️ DROP + CREATE, not CREATE OR REPLACE. Postgres will not let a replace
  --    REMOVE a column; it can only append. And no CASCADE: if something has
  --    come to depend on this view since, the failure should be loud rather
  --    than take that dependency down with it.
  drop view public.vendor_bid_board_view;

  -- ⚠️ security_barrier has to be restated. pg_get_viewdef returns only the
  --    SELECT — the reloptions are not part of it, and losing the barrier would
  --    let the planner push a leaky outer predicate ahead of the vendor scope.
  execute 'create view public.vendor_bid_board_view with (security_barrier = true) as ' || src;

  select count(*) into cols_after from information_schema.columns
   where table_schema = 'public' and table_name = 'vendor_bid_board_view';

  if cols_after <> cols_before - 1 then
    raise exception 'expected exactly one column to go (% -> %), aborting',
      cols_before, cols_after;
  end if;

  raise notice 'access_token removed; % columns remain', cols_after;
end;
$mig$;

grant select on public.vendor_bid_board_view to authenticated;

comment on view public.vendor_bid_board_view is
  'A vendor login''s read surface on the packages it was invited to quote. '
  'INTENTIONAL SECURITY DEFINER (accepted exception, as wp_view_public and '
  'vendor_self_view): RLS filters rows, never columns. OMITS every cost column '
  'of ours, every column naming another bidder, and access_token — a bearer '
  'capability that needs no login and survives a password change, so a page '
  'holding a session must never be handed one.';

-- ── verification — every column must read true ────────────────────────────
select
  position('access_token' in pg_get_viewdef('public.vendor_bid_board_view'::regclass, true)) = 0
                                                                          as token_withheld,
  -- the reference pack still works: it reads by round_id
  position('round_id' in pg_get_viewdef('public.vendor_bid_board_view'::regclass, true)) > 0
                                                                          as round_id_kept,
  -- and nothing else was lost on the way through
  position('project_status' in pg_get_viewdef('public.vendor_bid_board_view'::regclass, true)) > 0
                                                                          as project_status_kept,
  position('attachment_path' in pg_get_viewdef('public.vendor_bid_board_view'::regclass, true)) > 0
                                                                          as attachment_kept,
  (select count(*) > 0 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'vendor_bid_board_view'
      and c.reloptions::text like '%security_barrier=true%')              as barrier_kept;
