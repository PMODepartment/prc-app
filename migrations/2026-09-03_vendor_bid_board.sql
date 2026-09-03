-- ============================================================================
-- Vendor Bid Board — Megawide WPM Dashboard
-- ----------------------------------------------------------------------------
-- Run once in the Supabase SQL Editor (production). Idempotent — safe to re-run.
-- Run AFTER 2026-08-10_vendor_phase2b.sql (vendor_bids) and after the three
-- 2026-09-01 hardening migrations.
--
-- WHAT THIS IS
--   A vendor can now be INVITED to quote a specific work package, and can send
--   their offer back through the portal instead of by email. Staff see the
--   submissions side by side and record the outcome.
--
-- ⚠️⚠️ THE ONE DECISION EVERYTHING ELSE FOLLOWS: INVITATION-ONLY, NOT AN OPEN
--   BOARD. A vendor sees ONLY the work packages a buyer has invited them to.
--   An open board would publish the entire procurement pipeline — what Megawide
--   is buying, when, in what quantity — to every registered vendor, and the
--   directory holds ~2,400 companies imported from work-package history and the
--   SAP masterlist, most never vetted for this and some of which are each
--   other's direct competitors. It also maps badly onto how buyers actually
--   work: they nominate proposed_vendors on the work package.
--   **Do not "open it up" by relaxing the RLS below** — the whole design rests
--   on a vendor only ever reaching rows addressed to them.
--
-- ⚠️ WHY A NEW TABLE INSTEAD OF LETTING VENDORS INTO vendor_bids
--   vendor_bids is the INTERNAL negotiation ledger. It holds original_offer and
--   negotiated_offer (our own negotiation position), staff notes, and one row
--   per COMPETING vendor on the same work package. Row-scoping it by vendor_id
--   would hide the other vendors' rows, but RLS filters ROWS, NEVER COLUMNS, so
--   the internal columns on the vendor's OWN row would still be readable at the
--   REST API — the same trap that needed vendor_self_view.
--
--   So the two are kept apart, exactly like planners_need_by vs
--   work_packages.target_installation: **THE VENDOR PROPOSES; THE BUYER
--   RECORDS.** A submission lands in vendor_bid_invitations, and a buyer
--   promotes it into vendor_bids when they choose to. Nothing a vendor types
--   ever silently becomes the internal figure of record.
--
-- No temp tables and no state carried between statements — the Supabase SQL
-- Editor does not run a script as one transaction.
-- ============================================================================


-- ══ 1. the invitation + the vendor's submission ═════════════════════════════
create table if not exists vendor_bid_invitations (
  id                uuid primary key default gen_random_uuid(),
  wp_id             uuid not null references work_packages(id) on delete cascade,
  vendor_id         uuid not null references vendors(id) on delete cascade,
  project_id        text references projects(id),

  -- ── staff-owned: the ask ──────────────────────────────────────────────────
  status            text not null default 'invited'
                      check (status in ('invited','viewed','submitted','declined',
                                        'withdrawn','closed')),
  scope_note        text,          -- what the buyer wants quoted, in words
  due_at            timestamptz,   -- after this the vendor can no longer submit
  invited_at        timestamptz default now(),
  invited_by        uuid references users(id),
  invited_by_name   text,

  -- ── vendor-owned: the answer ──────────────────────────────────────────────
  offer_amount      numeric(18,2),
  offer_currency    text default 'PHP',
  lead_time_days    integer,
  validity_days     integer,       -- how long the vendor holds the price
  payment_terms     text,
  vendor_notes      text,
  attachment_path   text,          -- their quotation, in the vendor-certs bucket
  attachment_name   text,
  submitted_at      timestamptz,
  declined_reason   text,

  -- ── staff-owned: the outcome ──────────────────────────────────────────────
  outcome           text check (outcome in ('awarded','not_awarded')),
  outcome_note      text,
  decided_at        timestamptz,
  decided_by        uuid references users(id),

  created_at        timestamptz default now(),
  updated_at        timestamptz default now(),
  updated_by        uuid references users(id),
  updated_by_name   text,

  -- One invitation per vendor per work package. A re-invite updates in place,
  -- so a buyer cannot accidentally issue two and read two different answers.
  constraint vendor_bid_invitations_wp_vendor_unique unique (wp_id, vendor_id)
);

