-- ============================================================================
-- Vendor merge + cascade-delete (2026-08-10)
-- Run once in the Supabase SQL Editor. Requires Phase 2a + 2b migrations.
--
-- Two SECURITY DEFINER helpers (same accepted-exception pattern as
-- admin_delete_user): the front-end can't reassign FKs / delete across the
-- vendor_* tables + work_packages atomically under RLS, so these run as the
-- owner and self-authorize from the caller's JWT role (get_my_role()).
-- ============================================================================

-- Merge one or more duplicate vendors (p_sources) INTO a canonical vendor
-- (p_target): reassigns all child rows + linked work packages, unions trade
-- categories, then deletes the source vendor rows. Atomic (single function
-- call = single transaction).
create or replace function public.merge_vendors(p_target uuid, p_sources uuid[])
returns void
language plpgsql
security definer
set search_path = public, internal
as $$
declare
  r text;
begin
  r := internal.get_my_role();
  -- Allow-list (matches the admin-only `vendors_delete` RLS policy) — merging
  -- is destructive, so it must NOT be reachable by write-tier or read-only
  -- (viewer/viewer_budget) roles via this SECURITY DEFINER path.
  if r is null or r not in ('super_admin','admin') then
    raise exception 'not authorized to merge vendors' using errcode = '42501';
  end if;
  if p_target is null or p_sources is null then return; end if;
  -- never fold the target into itself
  p_sources := array(select s from unnest(p_sources) s where s <> p_target);
  if array_length(p_sources, 1) is null then return; end if;

  -- child tables keyed only by vendor_id (no per-vendor uniqueness)
  update vendor_products       set vendor_id = p_target where vendor_id = any(p_sources);
  update vendor_certifications set vendor_id = p_target where vendor_id = any(p_sources);
  update vendor_personnel      set vendor_id = p_target where vendor_id = any(p_sources);

  -- vendor_rates gained UNIQUE(vendor_id, wp_id) in MIGRATION_vendor_rates_wp_link_fix.sql,
  -- AFTER this function was first written — a plain reassign therefore aborts the whole merge
  -- with 23505 whenever the target already has a rate for the same WP (hit in production
  -- while cleaning up import duplicates). Same treatment as vendor_bids below: drop the
  -- source rows that would collide, then reassign the rest. Rows with wp_id IS NULL are
  -- manual staff entries and are never constrained, so they always just move across.
  -- Collisions come from TWO directions and both must be cleared before the reassign:
  --   (a) the target already holds a rate for that WP, and
  --   (b) two SOURCES each hold one for the same WP — they collide with each other the
  --       moment both are moved onto the target. (b) is what still failed after (a) was
  --       fixed, on a 5-copy duplicate group; keep the lowest id so the choice is stable.
  delete from vendor_rates r
    where r.vendor_id = any(p_sources)
      and r.wp_id is not null
      and (
        exists (select 1 from vendor_rates t
                 where t.vendor_id = p_target and t.wp_id = r.wp_id)
        or exists (select 1 from vendor_rates o
                    where o.vendor_id = any(p_sources) and o.wp_id = r.wp_id and o.id < r.id)
      );
  update vendor_rates set vendor_id = p_target where vendor_id = any(p_sources);

  -- vendor_bids has UNIQUE(vendor_id, wp_id): if the target already has a bid
  -- on the same WP, drop the source's duplicate; otherwise reassign it.
  -- Same two-directional collision rule as vendor_rates above (this originally only
  -- compared against the target, so two sources bidding on the same WP would collide).
  delete from vendor_bids b
    where b.vendor_id = any(p_sources)
      and (
        exists (select 1 from vendor_bids t
                 where t.vendor_id = p_target and t.wp_id = b.wp_id)
        or exists (select 1 from vendor_bids o
                    where o.vendor_id = any(p_sources) and o.wp_id = b.wp_id and o.id < b.id)
      );
  update vendor_bids set vendor_id = p_target where vendor_id = any(p_sources);

  -- linked work packages (awarded vendor FK)
  update work_packages set vendor_id = p_target where vendor_id = any(p_sources);

  -- proposed_vendor_ids uuid[] has no FK — substitute every source id with the
  -- target (dedup), so a merged-away proposed vendor repoints instead of leaking.
  -- Guarded so the RPC still works if that column's migration hasn't run.
  if exists (select 1 from information_schema.columns
             where table_name = 'work_packages' and column_name = 'proposed_vendor_ids') then
    update work_packages set proposed_vendor_ids = (
      select array(select distinct case when e = any(p_sources) then p_target else e end
                   from unnest(proposed_vendor_ids) e)
    ) where proposed_vendor_ids && p_sources;
  end if;

  -- awarded_vendor_ids uuid[] + awarded_vendor_amounts numeric[] are INDEX-ALIGNED
  -- (element i of one belongs with element i of the other), so they must be rebuilt
  -- together — never with array_remove/array_replace, which would shift one array
  -- against the other and reattribute every later vendor's money.
  -- On merge: substitute each source id with the target, then collapse duplicates
  -- (target already co-awarded on the same WP) by SUMMING their amounts, keeping the
  -- earliest position so the surviving order is stable.
  if exists (select 1 from information_schema.columns
             where table_name = 'work_packages' and column_name = 'awarded_vendor_ids') then
    update work_packages w
       set awarded_vendor_ids = agg.ids,
           awarded_vendor_amounts = case when w.awarded_vendor_amounts is null then null else agg.amts end
      from (
        select x.wid,
               array_agg(x.vid order by x.ord) as ids,
               array_agg(x.amt order by x.ord) as amts
          from (
            select w2.id as wid,
                   case when u.e = any(p_sources) then p_target else u.e end as vid,
                   min(u.ord) as ord,
                   case when count(w2.awarded_vendor_amounts[u.ord]) = 0
                        then null else sum(w2.awarded_vendor_amounts[u.ord]) end as amt
              from work_packages w2
              cross join lateral unnest(w2.awarded_vendor_ids) with ordinality as u(e, ord)
             where w2.awarded_vendor_ids && p_sources
             group by w2.id, 2
          ) x
         group by x.wid
      ) agg
     where w.id = agg.wid;
  end if;

  -- any vendor logins pointing at a source now point at the target
  update users set vendor_id = p_target where vendor_id = any(p_sources);

  -- union the source trade_categories into the target
  update vendors t set trade_categories = (
    select array(select distinct x from unnest(
      coalesce(t.trade_categories, '{}'::text[]) ||
      coalesce((select array_agg(u) from vendors s cross join lateral unnest(s.trade_categories) u
                where s.id = any(p_sources)), '{}'::text[])
    ) x)
  ) where t.id = p_target;

  delete from vendors where id = any(p_sources);
