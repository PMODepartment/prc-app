-- ═══════════════════════════════════════════════════════════════════════════
-- Alias every free-text vendor name that the WORK PACKAGE ITSELF already
-- resolves — no name matching, no judgement.
--
-- Run in the Supabase SQL Editor, AFTER migrations/2026-09-07_vendor_aliases.sql.
-- Idempotent: re-running inserts nothing and reports 0.
--
-- ⚠️ CARRIES NO VENDOR DATA. Everything is derived server-side, which is why
--    this one is safe to keep in the repo (unlike the workbook-derived seeds).
--
-- WHY THIS IS SAFE WHERE FUZZY MATCHING WOULD NOT BE
-- ──────────────────────────────────────────────────
-- The unlinked-names worklist is a judgement call in general: "LG Philippines"
-- only becomes "LG Electronics Philippines.Inc." because a person says so.
--
-- But a subset needs no person. Where a work package carries BOTH a free-text
-- `contractor` AND a real `vendor_id` / `awarded_vendor_ids` link, somebody has
-- already asserted, on that row, that this text IS that company. The alias only
-- records the spelling so every OTHER work package carrying the same text
-- resolves too. That is identifier-grade evidence, not a similarity score.
--
-- ⚠️ EVERY ONE OF THE FOLLOWING GUARDS IS LOAD-BEARING. This writes what the
--    vendor analytics uses to attribute awarded money, so a wrong row here
--    credits one company's spend to another.
--   1. ONE linked vendor per work package. A co-award (`awarded_vendor_ids`
--      with 2+ entries) says nothing about which name maps to which vendor.
--   2. ONE name per work package — the text must contain no newline, ';', '|'
--      or '/', the app's own awarded-vendor delimiters. "A / B" is two
--      companies and belongs in the Split tool.
--   3. THE SAME TEXT MUST RESOLVE TO THE SAME VENDOR EVERYWHERE. If "Acme" is
--      linked to vendor X on one work package and Y on another, that is a real
--      contradiction; it is reported and skipped, never guessed.
--   4. NOT ALREADY RESOLVABLE. A name equal to a vendor's own name (exactly, or
--      ignoring punctuation) needs no alias.
--   5. NEVER SHADOW ANOTHER COMPANY'S REGISTERED NAME. `vendor_alias_guard`
--      refuses that anyway — but a raise would abort the whole insert, so these
--      are filtered out here and reported instead.
--   6. NOT A PLACEHOLDER. "n/a", "various supplier" and friends are not
--      companies, whatever a stray link says.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 0. what this will do, before it does it ────────────────────────────────
--    (Section 1 applies it. Both are self-contained; run either alone.)
with wp as (
  select
    w.id,
    btrim(regexp_replace(w.contractor, '\s+', ' ', 'g'))                   as txt,
    case
      when coalesce(array_length(w.awarded_vendor_ids, 1), 0) = 1 then w.awarded_vendor_ids[1]
      when coalesce(array_length(w.awarded_vendor_ids, 1), 0) = 0 then w.vendor_id
      else null                                    -- guard 1: co-award, skip
    end                                                                    as vid
  from public.work_packages w
  where coalesce(btrim(w.contractor), '') <> ''
    -- guard 2: a single name only
    and w.contractor !~ '[\r\n;|/]'
),
linked as (
  select wp.txt, wp.vid, lower(wp.txt) as nkey
    from wp
    join public.vendors v on v.id = wp.vid          -- the link must still exist
   where wp.vid is not null
),
grouped as (
  select nkey, min(txt) as txt, count(distinct vid) as vids, min(vid::text) as vid,
         count(*) as wps
    from linked group by nkey
),
vnames as (
  select lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))                        as nname,
         regexp_replace(lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))),
                        '[^a-z0-9]', '', 'g')                                       as sname,
         id
    from public.vendors
),
judged as (
  select g.*,
    -- guard 3
    (g.vids > 1)                                                            as ambiguous,
    -- guard 4
    exists (select 1 from vnames n where n.nname = g.nkey
             or n.sname = regexp_replace(g.nkey, '[^a-z0-9]', '', 'g'))      as already_ok,
    -- guard 5
    exists (select 1 from vnames n where n.nname = g.nkey and n.id::text <> g.vid)
                                                                            as shadows,
    -- guard 6
    (regexp_replace(lower(g.txt), '^[([{<]+|[)\]}>]+$', '', 'g') ~
      '^(various( (supplier|suppliers|vendors?|contractors?))?|tbd|to ?be ?(advised|determined|sourced|confirmed|identified|nominated)|for ?sourcing|not ?yet ?sourced|n/?a|none|unknown|assorted|open|pending)$')
                                                                            as placeholder,
    exists (select 1 from public.vendor_aliases a where a.alias_norm = g.nkey) as have_alias
  from grouped g
)
select
  case
    when have_alias   then '0 already aliased'
    when ambiguous    then '⚠ SKIPPED — the same text is linked to 2+ different vendors'
    when placeholder  then 'skipped — not a company name'
    when shadows      then '⚠ SKIPPED — that spelling is another vendor''s registered name'
    when already_ok   then 'skipped — already resolves without an alias'
    else '✔ WILL BE ALIASED'
  end                                                     as outcome,
  count(*)                                                as names,
  sum(wps)                                                as work_packages
