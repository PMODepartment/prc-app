-- ============================================================================
-- Vendor child tables — take DELETE away from the vendor role, add soft-delete
-- Megawide WPM Dashboard
-- ----------------------------------------------------------------------------
-- Run ONCE in the Supabase SQL Editor (production). Idempotent — safe to re-run.
-- No temp tables and no cross-statement state, so it runs whole OR one statement
-- at a time (the SEED_vendor_accreditation.sql lesson).
--
-- WHY
-- ---
-- MIGRATION_vendor_management.sql creates the child-table write policy as
-- `for all`, which in Postgres RLS covers SELECT, INSERT, UPDATE **and DELETE**.
-- MIGRATION_vendor_accreditation_requests.sql copies the same shape for
-- vendor_documents. So any vendor login can HARD-DELETE every row under its own
-- vendor_id — every offering, every certification, every personnel record, and
-- every uploaded accreditation document (BIR 2303, business permit, the sample
-- invoice) — plus the underlying files in the vendor-certs bucket.
--
-- None of those tables carry updated_by/updated_at, there is no soft-delete, and
-- this app has no undo anywhere. So the loss is silent, untraceable and total.
--
-- ⚠️ THIS IS A LIVE EXPOSURE INDEPENDENT OF HOW A VENDOR AUTHENTICATES. A
-- compromised password, a shared login, a departing employee at the vendor, or a
-- mis-click does exactly the same damage as a wrongly-admitted stranger. Fixing
-- the login gate does NOT fix this; only removing the capability does.
--
-- WHAT THIS CHANGES
-- -----------------
-- 1. Splits the `for all` policy into insert / update / delete, and grants
--    DELETE to STAFF ONLY. A vendor keeps select/insert/update on its own rows.
-- 2. Adds archived_at / archived_by / archived_by_name so "Remove" in
--    vendor-portal.html becomes a reversible archive instead of a DELETE.
-- 3. Stamps archived_by SERVER-SIDE from auth.uid(), so the attribution cannot
--    be forged by the client — same reasoning as internal.vendor_edit_guard.
-- 4. Takes vendor DELETE off the vendor-certs Storage bucket, so archiving a
--    certification or document RETAINS the file for staff to restore.
--
-- NOT CHANGED, deliberately:
--   * Staff keep hard DELETE. They are the recovery mechanism, and
--     delete_vendor_cascade / merge_vendors (SECURITY DEFINER) bypass RLS
--     entirely and are unaffected either way.
--   * A vendor keeps UPDATE, so it can still overwrite a row's contents with
--     rubbish. Soft-delete does not cover that — the audit trail does, and that
--     is the NEXT step, not this one.
-- ============================================================================

-- ── 1. Soft-delete columns on all four child tables ─────────────────────────
-- Additive and nullable. NULL = live, which is every existing row, so nothing
-- disappears from any list the moment this runs.
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
    execute format('alter table public.%I add column if not exists archived_at timestamptz', t);
    execute format('alter table public.%I add column if not exists archived_by uuid', t);
    execute format('alter table public.%I add column if not exists archived_by_name text', t);
    -- Partial index: every list view filters `archived_at is null`, which is
    -- almost every row, so index the live set rather than the whole table.
    execute format('create index if not exists %I on public.%I (vendor_id) where archived_at is null',
                   t || '_live_idx', t);
  end loop;
end $$;

-- ── 2. Server-side archive stamp ────────────────────────────────────────────
-- The client never supplies archived_by. A vendor archiving its own row is
-- always attributed to that vendor; a staff restore clears the stamp.
create or replace function internal.stamp_archived()
returns trigger language plpgsql security definer
set search_path = public as $$
declare actor_name text;
begin
  if new.archived_at is not null and old.archived_at is null then
    select coalesce(u.name, u.email) into actor_name from public.users u where u.id = auth.uid();
    new.archived_by      := auth.uid();
    new.archived_by_name := actor_name;
  elsif new.archived_at is null and old.archived_at is not null then
    new.archived_by      := null;      -- restored: drop the stale attribution
    new.archived_by_name := null;
  end if;
  return new;
end $$;

comment on function internal.stamp_archived() is
  'INTENTIONAL SECURITY DEFINER. Reads public.users to resolve the caller''s '
  'display name while stamping archived_by. Definer because a vendor login can '
  'only see its OWN users row (users_select), so an invoker-rights lookup would '
  'return NULL for staff. Writes only archived_by/archived_by_name on the row '
  'being updated; returns no data to the caller.';

