-- ═══════════════════════════════════════════════════════════════════════════
-- Vendor name aliases — "this spelling IS that company"
-- Run once, in the Supabase SQL Editor. Idempotent. No temp tables, no state
-- carried between statements (see migrations/README.md).
--
-- WHY THIS EXISTS
-- ───────────────
-- work_packages.contractor / .proposed_vendors are free text, entered over
-- years by many people. VendorDb's tiered resolver already recognises a name
-- that only LOOKS different — exact, then punctuation-insensitive, then
-- legal-suffix-insensitive — and that recovered 252 of 1,592 free-text names
-- (₱2.94B) without a single guess.
--
-- What it CANNOT recover is a short form or a trade name, because no safe rule
-- gets there. The live example: **"LG Philippines"** is
-- **"LG Electronics Philippines.Inc."** (`V-00594`, TIN 000-286-404-00000).
-- Both tokens of the typed name appear in the registered name, yet:
--   * "Philippines" is stripped as geography, leaving the core "lg";
--   * "lg" is 2 characters, below the resolver's 4-character floor;
--   * and "LG" alone would collide with LGC Automotive, LGM Global and
--     LGG Glass — three unrelated companies.
-- So the resolver refuses it, correctly. Only a person can say it is the same
-- company. This table is where they say it.
--
-- ⚠️ THIS IS NOT FUZZY MATCHING, AND IT MUST NEVER BECOME A HEURISTIC. Every
--    row here is a human assertion about one company, keyed on an exact
--    normalised string. It is the ONE place in the vendor-resolution chain
--    where evidence comes from a person rather than from the data, which is
--    exactly why it is allowed to outrank every derived tier.
--
-- ⚠️ IT REWRITES NO WORK-PACKAGE DATA. The contractor text on the work package
--    is the procurement record and stays byte-for-byte as entered; the alias
--    only changes what that text RESOLVES TO. So a mistake is undone by
--    deleting one row, and nothing downstream has been damaged in the meantime.
--    That reversibility is why this was chosen over stamping vendor_id onto
--    ~1,000 legacy work packages.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. the table ───────────────────────────────────────────────────────────
create table if not exists public.vendor_aliases (
  id              uuid primary key default gen_random_uuid(),
  -- as typed, for display and for editing back
  alias_text      text not null,
  -- ⚠️ BOTH KEYS ARE COMPUTED SERVER-SIDE BY THE TRIGGER BELOW, never taken
  --    from the client. A client-supplied lookup key is a client-supplied
  --    answer: send a wrong alias_norm and the alias silently applies to a
  --    string nobody typed.
  alias_norm      text not null,   -- trim + collapse whitespace + lowercase
  alias_squash    text not null,   -- the above, letters and digits only
  vendor_id       uuid not null references public.vendors(id) on delete cascade,
  note            text,
  created_at      timestamptz default now(),
  created_by      uuid,
  created_by_name text
);

comment on table public.vendor_aliases is
  'Human-stated "this spelling is that company" mappings, used by '
  'VendorDb.buildVendorIndex as its highest-priority tier. Rewrites no work '
  'package data — it only changes what free-text vendor names resolve to.';

-- ⚠️ ONE ALIAS PER SPELLING. Without this the same string could point at two
--    companies and the resolver would have to call it ambiguous — i.e. the
--    alias would achieve nothing while looking like it had been set.
create unique index if not exists vendor_aliases_norm_uidx
  on public.vendor_aliases (alias_norm);
create index if not exists vendor_aliases_squash_idx
  on public.vendor_aliases (alias_squash);
create index if not exists vendor_aliases_vendor_idx
  on public.vendor_aliases (vendor_id);


-- ── 2. keys + audit stamped server-side, and the shadowing guard ───────────
create or replace function internal.vendor_alias_guard()
returns trigger
language plpgsql
security definer
set search_path = public, internal
as $$
declare
  clash_id   uuid;
  clash_name text;