create index if not exists idx_vbi_vendor  on vendor_bid_invitations(vendor_id);
create index if not exists idx_vbi_wp      on vendor_bid_invitations(wp_id);
create index if not exists idx_vbi_project on vendor_bid_invitations(project_id);
create index if not exists idx_vbi_status  on vendor_bid_invitations(status);

comment on table vendor_bid_invitations is
  'A buyer''s invitation to one vendor to quote one work package, plus that '
  'vendor''s submission. INVITATION-ONLY by design: a vendor reaches only rows '
  'addressed to them (see the RLS). Deliberately NOT vendor_bids — that is the '
  'internal negotiation ledger holding our own negotiation position and the '
  'competing vendors'' rows. The vendor proposes here; a buyer promotes the '
  'figure into vendor_bids when they choose to.';


drop trigger if exists trg_vbi_updated on vendor_bid_invitations;
create trigger trg_vbi_updated before update on vendor_bid_invitations
  for each row execute function update_updated_at();


-- ══ 2. RLS ══════════════════════════════════════════════════════════════════
alter table vendor_bid_invitations enable row level security;

-- Staff read: same audience as vendor_bids (viewer_budget may read cost; plain
-- viewer may not, because an offer is cost data).
drop policy if exists "vbi_select_staff" on vendor_bid_invitations;
create policy "vbi_select_staff" on vendor_bid_invitations
  for select to authenticated
  using (
    internal.get_my_status() = 'approved'
    and internal.get_my_role() in ('super_admin','admin','specialist','manager','user','viewer_budget')
  );

-- ⚠️ The vendor's own rows, and ONLY their own rows. This single clause is what
--    makes the board invitation-only. Never widen it.
drop policy if exists "vbi_select_vendor" on vendor_bid_invitations;
create policy "vbi_select_vendor" on vendor_bid_invitations
  for select to authenticated
  using (
    internal.get_my_role() = 'vendor'
    and vendor_id = internal.get_my_vendor_id()
  );

-- ⚠️ ONLY STAFF MAY CREATE OR DELETE AN INVITATION. A vendor inviting itself to
--    quote a work package would be helping itself to the pipeline, which is the
--    exact thing the invitation-only decision exists to prevent. Split into
--    insert/update/delete rather than `for all` — `for all` INCLUDES DELETE,
--    which is how the child tables ended up letting vendors hard-delete their
--    own evidence (see 2026-09-01_vendor_child_soft_delete.sql).
drop policy if exists "vbi_write" on vendor_bid_invitations;
drop policy if exists "vbi_insert" on vendor_bid_invitations;
create policy "vbi_insert" on vendor_bid_invitations
  for insert to authenticated
  with check (
    internal.get_my_status() = 'approved'
    and internal.get_my_role() in ('super_admin','admin','specialist','manager','user')
  );

drop policy if exists "vbi_delete" on vendor_bid_invitations;
create policy "vbi_delete" on vendor_bid_invitations
  for delete to authenticated
  using (
    internal.get_my_status() = 'approved'
    and internal.get_my_role() in ('super_admin','admin','specialist','manager','user')
  );

-- Update: staff freely; a vendor only on their own row. WHICH COLUMNS a vendor
-- may move, and WHEN, is enforced by the trigger below — RLS cannot express it.
drop policy if exists "vbi_update" on vendor_bid_invitations;
create policy "vbi_update" on vendor_bid_invitations
  for update to authenticated
  using (
    (internal.get_my_status() = 'approved'
      and internal.get_my_role() in ('super_admin','admin','specialist','manager','user'))
    or (internal.get_my_role() = 'vendor' and vendor_id = internal.get_my_vendor_id())
  )
  with check (
    (internal.get_my_status() = 'approved'
      and internal.get_my_role() in ('super_admin','admin','specialist','manager','user'))
    or (internal.get_my_role() = 'vendor' and vendor_id = internal.get_my_vendor_id())
  );


-- ══ 3. the submission guard ═════════════════════════════════════════════════
-- ⚠️ RLS DECIDES WHICH ROWS A CALLER MAY TOUCH AND CANNOT RESTRICT WHICH
--    COLUMNS AN UPDATE WRITES. A vendor legitimately holds UPDATE on their own
--    invitation, so without this trigger they could PATCH the due date, the
--    scope, or the outcome straight at the REST API, whatever the portal
--    renders. The trigger is the enforcement; the portal's disabled inputs are
--    presentation. Same reasoning as internal.vendor_edit_guard.
create or replace function internal.vendor_bid_guard()
returns trigger
language plpgsql
security definer
set search_path = public, internal
as $fn$
declare
  caller_role text;
  is_closed   boolean;
