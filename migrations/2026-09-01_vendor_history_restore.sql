-- ============================================================================
-- Vendor change history + point-in-time restore
-- Megawide WPM Dashboard
-- ----------------------------------------------------------------------------
-- Run ONCE in the Supabase SQL Editor (production). Idempotent — safe to re-run.
-- No temp tables and no cross-statement state.
--
-- ⚠️ RUN AFTER the soft-delete, audit-trail and doc-lock migrations.
--
-- WHY
-- ---
-- The audit trail records WHO changed a row and WHEN, but not WHAT it used to
-- say — so after a bad edit (or a run of them) there was no way back. Soft
-- delete covers removal; this covers overwriting, which is the one destructive
-- thing a vendor login can still legitimately do to its own data.
--
-- Every INSERT / UPDATE / DELETE on the five vendor tables now writes a full
-- before-and-after snapshot, and any row — or a whole vendor — can be put back
-- the way it was at a chosen moment.
--
-- ⚠️⚠️ THE RLS ON THIS TABLE IS THE WHOLE SECURITY STORY. A history row holds a
-- COMPLETE snapshot of a `vendors` row, INCLUDING `notes` and
-- `accreditation_notes` — the staff-only columns that
-- 2026-08-20_vendor_self_view.sql exists to keep out of a vendor's reach. If a
-- vendor could read this table, that entire lockdown would be undone through
-- the back door. Hence: **staff write-roles only, and no vendor or viewer
-- access at all.** Do not add a "vendors can see their own history" policy
-- without first stripping those columns from the snapshot.
-- ============================================================================

-- ── 1. The log ──────────────────────────────────────────────────────────────
create table if not exists public.vendor_history (
  id             bigserial primary key,
  table_name     text not null,
  row_id         uuid not null,
  vendor_id      uuid,          -- denormalised so a whole vendor can be replayed
  op             text not null, -- INSERT | UPDATE | DELETE
  old_data       jsonb,         -- null on INSERT
  new_data       jsonb,         -- null on DELETE
  changed_at     timestamptz not null default now(),
  changed_by     uuid,
  changed_by_name text
);

create index if not exists vendor_history_vendor_idx on public.vendor_history (vendor_id, changed_at desc);
create index if not exists vendor_history_row_idx    on public.vendor_history (table_name, row_id, changed_at desc);

alter table public.vendor_history enable row level security;

-- Read-only, staff write-roles only. There is deliberately NO insert/update/
-- delete policy: the log is written by trigger (which runs as the table owner)
-- and must not be editable by anyone through the API — a tamperable audit log
-- is worse than none, because it looks authoritative.
drop policy if exists "vendor_history_select" on public.vendor_history;
create policy "vendor_history_select" on public.vendor_history
  for select to authenticated
  using (internal.get_my_role() in ('super_admin','admin','specialist','manager','user'));

-- ── 2. Capture ──────────────────────────────────────────────────────────────
create or replace function internal.log_vendor_history()
returns trigger language plpgsql security definer
set search_path = public as $$
declare actor uuid; actor_name text; vid uuid; rid uuid;
begin
  actor := auth.uid();
  if actor is not null then
    select coalesce(u.name, u.email) into actor_name from public.users u where u.id = actor;
  end if;

  -- `vendors` is its own vendor; every child table carries vendor_id.
  if TG_TABLE_NAME = 'vendors' then
    rid := coalesce(new.id, old.id);
    vid := rid;
  else
    rid := coalesce(new.id, old.id);
    vid := coalesce(new.vendor_id, old.vendor_id);
  end if;

  insert into public.vendor_history (
    table_name, row_id, vendor_id, op, old_data, new_data, changed_by, changed_by_name)
  values (
    TG_TABLE_NAME, rid, vid, TG_OP,
    case when TG_OP = 'INSERT' then null else to_jsonb(old) end,
    case when TG_OP = 'DELETE' then null else to_jsonb(new) end,
    actor, actor_name);

  return null;   -- AFTER trigger; return value is ignored
end $$;

comment on function internal.log_vendor_history() is
  'INTENTIONAL SECURITY DEFINER. Writes public.vendor_history, which has no '
  'INSERT policy by design so the log cannot be forged or edited through the '
  'API. Also resolves the actor''s name from public.users, which a vendor login '
  'cannot read for anyone but itself.';

