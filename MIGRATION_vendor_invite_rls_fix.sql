-- ============================================================================
-- Vendor invite RLS fix — Megawide WPM Dashboard
-- ----------------------------------------------------------------------------
-- Run once in the Supabase SQL Editor (production). Idempotent — safe to re-run.
-- Fixes a bug found during live end-to-end testing of Phase 2a
-- (MIGRATION_vendor_management.sql): a brand-new vendor could never actually
-- complete registration.
--
-- Root cause: the "users_insert_vendor" policy's WITH CHECK included
-- `exists(select 1 from vendors v where ...)`. That subquery is ITSELF subject
-- to vendors' own RLS ("vendors_select"), which requires
-- internal.get_my_status() = 'approved' — looked up from the caller's OWN
-- users row. But at the exact moment of THIS insert, the caller's users row
-- doesn't exist yet (it's the row being created), so get_my_status() returns
-- NULL, vendors_select denies the subquery any visibility into the vendors
-- table, EXISTS evaluates false, and the insert is rejected with 42501 —
-- even for a perfectly valid, unclaimed invite. A classic RLS
-- chicken-and-egg problem: checking a second RLS-protected table from inside
-- a policy on the first requires bypassing that second table's RLS.
--
-- Fix: move the invite-validity check into a SECURITY DEFINER function
-- (bypasses RLS, same pattern as admin_delete_user in
-- MIGRATION_admin_delete_user.sql), and reference that function from the
-- policy instead of a raw subquery.
-- ============================================================================

create or replace function internal.vendor_invite_valid(vid uuid, claim_email text)
returns boolean language sql security definer stable
set search_path = public as $$
  select exists(
    select 1 from public.vendors v
    where v.id = vid
      and v.invite_claimed_at is null
      and lower(v.invite_email) = lower(claim_email)
  );
$$;
grant execute on function internal.vendor_invite_valid(uuid, text) to authenticated;

drop policy if exists "users_insert_vendor" on users;
create policy "users_insert_vendor" on users
  for insert to authenticated
  with check (
    id = auth.uid()
    and role = 'vendor'
    and status = 'approved'
    and vendor_id is not null
    and internal.vendor_invite_valid(vendor_id, coalesce(auth.jwt() ->> 'email', ''))
  );

-- internal.vendor_invite_valid is self-contained (only reads vendors by the
-- exact vid/email passed in, no caller-supplied SQL), so it carries the same
-- accepted SECURITY DEFINER exception already documented for
-- admin_delete_user and get_my_role/get_my_status/get_my_projects — it must
-- be definer to see the vendors row before the caller has a users row at
-- all, and it can't be misused to read arbitrary vendors data since it only
-- ever returns a boolean.
comment on function internal.vendor_invite_valid(uuid, text) is
  'INTENTIONAL SECURITY DEFINER helper. Bypasses vendors RLS to check invite '
  'validity during vendor self-registration, before the caller has a users '
  'row (and therefore no visibility into vendors under normal RLS). Returns '
  'only a boolean — never exposes row data. Same accepted-exception pattern '
  'as internal.get_my_role()/get_my_status()/get_my_projects().';
