-- ═══════════════════════════════════════════════════════════════════════════
-- vendor_bid_board_view NEVER GOT round_id. Adding it properly, and fixing the
-- verification that said it had.
-- Run once, in the Supabase SQL Editor, AFTER 2026-09-05_board_view_drop_token.sql.
--
-- ⚠️ ONE MISTAKE IN 2026-09-05_bid_reference_docs.sql, MADE TWICE, AND IT WAS
--    SILENT BOTH TIMES: it asked whether the view had round_id by
--    STRING-MATCHING THE VIEW DEFINITION.
--
--       position('round_id' in src) > 0
--
--    `round_id` appears in that text regardless — in the join:
--       left join public.vendor_bid_rounds r on r.id = i.round_id
--
--    So on the very first run the early-exit guard matched, said "already
--    exposes round_id — nothing to do", and returned. The column was never
--    added. The verification at the end of the file then made the SAME test and
--    agreed. Nothing errored; the report said true; the column did not exist.
--    Its companion check on access_token was right only by luck — that string
--    happens to appear nowhere else in the definition.
--
--    ⇒ NEVER verify a view's columns by string-matching its SQL. Ask
--       information_schema.columns, which is what this file does.
--
-- ⚠️ AND THE WRITE ITSELF WOULD HAVE FAILED TOO, had the guard let it through:
--    it used `create or replace view` to insert a column in the MIDDLE of the
--    select list. A replace may only APPEND — it cannot change the name, type
--    or POSITION of an existing column (42P16). Removing or repositioning one
--    needs DROP + CREATE, which is what this file uses.
--
-- Confirmed live before writing this: the deployed view has 52 columns,
-- access_token correctly absent, round_id absent, everything else intact.
-- Nothing broke — but vendor-portal.html reads the reference pack by round_id,
-- so a vendor could never see the TOR / MPSS pack until this runs.
-- ═══════════════════════════════════════════════════════════════════════════

do $mig$
declare
  src         text;
  cols_before int;
  cols_after  int;
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'vendor_bid_board_view'
                and column_name = 'round_id') then
    raise notice 'round_id is already a column — nothing to do';
    return;
  end if;

  select pg_get_viewdef('public.vendor_bid_board_view'::regclass, true) into src;
  if src is null then
    raise exception 'vendor_bid_board_view not found';
  end if;

  select count(*) into cols_before from information_schema.columns
   where table_schema = 'public' and table_name = 'vendor_bid_board_view';

  -- Insert it beside the other invitation columns. Whatever indentation the
  -- pretty-printer used, exactly one of these matches.
  if position('    i.invited_at,' || chr(10) in src) > 0 then
    src := replace(src, '    i.invited_at,' || chr(10),
                        '    i.invited_at,' || chr(10) || '    i.round_id,' || chr(10));
  elsif position('   i.invited_at,' || chr(10) in src) > 0 then
    src := replace(src, '   i.invited_at,' || chr(10),
                        '   i.invited_at,' || chr(10) || '   i.round_id,' || chr(10));
  elsif position('  i.invited_at,' || chr(10) in src) > 0 then
    src := replace(src, '  i.invited_at,' || chr(10),
                        '  i.invited_at,' || chr(10) || '  i.round_id,' || chr(10));
  else
    raise exception 'could not find the i.invited_at line — add i.round_id by hand';
  end if;

  -- ⚠️ DROP + CREATE. See note 1 above: a replace cannot place a column here.
  --    No CASCADE — a dependency that has appeared since should fail loudly.
  drop view public.vendor_bid_board_view;

  -- ⚠️ security_barrier must be restated: pg_get_viewdef returns only the
  --    SELECT, and losing the barrier would let the planner push a leaky outer
  --    predicate ahead of the vendor scope.
  execute 'create view public.vendor_bid_board_view with (security_barrier = true) as ' || src;

  select count(*) into cols_after from information_schema.columns
   where table_schema = 'public' and table_name = 'vendor_bid_board_view';

  if cols_after <> cols_before + 1 then
    raise exception 'expected exactly one column to be added (% -> %), aborting',
      cols_before, cols_after;
  end if;

  raise notice 'round_id added; % columns', cols_after;
end;
$mig$;

grant select on public.vendor_bid_board_view to authenticated;

-- ── verification — against the COLUMN LIST, not the definition text ───────
select
  (select count(*) = 1 from information_schema.columns
    where table_schema='public' and table_name='vendor_bid_board_view'
      and column_name='round_id')                                        as round_id_is_a_column,
  (select count(*) = 0 from information_schema.columns
    where table_schema='public' and table_name='vendor_bid_board_view'
      and column_name='access_token')                                    as token_is_not_a_column,
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='vendor_bid_board_view')  as total_columns,
  -- nothing lost on the way through
  (select count(*) = 4 from information_schema.columns
    where table_schema='public' and table_name='vendor_bid_board_view'
      and column_name in ('attachment_path','project_status','outcome','wp_no'))
                                                                          as key_columns_kept,
  (select count(*) > 0 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname='public' and c.relname='vendor_bid_board_view'
      and c.reloptions::text like '%security_barrier=true%')             as barrier_kept;