do $$
declare t text;
begin
  foreach t in array array['vendors','vendor_products','vendor_certifications',
                           'vendor_personnel','vendor_documents']
  loop
    if to_regclass('public.' || t) is null then
      raise notice 'SKIP %: table does not exist', t;
      continue;
    end if;
    execute format('drop trigger if exists trg_log_vendor_history on public.%I', t);
    execute format('create trigger trg_log_vendor_history after insert or update or delete '
                   'on public.%I for each row execute function internal.log_vendor_history()', t);
  end loop;
end $$;

-- ── 3. Writing a snapshot back ──────────────────────────────────────────────
-- Builds the column list at run time and uses the multi-column UPDATE SET form,
-- so a table gaining a column later needs no change here. Excludes `id` and any
-- generated/identity column.
--
-- ⚠️ It UPDATES rather than delete-and-reinsert: deleting a `vendors` row
-- cascades to every product, certification, personnel record, document, bid and
-- rate it owns. A "restore" that destroys the children would be catastrophic.
create or replace function internal.apply_snapshot(p_table text, p_id uuid, p_data jsonb)
returns void language plpgsql security definer
set search_path = public as $$
declare cols text; exists_now boolean;
begin
  if p_data is null then return; end if;
  if p_table not in ('vendors','vendor_products','vendor_certifications',
                     'vendor_personnel','vendor_documents') then
    raise exception 'Refusing to restore an unknown table: %', p_table using errcode = '42501';
  end if;

  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = p_table
     and column_name <> 'id'
     and is_generated = 'NEVER' and is_identity = 'NO';

  execute format('select exists(select 1 from public.%I where id = $1)', p_table)
     into exists_now using p_id;

  if exists_now then
    execute format(
      'update public.%I set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1)) where id = $2',
      p_table, cols, cols, p_table) using p_data, p_id;
  else
    -- The row was deleted since; put it back whole, id included.
    execute format('insert into public.%I select * from jsonb_populate_record(null::public.%I, $1)',
                   p_table, p_table) using p_data;
  end if;
end $$;

-- ── 4. Restore ONE row to the state captured in one history entry ───────────
create or replace function public.restore_vendor_row(p_history_id bigint)
returns void language plpgsql security definer
set search_path = public as $$
declare h public.vendor_history%rowtype; caller text;
begin
  select u.role into caller from public.users u where u.id = auth.uid();
  if caller is null or caller not in ('super_admin','admin','specialist','manager','user') then
    raise exception 'Not authorised to restore vendor data.' using errcode = '42501';
  end if;

  select * into h from public.vendor_history where id = p_history_id;
  if h.id is null then raise exception 'History entry not found.' using errcode = 'P0002'; end if;

  if h.old_data is null then
    -- An INSERT entry has no "before". Undoing it would mean deleting the row,
    -- which is not a restore — say so rather than quietly destroying data.
    raise exception 'That entry is the row being created, so there is no earlier state to go back to.'
      using errcode = '22023', hint = 'Archive the row instead if it should not exist.';
  end if;

  perform internal.apply_snapshot(h.table_name, h.row_id, h.old_data);
end $$;

revoke all on function public.restore_vendor_row(bigint) from public, anon;
grant execute on function public.restore_vendor_row(bigint) to authenticated;

-- ── 5. Point-in-time: what WOULD change ─────────────────────────────────────
-- ⚠️ ALWAYS OFFER THE PREVIEW BEFORE THE APPLY. A blind bulk revert on a
-- directory this size is exactly the kind of irreversible action this whole
-- body of work exists to prevent.
--
-- State of a row at T =
--   the new_data of the newest entry at or before T, else
--   the old_data of the oldest entry after T (its state before the first later change).
-- NULL from both means the row did not exist at T.
create or replace function public.preview_vendor_restore(p_vendor uuid, p_when timestamptz)
returns table (table_name text, row_id uuid, action text, label text)
language sql security definer
set search_path = public as $$
  with rows_touched as (
    select distinct h.table_name, h.row_id
      from public.vendor_history h
     where h.vendor_id = p_vendor and h.changed_at > p_when
  ),
  state_at as (
    select r.table_name, r.row_id,
      coalesce(
        (select h.new_data from public.vendor_history h
          where h.table_name = r.table_name and h.row_id = r.row_id and h.changed_at <= p_when
          order by h.changed_at desc, h.id desc limit 1),
        (select h.old_data from public.vendor_history h
          where h.table_name = r.table_name and h.row_id = r.row_id and h.changed_at > p_when
          order by h.changed_at asc, h.id asc limit 1)
      ) as snap
    from rows_touched r
  )
  select s.table_name, s.row_id,
    case when s.snap is null then 'archive' else 'restore' end as action,
    coalesce(
      s.snap ->> 'name', s.snap ->> 'description', s.snap ->> 'cert_name',
      s.snap ->> 'doc_type', s.snap ->> 'file_name', s.row_id::text
    ) as label
  from state_at s;
