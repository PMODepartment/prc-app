-- ============================================================================
--  Stop a vendor READING the staff-only columns of their own row.
--
--  Run ONCE in the Supabase SQL Editor, AFTER migrations/2026-08-20_vendor_field_ownership.sql.
--  Idempotent. Requires migrations/2026-08-10_vendor_management.sql (internal.get_my_*) and
--  migrations/2026-08-20_vendor_accreditation_requests.sql (the profile columns).
--
--  THE PROBLEM
--    vendor_field_ownership stopped a vendor WRITING notes / accreditation_notes.
--    It could not stop them READING: vendors_select let a vendor select their own
--    row IN FULL, so `select * from vendors` at the REST API handed them staff's
--    internal remarks about them. RLS filters ROWS, never COLUMNS.
--
--  THE FIX — the same shape as wp_view_public for the `viewer` role
--    1. vendors_select stops applying to the vendor role at all.
--    2. A definer-style view re-derives "my own row" from the caller's JWT and
--       simply does not select the staff-only columns.
--
--    Omitted from the view, deliberately:
--      notes                — staff-internal remarks about the vendor
--      accreditation_notes  — Megawide's internal reasoning for the standing.
--                             The vendor still learns WHY a request was declined:
--                             that lives in vendor_accreditation_requests.
--                             decision_notes, which is written FOR them.
--      created_by/updated_by/updated_by_name — internal staff user ids and names
--
--    Kept: everything the portal needs, including `accreditation` itself — a
--    vendor should know whether they are accredited, just not read the private
--    assessment behind it.
--
--  WRITES GO THROUGH THE VIEW TOO — and they have to.
--    Removing the vendor's SELECT on `vendors` does not just stop reads: an
--    UPDATE with a WHERE clause has to FIND its row, and Postgres applies the
--    SELECT policies to the rows an UPDATE reads. Leaving writes pointed at the
--    base table silently matched ZERO rows — the vendor's Save would report
--    success and change nothing. (Caught by running it, not by reading it.)
--    So the view is auto-updatable and carries the vendor's writes as well:
--    it is a simple single-table select, the owner bypasses the base-table RLS,
--    and its WHERE pins the row to the caller's own vendor. WITH CHECK OPTION
--    stops an update moving a row out of that scope.
--    internal.vendor_edit_guard still fires on the base table underneath, so
--    the staff-owned columns stay pinned even though the view exposes some of
--    them (name, payment_terms, …) for READING.
--
--  SUPABASE ADVISORY: this view will be flagged "security_definer_view", the
--  same accepted exception as wp_view_public. It MUST be definer-style — the
--  whole point is to bypass the base-table RLS while re-deriving the caller's
--  own scope and omitting columns. security_invoker = on is impossible here:
--  every logged-in user shares the one `authenticated` Postgres role, and RLS
--  cannot hide columns, so per-role column hiding needs a separate relation.
--  Do not "fix" the advisory by flipping it — that re-exposes the notes.
-- ============================================================================

-- ── 1. the vendor's own read surface ────────────────────────────────────────
drop view if exists public.vendor_self_view;
create view public.vendor_self_view
with (security_barrier = true) as   -- stop a leaky outer predicate being pushed
                                    -- ahead of the scope conditions below
select
  v.id,
  v.name,
  v.status,
  v.invite_email,
  v.invite_claimed_at,
  v.trade_categories,
  v.accreditation,
  v.accreditation_date,
  v.vendor_code,
  v.tin,
  v.telephone,
  v.contact_number,
  v.contact_email,
  v.address,
  v.city,
  v.contact_person,
  v.contact_position,
  v.vendor_category,
  v.vendor_group,
  v.payment_terms,
  v.website,
  v.created_at,
  v.updated_at
from public.vendors v
where internal.get_my_status() = 'approved'
  and v.id = internal.get_my_vendor_id()
with cascaded check option;

grant select, update on public.vendor_self_view to authenticated;

comment on view public.vendor_self_view is
  'A vendor login''s own row WITHOUT the staff-only columns (notes, '
  'accreditation_notes, created_by/updated_by/updated_by_name). Definer-style on '
  'purpose — accepted security_definer_view exception, same as wp_view_public: '
  'it re-derives the caller''s own scope from their JWT and omits columns, which '
  'RLS cannot do. Add any new STAFF-ONLY vendors column by leaving it OUT here; '
  'add any new VENDOR-VISIBLE column by listing it.';

-- ── 2. the base table stops being readable by the vendor role ───────────────
drop policy if exists "vendors_select" on public.vendors;
create policy "vendors_select" on public.vendors
  for select to authenticated
  using (
    internal.get_my_status() = 'approved'
    and internal.get_my_role() <> 'vendor'
  );

-- vendors_insert / vendors_update / vendors_delete are deliberately untouched.
-- vendors_update no longer does anything for the vendor role (their writes come
-- through the view, which runs as its owner), but leaving the policy in place
-- costs nothing and keeps the table's rules readable.

-- ── 2b. the audit stamp for a vendor edit is set SERVER-SIDE ────────────────
-- updated_by / updated_by_name are not in the view — deliberately, they can
-- carry a Megawide officer's name. That means a vendor's client cannot send
-- them, so the guard stamps them instead, which also makes the stamp
-- unforgeable: a vendor edit is always attributed to that vendor.
create or replace function internal.vendor_edit_guard()
returns trigger language plpgsql security definer
set search_path = public as $$
declare caller_role text; caller_name text;
begin
  select role, coalesce(name, email) into caller_role, caller_name
    from public.users where id = auth.uid() limit 1;

  if caller_role = 'vendor' then
    new.status := 'pending_review';

    new.invite_email      := old.invite_email;
    new.invite_claimed_at := old.invite_claimed_at;

    new.accreditation       := old.accreditation;
    new.accreditation_notes := old.accreditation_notes;
    new.accreditation_date  := old.accreditation_date;

    new.vendor_code     := old.vendor_code;
    new.name            := old.name;
    new.payment_terms   := old.payment_terms;
    new.vendor_category := old.vendor_category;
    new.vendor_group    := old.vendor_group;
    new.notes           := old.notes;

    if old.tin is not null and btrim(old.tin) <> '' then
      new.tin := old.tin;
    end if;

    new.updated_at      := now();
    new.updated_by      := auth.uid();
    new.updated_by_name := caller_name;
  end if;

  return new;
end;
$$;

-- ── 3. sanity check ─────────────────────────────────────────────────────────
select
  (select count(*) from information_schema.views
    where table_schema='public' and table_name='vendor_self_view')                as view_exists,
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='vendor_self_view')                as visible_columns,
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='vendor_self_view'
      and column_name in ('notes','accreditation_notes','created_by',
                          'updated_by','updated_by_name'))                        as leaked_columns,
  (select count(*) from information_schema.role_table_grants
    where table_schema='public' and table_name='vendor_self_view'
      and grantee='authenticated' and privilege_type in ('SELECT','UPDATE'))      as vendor_grants;
-- Expect: 1 | 23 | 0 | 2