end;
$$;

-- Fully delete a vendor: null out its work-package links + vendor logins, drop
-- all its child rows, then delete the vendor. (Does NOT delete the vendor's
-- auth.users login — use the admin Remove-user flow for that; an orphaned
-- vendor login with a null vendor_id simply can't reach the portal.)
create or replace function public.delete_vendor_cascade(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, internal
as $$
declare
  r text;
begin
  r := internal.get_my_role();
  -- Allow-list (matches the admin-only `vendors_delete` RLS policy).
  if r is null or r not in ('super_admin','admin') then
    raise exception 'not authorized to delete vendors' using errcode = '42501';
  end if;
  if p_id is null then return; end if;
  update work_packages set vendor_id = null where vendor_id = p_id;
  -- drop the id from any proposed_vendor_ids arrays (no FK to cascade it)
  if exists (select 1 from information_schema.columns
             where table_name = 'work_packages' and column_name = 'proposed_vendor_ids') then
    update work_packages set proposed_vendor_ids = array_remove(proposed_vendor_ids, p_id)
      where p_id = any(proposed_vendor_ids);
  end if;

  -- awarded_vendor_ids / awarded_vendor_amounts are INDEX-ALIGNED — drop the deleted
  -- vendor's POSITION from both arrays together. Using array_remove on the ids alone
  -- would leave the amounts array longer and shift every later vendor's amount onto
  -- the wrong vendor.
  if exists (select 1 from information_schema.columns
             where table_name = 'work_packages' and column_name = 'awarded_vendor_ids') then
    update work_packages w
       set awarded_vendor_ids = agg.ids,
           awarded_vendor_amounts = case when w.awarded_vendor_amounts is null then null else agg.amts end
      from (
        select w2.id as wid,
               coalesce(array_agg(u.e order by u.ord)
                        filter (where not (u.e = any(array[p_id]))), '{}'::uuid[]) as ids,
               coalesce(array_agg(w2.awarded_vendor_amounts[u.ord] order by u.ord)
                        filter (where not (u.e = any(array[p_id]))), '{}'::numeric[]) as amts
          from work_packages w2
          cross join lateral unnest(w2.awarded_vendor_ids) with ordinality as u(e, ord)
         where w2.awarded_vendor_ids && array[p_id]
         group by w2.id
      ) agg
     where w.id = agg.wid;
  end if;
  delete from vendor_bids          where vendor_id = p_id;
  delete from vendor_rates         where vendor_id = p_id;
  delete from vendor_products      where vendor_id = p_id;
  delete from vendor_certifications where vendor_id = p_id;
  delete from vendor_personnel     where vendor_id = p_id;
  update users set vendor_id = null where vendor_id = p_id;
  delete from vendors where id = p_id;
end;
$$;

-- Bulk cascade-delete (directory bulk-select). Same admin-only allow-list and
-- cascade steps as delete_vendor_cascade, but over an array in one call so
-- triaging hundreds of imported vendors isn't hundreds of round trips.
create or replace function public.delete_vendors_cascade(p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public, internal
as $$
declare
  r text;
begin
  r := internal.get_my_role();
  if r is null or r not in ('super_admin','admin') then
    raise exception 'not authorized to delete vendors' using errcode = '42501';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then return; end if;
  update work_packages set vendor_id = null where vendor_id = any(p_ids);
  if exists (select 1 from information_schema.columns
             where table_name = 'work_packages' and column_name = 'proposed_vendor_ids') then
    update work_packages set proposed_vendor_ids = (
      select array(select e from unnest(proposed_vendor_ids) e where not (e = any(p_ids)))
    ) where proposed_vendor_ids && p_ids;
  end if;

  -- awarded_vendor_ids / awarded_vendor_amounts are INDEX-ALIGNED — drop the deleted
  -- vendor's POSITION from both arrays together. Using array_remove on the ids alone
  -- would leave the amounts array longer and shift every later vendor's amount onto
  -- the wrong vendor.
  if exists (select 1 from information_schema.columns
             where table_name = 'work_packages' and column_name = 'awarded_vendor_ids') then
    update work_packages w
       set awarded_vendor_ids = agg.ids,
           awarded_vendor_amounts = case when w.awarded_vendor_amounts is null then null else agg.amts end
      from (
        select w2.id as wid,
               coalesce(array_agg(u.e order by u.ord)
                        filter (where not (u.e = any(p_ids))), '{}'::uuid[]) as ids,
               coalesce(array_agg(w2.awarded_vendor_amounts[u.ord] order by u.ord)
                        filter (where not (u.e = any(p_ids))), '{}'::numeric[]) as amts
          from work_packages w2
          cross join lateral unnest(w2.awarded_vendor_ids) with ordinality as u(e, ord)
         where w2.awarded_vendor_ids && p_ids
         group by w2.id
      ) agg
     where w.id = agg.wid;
  end if;
  delete from vendor_bids          where vendor_id = any(p_ids);
  delete from vendor_rates         where vendor_id = any(p_ids);
  delete from vendor_products      where vendor_id = any(p_ids);
  delete from vendor_certifications where vendor_id = any(p_ids);
  delete from vendor_personnel     where vendor_id = any(p_ids);
  update users set vendor_id = null where vendor_id = any(p_ids);
  delete from vendors where id = any(p_ids);
end;
$$;

revoke all on function public.merge_vendors(uuid, uuid[]) from public, anon;
revoke all on function public.delete_vendors_cascade(uuid[]) from public, anon;
grant execute on function public.delete_vendors_cascade(uuid[]) to authenticated;
revoke all on function public.delete_vendor_cascade(uuid) from public, anon;
grant execute on function public.merge_vendors(uuid, uuid[]) to authenticated;
grant execute on function public.delete_vendor_cascade(uuid) to authenticated;

comment on function public.merge_vendors(uuid, uuid[]) is
  'Staff-only (self-authorizes via internal.get_my_role()). Folds source vendors into a target: reassigns child rows + work_packages.vendor_id, unions trades, deletes sources. SECURITY DEFINER is required (client cannot do this cross-table under RLS).';
comment on function public.delete_vendor_cascade(uuid) is
  'Staff-only. Nulls work_packages.vendor_id + users.vendor_id, deletes vendor child rows, then the vendor. SECURITY DEFINER by necessity; self-authorizes via get_my_role().';

-- ── Consistency fixes (audit 2026-08-10) ───────────────────────────────────
-- vendor_bids.vendor_id was NO ACTION while every sibling child table cascades;
-- make it cascade so a direct vendor delete (or the deleteVendor fallback) can't
-- be FK-blocked only for vendors that happen to have bids.
alter table vendor_bids drop constraint if exists vendor_bids_vendor_id_fkey;
alter table vendor_bids add constraint vendor_bids_vendor_id_fkey
  foreign key (vendor_id) references vendors(id) on delete cascade;

-- Enforce one vendor row per invite email (the invite model assumes uniqueness).
-- Wrapped so pre-existing duplicates only NOTICE instead of aborting the re-run.
do $$
begin
  create unique index if not exists vendors_invite_email_uidx on vendors (lower(invite_email));
exception when others then
  raise notice 'Skipped unique index on vendors.invite_email (dedupe existing duplicates first): %', sqlerrm;
end $$;