$$;

revoke all on function public.preview_vendor_restore(uuid,timestamptz) from public, anon;
grant execute on function public.preview_vendor_restore(uuid,timestamptz) to authenticated;

-- ── 6. Point-in-time: apply ─────────────────────────────────────────────────
-- ⚠️ ADMIN ONLY, unlike the single-row restore. This can rewrite every row a
-- vendor owns in one statement — the same blast radius as merge_vendors and
-- delete_vendor_cascade, which are admin-gated for the same reason.
--
-- ⚠️ A row that did not exist at T is ARCHIVED, never deleted. Deleting would
-- discard data this migration exists to protect, and archiving is reversible.
-- `vendors` itself is never archived — it has no archived_at and removing a
-- company because of a timestamp choice would be absurd.
create or replace function public.restore_vendor_to(p_vendor uuid, p_when timestamptz)
returns integer language plpgsql security definer
set search_path = public as $$
declare r record; caller text; n integer := 0;
begin
  select u.role into caller from public.users u where u.id = auth.uid();
  if caller is null or caller not in ('super_admin','admin') then
    raise exception 'Only an administrator can roll a vendor back to an earlier state.'
      using errcode = '42501';
  end if;
  if p_when is null then raise exception 'Pick a point in time.' using errcode = '22023'; end if;

  for r in select * from public.preview_vendor_restore(p_vendor, p_when) loop
    if r.action = 'restore' then
      perform internal.apply_snapshot(
        r.table_name, r.row_id,
        (select coalesce(
           (select h.new_data from public.vendor_history h
             where h.table_name = r.table_name and h.row_id = r.row_id and h.changed_at <= p_when
             order by h.changed_at desc, h.id desc limit 1),
           (select h.old_data from public.vendor_history h
             where h.table_name = r.table_name and h.row_id = r.row_id and h.changed_at > p_when
             order by h.changed_at asc, h.id asc limit 1))));
      n := n + 1;
    elsif r.action = 'archive' and r.table_name <> 'vendors' then
      execute format('update public.%I set archived_at = now() where id = $1 and archived_at is null',
                     r.table_name) using r.row_id;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

revoke all on function public.restore_vendor_to(uuid,timestamptz) from public, anon;
grant execute on function public.restore_vendor_to(uuid,timestamptz) to authenticated;

comment on function public.restore_vendor_to(uuid,timestamptz) is
  'INTENTIONAL SECURITY DEFINER, ADMIN ONLY. Rolls one vendor and all of its '
  'child rows back to their state at a chosen moment. Rows that did not exist '
  'then are archived, never deleted. Restricted to super_admin/admin because '
  'its blast radius matches merge_vendors and delete_vendor_cascade.';

-- ── 7. Verification — EVERY column must read true ───────────────────────────
select
  (select count(*) = 1 from information_schema.tables
     where table_schema='public' and table_name='vendor_history')                  as history_table,
  (select relrowsecurity from pg_class where oid='public.vendor_history'::regclass) as rls_enabled,
  (select count(*) = 0 from pg_policies
     where schemaname='public' and tablename='vendor_history' and cmd <> 'SELECT') as log_is_append_only,
  (select count(*) = 0 from pg_policies
     where schemaname='public' and tablename='vendor_history'
       and (qual like '%vendor%' and qual not like '%get_my_role%'))               as no_vendor_read_path,
  (select count(*) = 5 from pg_trigger
     where tgname='trg_log_vendor_history' and not tgisinternal)                   as trigger_on_all_5,
  (select bool_and(prosecdef) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where p.proname in ('log_vendor_history','apply_snapshot','restore_vendor_row',
                         'preview_vendor_restore','restore_vendor_to'))            as all_security_definer;
