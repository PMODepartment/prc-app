-- ============================================================================
-- Admin "complete user removal"  —  Megawide WPM Dashboard
-- ----------------------------------------------------------------------------
-- Run once in the Supabase SQL Editor (production). Idempotent — safe to re-run.
--
-- The admin "Remove" button previously deleted only the public.users PROFILE
-- row (WPDb.deleteUser → delete from public.users). The underlying auth.users
-- record survived — an orphaned auth account that can't sign in (no profile →
-- AppAuth.requireLogin signs them out) but STILL OCCUPIES THEIR EMAIL, so the
-- person could never re-register with the same address, and the account kept
-- showing up in the Supabase Auth dashboard.
--
-- The auth schema is not writable by the anon/authenticated client (no
-- service-role key in a static front-end), so this SECURITY DEFINER function —
-- owned by `postgres`, which owns the auth schema — does the purge server-side
-- after verifying the CALLER is an admin/super_admin. It removes BOTH the
-- profile row and the auth.users record (the Planning App parity behaviour).
-- ============================================================================

create or replace function public.admin_delete_user(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
begin
  -- Only admins / super_admins may delete users.
  select role into caller_role from public.users where id = auth.uid() limit 1;
  if caller_role is null or caller_role not in ('super_admin', 'admin') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Never let an admin delete themselves (avoids locking out the last admin).
  if target_id = auth.uid() then
    raise exception 'cannot remove your own account' using errcode = '22023';
  end if;

  -- Remove the app profile first, then the auth account.
  delete from public.users where id = target_id;
  delete from auth.users  where id = target_id;
end;
$$;

-- Lock down execution: not the public/anon roles, only signed-in users
-- (the function itself re-checks the caller is an admin).
revoke all on function public.admin_delete_user(uuid) from public, anon;
grant execute on function public.admin_delete_user(uuid) to authenticated;

-- The Supabase advisor flags this as a SECURITY DEFINER function callable by the
-- `authenticated` role — that is INTENTIONAL and safe, not a defect:
--   • It MUST be SECURITY DEFINER: it deletes from auth.users, owned by postgres;
--     a static front-end has no service-role key, so a signed-in admin can only
--     purge the auth account through a definer RPC.
--   • It MUST be callable by `authenticated` and live in the exposed `public`
--     schema, or PostgREST could not expose it at /rest/v1/rpc for the admin UI.
--   • It self-authorizes: auth.uid() returns the CALLER's id even inside a definer
--     function (it reads the request JWT), so the role check above rejects any
--     non-admin with 42501 BEFORE touching a row — no escalation, no enumeration.
--   • Self-deletion is blocked and search_path is pinned to public.
-- Do NOT switch to SECURITY INVOKER (the client can't write auth.users) or revoke
-- EXECUTE (the admin Remove button would break). Dismiss the advisory.
comment on function public.admin_delete_user(uuid) is
  'INTENTIONAL SECURITY DEFINER RPC. Purges a user (public.users + auth.users). '
  'Self-authorizes via auth.uid(): rejects non-admin callers with 42501 before any '
  'delete, and refuses self-deletion. Must stay DEFINER + EXECUTE-to-authenticated + '
  'in public schema so the admin UI can call it (no service-role key in the client). '
  'The Supabase security_definer/RPC advisory on this function is an accepted exception.';
