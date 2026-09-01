-- ============================================================================
-- Vendor child tables — audit trail (who created / last changed / archived)
-- Megawide WPM Dashboard
-- ----------------------------------------------------------------------------
-- Run ONCE in the Supabase SQL Editor (production). Idempotent — safe to re-run.
-- No temp tables and no cross-statement state, so it runs whole OR one statement
-- at a time.
--
-- ⚠️ RUN AFTER `2026-09-01_vendor_child_soft_delete.sql`. It sorts BEFORE that
-- file alphabetically ("audit" < "soft"), which is one more reason filename
-- order is not run order — see migrations/README.md.
--
-- WHY
-- ---
-- Step 3 of the vendor-data hardening. The soft-delete migration stopped a
-- vendor login DESTROYING its own child rows, but a vendor still holds UPDATE
-- and can overwrite any row's contents with rubbish. That is not something
-- authorization can prevent — editing their own profile is the entire point of
-- the portal — so the answer is not another restriction, it is being able to
-- SEE what changed and who changed it.
--
-- Today `vendor_products` / `vendor_certifications` / `vendor_personnel` carry
-- ONLY `created_at`. There is no updated_at, no actor on any operation, so
-- "what did this account do?" is unanswerable. `vendors` itself has had
-- created_by/updated_by/updated_by_name since Phase 2a; this brings its four
-- child tables up to the same standard.
--
-- WHAT THIS CHANGES
-- -----------------
-- 1. Adds created_by / created_by_name / updated_at / updated_by /
--    updated_by_name to all four child tables.
-- 2. Replaces internal.stamp_archived() with internal.stamp_child_audit(),
--    which stamps ALL of it — insert, update, archive and restore — from
--    auth.uid() SERVER-SIDE, so the actor cannot be forged by the client.
--
-- ⚠️ WHY A NEW FUNCTION NAME RATHER THAN `create or replace` ON THE OLD ONE:
-- five separate migrations each replaced internal.vendor_edit_guard() and the
-- last two branched from different ancestors, so whichever ran last silently
-- disabled part of the other (see
-- migrations/2026-09-01_vendor_edit_guard_consolidated.sql). Replacing
-- stamp_archived() in place would set up the identical trap: re-running the
-- soft-delete migration afterwards would quietly revert this file's stamping.
-- With a distinct name, a stray re-run of that migration merely re-adds its own
-- narrower trigger alongside this one — both stamp archived_by identically, so
-- the result is REDUNDANT BUT HARMLESS, never silent data loss.
--
-- NOT CHANGED, deliberately:
--   * `vendor_documents.uploaded_by` / `uploaded_by_name` predate this and are
--     set by the CLIENT. They are left alone so nothing that reads them breaks;
--     created_by/created_by_name now carry the same fact but stamped
--     server-side, so prefer those — they cannot be forged.
--   * Nothing is back-filled. A NULL actor honestly means "changed before this
--     migration, or by a service-role/SQL-editor process where auth.uid() is
--     NULL" — inventing an actor would be worse than admitting we do not know.
-- ============================================================================

-- ── 1. Audit columns on all four child tables ───────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['vendor_products','vendor_certifications',
                           'vendor_personnel','vendor_documents']
  loop
    if to_regclass('public.' || t) is null then
      raise notice 'SKIP %: table does not exist (its own migration has not run)', t;
      continue;
    end if;
    execute format('alter table public.%I add column if not exists created_by uuid', t);
    execute format('alter table public.%I add column if not exists created_by_name text', t);
    execute format('alter table public.%I add column if not exists updated_at timestamptz', t);
    execute format('alter table public.%I add column if not exists updated_by uuid', t);
    execute format('alter table public.%I add column if not exists updated_by_name text', t);
  end loop;
end $$;

-- ── 2. One trigger function for the whole trail ─────────────────────────────
-- Supersedes internal.stamp_archived() from the soft-delete migration.
create or replace function internal.stamp_child_audit()
returns trigger language plpgsql security definer
set search_path = public as $$
declare actor uuid; actor_name text;
begin
  actor := auth.uid();
  -- A vendor login can only see its OWN users row (users_select), which is why
  -- this must be SECURITY DEFINER: an invoker-rights lookup would return NULL
  -- for every staff actor.
  if actor is not null then
    select coalesce(u.name, u.email) into actor_name from public.users u where u.id = actor;
  end if;

  if TG_OP = 'INSERT' then
    new.created_by      := actor;
    new.created_by_name := actor_name;
    new.updated_at      := now();
    new.updated_by      := actor;
    new.updated_by_name := actor_name;
    return new;
  end if;

  -- UPDATE. Every change is stamped, archiving included (it IS an update).
  new.updated_at      := now();
  new.updated_by      := actor;
  new.updated_by_name := actor_name;

  -- created_* is immutable: a client that sends its own value is overruled.
  new.created_by      := old.created_by;
  new.created_by_name := old.created_by_name;

  if new.archived_at is not null and old.archived_at is null then
    new.archived_by      := actor;
    new.archived_by_name := actor_name;
  elsif new.archived_at is null and old.archived_at is not null then
    new.archived_by      := null;      -- restored: drop the stale attribution
    new.archived_by_name := null;
  else
    -- archived_by is owned by this trigger, never by the client.
    new.archived_by      := old.archived_by;
    new.archived_by_name := old.archived_by_name;
  end if;

  return new;
end $$;

comment on function internal.stamp_child_audit() is
  'INTENTIONAL SECURITY DEFINER. Stamps created_by/updated_by/archived_by (and '
  'their _name snapshots) on the vendor child tables from auth.uid(). Definer '
  'because a vendor login can only see its OWN public.users row, so an '
  'invoker-rights name lookup would return NULL for staff. Writes only audit '
  'columns on the row being changed and returns no data to the caller. '
  'Supersedes internal.stamp_archived(); see this file''s header for why it is '
  'a new name rather than a create-or-replace.';

-- ── 3. Swap the triggers ────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['vendor_products','vendor_certifications',
                           'vendor_personnel','vendor_documents']
  loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop trigger if exists trg_stamp_archived on public.%I', t);
    execute format('drop trigger if exists trg_stamp_child_audit on public.%I', t);
    execute format('create trigger trg_stamp_child_audit before insert or update '
                   'on public.%I for each row execute function internal.stamp_child_audit()', t);
  end loop;
end $$;

-- Safe now that no trigger references it. `if exists` keeps this re-runnable.
drop function if exists internal.stamp_archived();

-- ── 4. Verification — EVERY column must read true ───────────────────────────
select
  (select count(*) = 20 from information_schema.columns
     where table_schema='public'
       and column_name in ('created_by','created_by_name','updated_at','updated_by','updated_by_name')
       and table_name in ('vendor_products','vendor_certifications',
                          'vendor_personnel','vendor_documents'))          as audit_cols_on_all_4,
  (select count(*) = 4 from pg_trigger
     where tgname = 'trg_stamp_child_audit' and not tgisinternal)          as audit_trigger_on_all_4,
  (select count(*) = 0 from pg_trigger
     where tgname = 'trg_stamp_archived' and not tgisinternal)             as old_trigger_gone,
  (select count(*) = 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='internal' and p.proname='stamp_archived')            as old_function_gone,
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='internal' and p.proname='stamp_child_audit')         as is_security_definer,
  (select count(*) = 4 from information_schema.columns
     where table_schema='public' and column_name='archived_at'
       and table_name in ('vendor_products','vendor_certifications',
                          'vendor_personnel','vendor_documents'))          as soft_delete_still_present;