begin
  select role into caller_role from public.users where id = auth.uid();

  -- Staff, the service role, and the SQL editor (auth.uid() is NULL there, so
  -- no users row and a NULL role) all pass straight through.
  if caller_role is distinct from 'vendor' then
    return new;
  end if;

  -- ── everything the buyer owns is pinned ────────────────────────────────────
  new.wp_id            := old.wp_id;
  new.vendor_id        := old.vendor_id;
  new.project_id       := old.project_id;
  new.scope_note       := old.scope_note;
  new.due_at           := old.due_at;
  new.invited_at       := old.invited_at;
  new.invited_by       := old.invited_by;
  new.invited_by_name  := old.invited_by_name;
  new.outcome          := old.outcome;
  new.outcome_note     := old.outcome_note;
  new.decided_at       := old.decided_at;
  new.decided_by       := old.decided_by;
  new.created_at       := old.created_at;

  -- The stamp is set from auth.uid(), so it cannot be forged by the client.
  new.updated_by      := auth.uid();
  new.updated_by_name := (select name from public.users where id = auth.uid());

  -- ── the window ────────────────────────────────────────────────────────────
  -- Closed once a buyer closes or withdraws it, or once the deadline passes.
  -- A vendor may revise up to the deadline: a quotation is routinely corrected
  -- before it is opened, and forcing a buyer to re-issue the invitation over a
  -- typo would be worse for both sides.
  is_closed := old.status in ('closed','withdrawn')
               or (old.due_at is not null and old.due_at < now());
  if is_closed then
    raise exception 'This invitation is closed and can no longer be changed.'
      using errcode = '42501',
            hint = 'Ask your Megawide contact to re-open it if you need to revise your offer.';
  end if;

  -- ── the only transitions a vendor may make ────────────────────────────────
  if new.status not in ('viewed','submitted','declined') then
    raise exception 'A vendor may only mark an invitation viewed, submitted or declined.'
      using errcode = '42501';
  end if;

  if new.status = 'submitted' then
    if new.offer_amount is null or new.offer_amount < 0 then
      raise exception 'Enter your offer amount before submitting.'
        using errcode = '23514';
    end if;
    -- Server-stamped: a submission time the client can set is not evidence.
    if old.status = 'submitted' then
      new.submitted_at := old.submitted_at;
    else
      new.submitted_at := now();
    end if;
  else
    new.submitted_at := old.submitted_at;
  end if;

  return new;
end;
$fn$;

comment on function internal.vendor_bid_guard() is
  'BEFORE UPDATE on vendor_bid_invitations. Pins every buyer-owned column when '
  'the caller''s role is vendor, stamps updated_by from auth.uid(), refuses a '
  'change after the deadline or once closed, and allows only the '
  'viewed/submitted/declined transitions. Necessary because RLS filters rows, '
  'never columns, and a vendor holds UPDATE on its own invitation. When you add '
  'a buyer-owned column to that table, PIN IT HERE.';

drop trigger if exists trg_vendor_bid_guard on vendor_bid_invitations;
create trigger trg_vendor_bid_guard before update on vendor_bid_invitations
  for each row execute function internal.vendor_bid_guard();