from judged
group by 1
order by 1;


-- ── 1. apply ───────────────────────────────────────────────────────────────
with wp as (
  select
    w.id,
    btrim(regexp_replace(w.contractor, '\s+', ' ', 'g'))                   as txt,
    case
      when coalesce(array_length(w.awarded_vendor_ids, 1), 0) = 1 then w.awarded_vendor_ids[1]
      when coalesce(array_length(w.awarded_vendor_ids, 1), 0) = 0 then w.vendor_id
      else null
    end                                                                    as vid
  from public.work_packages w
  where coalesce(btrim(w.contractor), '') <> ''
    and w.contractor !~ '[\r\n;|/]'
),
linked as (
  select wp.txt, wp.vid, lower(wp.txt) as nkey
    from wp join public.vendors v on v.id = wp.vid
   where wp.vid is not null
),
grouped as (
  select nkey, min(txt) as txt, count(distinct vid) as vids, min(vid) as vid, count(*) as wps
    from linked group by nkey
),
vnames as (
  select lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))                        as nname,
         regexp_replace(lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))),
                        '[^a-z0-9]', '', 'g')                                       as sname,
         id
    from public.vendors
),
keep as (
  select g.txt, g.vid, g.wps
    from grouped g
   where g.vids = 1
     and not exists (select 1 from vnames n where n.nname = g.nkey
                      or n.sname = regexp_replace(g.nkey, '[^a-z0-9]', '', 'g'))
     and not exists (select 1 from vnames n where n.nname = g.nkey and n.id <> g.vid)
     and not exists (select 1 from public.vendor_aliases a where a.alias_norm = g.nkey)
     and regexp_replace(lower(g.txt), '^[([{<]+|[)\]}>]+$', '', 'g') !~
         '^(various( (supplier|suppliers|vendors?|contractors?))?|tbd|to ?be ?(advised|determined|sourced|confirmed|identified|nominated)|for ?sourcing|not ?yet ?sourced|n/?a|none|unknown|assorted|open|pending)$'
)
insert into public.vendor_aliases (alias_text, alias_norm, alias_squash, vendor_id, note)
select k.txt, k.txt, k.txt, k.vid,
       'Recorded from the work packages that already linked this spelling to this vendor ('
       || k.wps || ' work package' || case when k.wps = 1 then '' else 's' end || ')'
  from keep k
-- belt and braces: the unique index would reject a duplicate spelling anyway
on conflict (alias_norm) do nothing;


-- ── 2. what landed ─────────────────────────────────────────────────────────
select
  (select count(*) from public.vendor_aliases)                             as aliases_total,
  (select count(*) from public.vendor_aliases
    where note like 'Recorded from the work packages%')                     as from_wp_links,
  (select count(*) from public.vendor_aliases
    where note not like 'Recorded from the work packages%')                 as set_by_hand;
