-- ═══════════════════════════════════════════════════════════════════════════
-- CLASS CODES — the cost breakdown Finance and the Planning app already use.
-- Run once, in the Supabase SQL Editor. SCHEMA ONLY: the 949 rows come from
-- SEED_class_codes.sql, which is generated locally and git-ignored (see below).
--
-- WHY
-- ---
-- Reference rates were free text: an item description, a trade, a unit. Two
-- rates for the same thing under two different wordings could not be compared,
-- and nothing tied a rate to how Finance or Planning classify the same cost.
--
-- Source: "EPC. FIN. Class Code Mapping Template" — a real 3-level hierarchy,
-- 42 Level 1 categories → 205 Level 2 groups → 702 Level 3 items, e.g.
--   01     General Requirement
--   01050    Mobilization / Demobilization
--   010523     Rental of 10-Wheeler Truck w/ Boom
--
-- ⚠️ THE SEED IS NOT COMMITTED, and neither is the workbook. GitHub Pages
--    serves this whole repo publicly, so a data-bearing .sql in it is published
--    at pmodepartment.github.io/prc-app/… bypassing auth and RLS entirely —
--    the same reasoning as SEED_vendor_masterlist.sql. This is Megawide's
--    internal cost structure; regenerate it locally with gen_class_codes.py.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. the tree ───────────────────────────────────────────────────────────
-- ⚠️ ONE ROW PER NODE AT EVERY LEVEL, not one row per leaf. A leaf-only table
--    cannot answer "everything under 01050" without string-prefix matching,
--    which breaks the moment a code length changes.
create table if not exists public.class_codes (
  code        text primary key,
  level       smallint not null check (level between 1 and 3),
  parent_code text references public.class_codes(code) on delete cascade,
  name        text not null,
  -- Denormalised ancestors so a rollup is one indexed read, never a recursive
  -- CTE per row. l1_code is set on every level including 1 (itself).
  l1_code     text not null,
  l2_code     text,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz default now()
);
create index if not exists idx_class_codes_parent on public.class_codes(parent_code);
create index if not exists idx_class_codes_l1     on public.class_codes(l1_code);
create index if not exists idx_class_codes_level  on public.class_codes(level) where active;

comment on table public.class_codes is
  'Finance/Planning cost breakdown, 3 levels. Seeded from the Class Code Mapping '
  'Template; the seed is generated locally and never committed.';

-- ── 2. RLS: everyone signed in reads it, nobody writes it from a browser ──
-- ⚠️ NO write policy for authenticated. This is Finance's master data. A code
--    invented in a browser would silently diverge from the Planning app, which
--    is the whole thing this table exists to prevent. It is maintained by
--    re-running the seed.
alter table public.class_codes enable row level security;
drop policy if exists class_codes_select on public.class_codes;
create policy class_codes_select on public.class_codes
  for select to authenticated using (true);

-- ── 3. rates get a class code ─────────────────────────────────────────────
alter table public.vendor_rates
  add column if not exists class_code text references public.class_codes(code) on delete set null;
create index if not exists idx_vendor_rates_class on public.vendor_rates(class_code);

comment on column public.vendor_rates.class_code is
  'Level 3 class code this rate belongs to. Derived from work_packages.cost_code '
  'when the rate comes from an awarded WP; null when the WP carries no cost code.';

-- ⚠️ on delete SET NULL, never cascade. Retiring a class code must not delete
--    the rate history filed under it — the rate is what a vendor was actually
--    paid, and that stays true whatever Finance does to the chart of accounts.

-- ── 4. verification ───────────────────────────────────────────────────────
select
  exists (select 1 from information_schema.tables
           where table_schema='public' and table_name='class_codes')          as table_exists,
  exists (select 1 from information_schema.columns
           where table_schema='public' and table_name='vendor_rates'
             and column_name='class_code')                                    as rates_have_class_code,
  (select count(*) from pg_policies
    where schemaname='public' and tablename='class_codes') = 1                as read_only_policy,
  (select count(*) from public.class_codes)                                   as codes_loaded;

-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠️ CLASS CODE IS NOT THE COST CODE.
--    work_packages.cost_code already exists and is the project's own budget
--    line reference — free text, project-specific. Class Code is Finance's
--    chart of accounts, shared with the Planning app. They are DIFFERENT
--    fields and neither derives from the other; an early draft of this
--    migration read the class code off cost_code and that was wrong.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.work_packages
  add column if not exists class_code text references public.class_codes(code) on delete set null;
create index if not exists idx_wp_class_code on public.work_packages(class_code);

comment on column public.work_packages.class_code is
  'Finance class code (chart of accounts). NOT the same as cost_code, which is '
  'the project''s own budget-line reference and stays free text.';

-- ⚠️ NOT BACK-FILLED. Nothing in the existing data reliably says which class
--    code a work package belongs to — inferring one from cost_code or from the
--    trade would be a guess written into a Finance-owned field, and a wrong
--    class code is worse than an empty one because it silently mis-files the
--    rate history underneath it.

-- ⚠️ wp_view_public: leave class_code OUT unless viewers should see it. It is
--    not cost data, so adding it is safe if wanted — but the view is not
--    rewritten here (rolling that definition forward blind risks dropping a
--    column, per the note on 2026-08-25_wp_free_of_charge.sql).

select
  exists (select 1 from information_schema.columns
           where table_schema='public' and table_name='work_packages'
             and column_name='class_code')                                    as wp_has_class_code,
  exists (select 1 from information_schema.columns
           where table_schema='public' and table_name='work_packages'
             and column_name='cost_code')                                     as cost_code_untouched;