-- ══ 4. what a vendor may SEE of the work package ════════════════════════════
-- ⚠️⚠️ THE COLUMN LIST IS THE ACCESS CONTROL, and the omissions are the point.
--    NEVER ADD:
--      approved_budget_bcb / budget_bcb0..2  — our own budget IS the ceiling we
--        are willing to pay. Handing it to the vendor being asked to quote
--        against it destroys the negotiation outright.
--      awarded_cost / total_awarded / additionals / variance / buyback_*
--        — what we paid, here or previously.
--      contractor / awarded_vendor_ids / awarded_vendor_amounts /
--        proposed_vendors / proposed_vendor_ids
--        — WHO ELSE is quoting, and what they were paid. Competitor identities.
--      remarks / dp_* / retention_* / approver* / review_status / updated_by*
--        — internal commentary, internal commercial terms, internal workflow.
--
--    A vendor gets what a request for quotation would have told them anyway:
--    what the item is, when it is needed, and which bonds and submittals the
--    package requires.
--
--    SUPABASE ADVISORY: this will be flagged "security_definer_view" — the same
--    accepted exception as wp_view_public and vendor_self_view. It MUST be
--    definer-style: every logged-in user shares the one `authenticated` role,
--    so per-role COLUMN hiding needs a separate relation. Do not "fix" the
--    advisory by flipping to security_invoker — that re-exposes the budget.
drop view if exists public.vendor_bid_board_view;
create view public.vendor_bid_board_view
with (security_barrier = true) as
select
  i.id                as invitation_id,
  i.status,
  i.scope_note,
  i.due_at,
  i.invited_at,
  i.offer_amount,
  i.offer_currency,
  i.lead_time_days,
  i.validity_days,
  i.payment_terms,
  i.vendor_notes,
  i.attachment_path,
  i.attachment_name,
  i.submitted_at,
  i.declined_reason,
  i.vendor_id,
  -- The outcome IS the vendor's business — they are told whether they won.
  -- outcome_note is staff's private reasoning and stays out.
  i.outcome,
  i.decided_at,
  -- ── the cost-free work package ──────────────────────────────────────────
  w.id                as wp_id,
  w.wp_no,
  w.description,
  w.detailed_description,
  w.scope,
  w.trade,
  w.works,
  w.type_of_works,
  w.type_of_service,
  w.target_delivery,
  w.target_completion,
  w.target_installation,
  w.surety_bond,
  w.performance_bond,
  w.warranty_bond,
  w.requires_approval,
  w.submittal_document_type,
  -- Project NAME and location only. Never its budget.
  p.id                as project_id,
  p.name              as project_name,
  p.location          as project_location
from public.vendor_bid_invitations i
join public.work_packages w on w.id = i.wp_id
left join public.projects p on p.id = i.project_id
where internal.get_my_role() = 'vendor'
  and i.vendor_id = internal.get_my_vendor_id();

grant select on public.vendor_bid_board_view to authenticated;

comment on view public.vendor_bid_board_view is
  'A vendor login''s read surface on the work packages it has been invited to '
  'quote. INTENTIONAL SECURITY DEFINER (accepted exception, same as '
  'wp_view_public and vendor_self_view): RLS filters rows, never columns, so '
  'hiding the budget and the competing vendors from a vendor requires a '
  'separate definer relation. OMITS every cost column and every other-vendor '
  'column — see the header comment before adding anything.';


-- ══ 5. verification — every column must read `true` ═════════════════════════
select
  (select count(*) = 1 from information_schema.tables
    where table_schema='public' and table_name='vendor_bid_invitations')                as table_created,
  (select count(*) = 1 from pg_constraint
    where conname='vendor_bid_invitations_wp_vendor_unique')                            as one_invite_per_pair,
  (select count(*) = 1 from pg_trigger
    where tgname='trg_vendor_bid_guard' and not tgisinternal)                           as guard_installed,
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='internal' and p.proname='vendor_bid_guard')                        as guard_is_definer,
  (select count(*) = 1 from pg_policies where tablename='vendor_bid_invitations'
     and policyname='vbi_select_vendor' and qual like '%get_my_vendor_id%')             as vendor_sees_only_own,
  (select count(*) = 0 from pg_policies where tablename='vendor_bid_invitations'
     and policyname='vbi_insert' and coalesce(with_check,'') like '%get_my_vendor_id%') as no_vendor_self_invite,
  (select count(*) = 0 from pg_policies
     where tablename='vendor_bid_invitations' and cmd='ALL')                            as no_for_all_policy,
  (select count(*) = 1 from information_schema.views
    where table_schema='public' and table_name='vendor_bid_board_view')                 as view_created,
  (select count(*) = 0 from information_schema.columns
    where table_schema='public' and table_name='vendor_bid_board_view'
      and (column_name like '%budget%' or column_name like '%bcb%'
           or column_name like '%contractor%' or column_name like '%proposed%'
           or column_name in ('remarks','outcome_note','total_awarded','variance',
                              'awarded_cost','additionals')))                           as no_cost_or_competitor_columns,
  (select count(*) = 1 from information_schema.role_table_grants
    where table_schema='public' and table_name='vendor_bid_board_view'
      and grantee='authenticated' and privilege_type='SELECT')                          as view_granted;
