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
  if r is null or r in ('vendor','viewer') then
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
  update vendor_rates          set vendor_id = p_target where vendor_id = any(p_sources);

  -- vendor_bids has UNIQUE(vendor_id, wp_id): if the target already has a bid
  -- on the same WP, drop the source's duplicate; otherwise reassign it.
  delete from vendor_bids b
    where b.vendor_id = any(p_sources)
      and exists (select 1 from vendor_bids t where t.vendor_id = p_target and t.wp_id = b.wp_id);
  update vendor_bids set vendor_id = p_target where vendor_id = any(p_sources);

  -- linked work packages
  update work_packages set vendor_id = p_target where vendor_id = any(p_sources);

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
  if r is null or r in ('vendor','viewer') then
    raise exception 'not authorized to delete vendors' using errcode = '42501';
  end if;
  if p_id is null then return; end if;
  update work_packages set vendor_id = null where vendor_id = p_id;
  delete from vendor_bids          where vendor_id = p_id;
  delete from vendor_rates         where vendor_id = p_id;
  delete from vendor_products      where vendor_id = p_id;
  delete from vendor_certifications where vendor_id = p_id;
  delete from vendor_personnel     where vendor_id = p_id;
  update users set vendor_id = null where vendor_id = p_id;
  delete from vendors where id = p_id;
end;
$$;

revoke all on function public.merge_vendors(uuid, uuid[]) from public, anon;
revoke all on function public.delete_vendor_cascade(uuid) from public, anon;
grant execute on function public.merge_vendors(uuid, uuid[]) to authenticated;
grant execute on function public.delete_vendor_cascade(uuid) to authenticated;

comment on function public.merge_vendors(uuid, uuid[]) is
  'Staff-only (self-authorizes via internal.get_my_role()). Folds source vendors into a target: reassigns child rows + work_packages.vendor_id, unions trades, deletes sources. SECURITY DEFINER is required (client cannot do this cross-table under RLS).';
comment on function public.delete_vendor_cascade(uuid) is
  'Staff-only. Nulls work_packages.vendor_id + users.vendor_id, deletes vendor child rows, then the vendor. SECURITY DEFINER by necessity; self-authorizes via get_my_role().';