do $$
declare t text;
begin
  foreach t in array array['vendor_products','vendor_certifications',
                           'vendor_personnel','vendor_documents']
  loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop trigger if exists trg_stamp_archived on public.%I', t);
    execute format('create trigger trg_stamp_archived before update on public.%I '
                   'for each row execute function internal.stamp_archived()', t);
  end loop;
end $$;

-- ── 3. Split `for all` into insert / update / delete ────────────────────────
-- ⚠️ THE POINT OF THE WHOLE MIGRATION IS THE DELETE POLICY: its role list has
-- 'vendor' in the excluded set, with NO own-row escape hatch. Do not "simplify"
-- these three back into one `for all` — that silently restores the exposure.
do $$
declare t text;
begin
  foreach t in array array['vendor_products','vendor_certifications',
                           'vendor_personnel','vendor_documents']
  loop
    if to_regclass('public.' || t) is null then continue; end if;

    execute format('drop policy if exists "%1$s_write" on public.%1$s', t);

    execute format($f$
      create policy "%1$s_insert" on public.%1$s
        for insert to authenticated
        with check (
          internal.get_my_status() = 'approved'
          and (
            internal.get_my_role() not in ('viewer','viewer_budget','vendor')
            or vendor_id = internal.get_my_vendor_id()
          )
        )
    $f$, t);

    execute format($f$
      create policy "%1$s_update" on public.%1$s
        for update to authenticated
        using (
          internal.get_my_status() = 'approved'
          and (
            internal.get_my_role() not in ('viewer','viewer_budget','vendor')
            or vendor_id = internal.get_my_vendor_id()
          )
        )
        with check (
          internal.get_my_status() = 'approved'
          and (
            internal.get_my_role() not in ('viewer','viewer_budget','vendor')
            or vendor_id = internal.get_my_vendor_id()
          )
        )
    $f$, t);

    -- STAFF ONLY. No `or vendor_id = internal.get_my_vendor_id()` clause here.
    execute format($f$
      create policy "%1$s_delete" on public.%1$s
        for delete to authenticated
        using (
          internal.get_my_status() = 'approved'
          and internal.get_my_role() not in ('viewer','viewer_budget','vendor')
        )
    $f$, t);
  end loop;
end $$;

-- ── 4. Storage: a vendor may no longer delete its own uploaded files ────────
-- Archiving a certification/document must RETAIN the file, or "restore" would
-- hand back a row pointing at a file that no longer exists. Uploads are
-- unaffected: every path is unique (<vendor_id>/<cert_id>_<name> and
-- <vendor_id>/doc_<type>_<ts>_<name>), so nothing needs an overwrite.
drop policy if exists "vendor_certs_storage_delete" on storage.objects;
create policy "vendor_certs_storage_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'vendor-certs'
    and internal.get_my_role() not in ('viewer','viewer_budget','vendor')
  );

-- ── 5. Verification — EVERY column must read true ───────────────────────────
select
  (select count(*) = 4 from information_schema.columns
     where table_schema='public' and column_name='archived_at'
       and table_name in ('vendor_products','vendor_certifications',
                          'vendor_personnel','vendor_documents'))        as archived_at_on_all_4,
  (select count(*) = 4 from pg_policies
     where schemaname='public' and cmd='DELETE'
       and tablename in ('vendor_products','vendor_certifications',
                         'vendor_personnel','vendor_documents'))         as delete_policy_on_all_4,
  (select count(*) = 0 from pg_policies
     where schemaname='public' and cmd='DELETE'
       and tablename in ('vendor_products','vendor_certifications',
                         'vendor_personnel','vendor_documents')
       and qual like '%get_my_vendor_id%')                               as no_vendor_delete_escape,
  (select count(*) = 0 from pg_policies
     where schemaname='public' and policyname like '%\_write' escape '\'
       and tablename in ('vendor_products','vendor_certifications',
                         'vendor_personnel','vendor_documents'))         as old_for_all_policy_gone,
  (select count(*) = 4 from pg_trigger
     where tgname = 'trg_stamp_archived' and not tgisinternal)           as archive_trigger_on_all_4,
  (select qual not like '%get_my_vendor_id%' from pg_policies
     where schemaname='public' and tablename='objects'
       and policyname='vendor_certs_storage_delete')                     as no_vendor_storage_delete;