begin
  -- Mirror VendorDb's _vrExact / _vrSquash exactly, or an alias set here would
  -- never be found by the client (and vice versa).
  new.alias_text   := btrim(coalesce(new.alias_text, ''));
  new.alias_norm   := lower(btrim(regexp_replace(new.alias_text, '\s+', ' ', 'g')));
  new.alias_squash := regexp_replace(new.alias_norm, '[^a-z0-9]', '', 'g');

  if new.alias_norm = '' then
    raise exception 'An alias cannot be blank'
      using errcode = '22023';
  end if;

  /* ⚠️ AN ALIAS MUST NEVER SHADOW A REAL DIRECTORY NAME BELONGING TO ANOTHER
     COMPANY. Aliasing "Acme Corp" onto vendor B while "Acme Corp" IS vendor
     A's registered name would silently move every peso of A's awarded spend to
     B — the exact mis-attribution the resolver's refuse-to-guess rule exists to
     prevent, reintroduced by hand. An alias is for a spelling that resolves to
     NOBODY, not for overriding a company's own name. */
  select v.id, v.name into clash_id, clash_name
    from public.vendors v
   where lower(btrim(regexp_replace(v.name, '\s+', ' ', 'g'))) = new.alias_norm
     and v.id <> new.vendor_id
   limit 1;

  if clash_id is not null then
    raise exception 'That spelling is already the registered name of another vendor (%) — an alias cannot override a company''s own name', clash_name
      using errcode = '23505',
            hint = 'If these are the same company, merge the two vendor records instead of aliasing one onto the other.';
  end if;

  -- Unforgeable attribution, same reasoning as internal.vendor_edit_guard.
  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, now());
    new.created_by := auth.uid();
    select u.name into new.created_by_name from public.users u where u.id = auth.uid();
  else
    new.created_at      := old.created_at;
    new.created_by      := old.created_by;
    new.created_by_name := old.created_by_name;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_vendor_alias_guard on public.vendor_aliases;
create trigger trg_vendor_alias_guard
  before insert or update on public.vendor_aliases
  for each row execute function internal.vendor_alias_guard();


-- ── 3. RLS ─────────────────────────────────────────────────────────────────
alter table public.vendor_aliases enable row level security;

/* Readable by every internal role — the resolver runs on the dashboards' WP
   vendor filter as well as in Vendor Management, so a role that can read the
   directory must be able to read its aliases or the two disagree about which
   company a work package names. The `vendor` role is excluded, matching
   vendors_select. */
drop policy if exists "valias_select" on public.vendor_aliases;
create policy "valias_select" on public.vendor_aliases
  for select to authenticated
  using (internal.get_my_status() = 'approved' and internal.get_my_role() <> 'vendor');

/* ⚠️ WRITE IS THE CONTRIBUTOR AUDIENCE, NOT ADMIN-ONLY, and that is deliberate.
   merge_vendors and delete_vendor_cascade are admin-gated because they DESTROY
   records; an alias destroys nothing and is undone by deleting one row. The
   people who know that "LG Philippines" is LG Electronics are the officers
   doing the buying, and putting this behind an admin would mean the knowledge
   never gets recorded. Same audience as vendors_update. */
drop policy if exists "valias_insert" on public.vendor_aliases;
create policy "valias_insert" on public.vendor_aliases
  for insert to authenticated
  with check (internal.get_my_status() = 'approved'
              and internal.get_my_role() not in ('viewer','viewer_budget','vendor'));

drop policy if exists "valias_update" on public.vendor_aliases;
create policy "valias_update" on public.vendor_aliases
  for update to authenticated
  using (internal.get_my_status() = 'approved'
         and internal.get_my_role() not in ('viewer','viewer_budget','vendor'))
  with check (internal.get_my_status() = 'approved'
              and internal.get_my_role() not in ('viewer','viewer_budget','vendor'));

drop policy if exists "valias_delete" on public.vendor_aliases;
create policy "valias_delete" on public.vendor_aliases
  for delete to authenticated
  using (internal.get_my_status() = 'approved'
         and internal.get_my_role() not in ('viewer','viewer_budget','vendor'));

grant select, insert, update, delete on public.vendor_aliases to authenticated;


-- ── 4. verification — every column must read t ─────────────────────────────
select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'vendor_aliases') = 1        as table_present,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'vendor_aliases'
      and column_name in ('alias_text','alias_norm','alias_squash','vendor_id','note')) = 5
                                                                                as columns_present,
  (select count(*) from pg_indexes
    where schemaname = 'public' and indexname = 'vendor_aliases_norm_uidx') = 1 as one_alias_per_spelling,
  (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where c.relname = 'vendor_aliases' and t.tgname = 'trg_vendor_alias_guard'
      and t.tgenabled <> 'D') = 1                                               as guard_installed,
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'internal' and p.proname = 'vendor_alias_guard')          as guard_is_definer,
  (select p.prosrc like '%cannot override a company%' from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'internal' and p.proname = 'vendor_alias_guard')          as shadowing_refused,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'vendor_aliases') = 4           as four_policies,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'vendor_aliases'
      and cmd <> 'SELECT'
      and coalesce(qual,'') || coalesce(with_check,'') not like '%viewer%') = 0              as writes_exclude_readonly,
  (select count(*) from public.vendor_aliases)                                 as aliases_on_file;
