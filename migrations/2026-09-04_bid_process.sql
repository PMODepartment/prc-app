-- ============================================================================
-- Bid process — Sourcing through Award (Megawide EPC Procurement BP 2.2 → 2.4)
-- ----------------------------------------------------------------------------
-- Run once in the Supabase SQL Editor. Idempotent — safe to re-run.
-- Run AFTER 2026-09-03_vendor_bid_board.sql.
--
-- WHAT THIS ADDS, AND WHY
--   2026-09-03 modelled ONE step: invite a vendor, take an offer, record an
--   outcome. The approved business process ("Project Procurement BP") is a
--   chain, and three of its facts do not fit that model at all:
--
--   (a) 2.2.3 — "Vendor to submit both Technical Bid and Commercial Bid on date
--       & time set forth by the Bids and Award Committee (BAC)." A bid is TWO
--       envelopes, not one amount with one attachment.
--   (b) 2.3.1 Clarification is a real stage with vendor round-trips (3-10 days),
--       between receipt and evaluation. There was nowhere to put it.
--   (c) 2.4.1 Negotiation runs with the TOP 1-3 bidders only and produces a
--       REVISED offer, so an invitation needs original → negotiated → final,
--       and a shortlist flag to say who is in that conversation.
--
--   It also adds the thing that makes the board worth using at all: a vendor
--   can answer from a link in the RFQ email WITHOUT creating a login. See §7.
--
-- ⚠️ THE INVITATION-ONLY RULE FROM 2026-09-03 IS UNCHANGED. Nothing here lets a
--    vendor reach a work package it was not invited to. The token in §7 is a
--    capability scoped to ONE invitation, not a login.
--
-- ⚠️⚠️ LETTERS ARE OUT OF SCOPE PERMANENTLY, NOT "NOT YET". Decided 2026-09-04:
--    the NOA and the Letter of Regret stay a separate process. They come from
--    Megawide's own templates, which vary per package the same way the cost
--    comparison does. The officer issues them and then tells the app.
--    So this records only THAT a notice went out and its reference (§3
--    notice_*), and models no letter content at all.
--    Do NOT generate letter prose here, and do NOT build a merge into those
--    templates "as a later step" — that was considered and declined.
--
-- No temp tables and no state carried between statements — the Supabase SQL
-- Editor does not run a script as one transaction.
-- ============================================================================


-- ══ 1. the solicitation itself ══════════════════════════════════════════════
-- ⚠️ WHY A ROUND AND NOT JUST COLUMNS ON THE WORK PACKAGE: a package can be
--    re-tendered (a failed bid, a scope revision, an unresponsive market). Each
--    solicitation is its own event with its own deadline, its own invitees and
--    its own outcome, and the previous one must stay readable as history.
create table if not exists vendor_bid_rounds (
  id                uuid primary key default gen_random_uuid(),
  wp_id             uuid not null references work_packages(id) on delete cascade,
  project_id        text references projects(id),
  round_no          integer not null default 1,

  -- 2.2.2 — RFQ for materials, RFP for labor/services, ITB for a formal tender.
  doc_type          text not null default 'RFQ'
                      check (doc_type in ('RFQ','RFP','ITB')),

  -- The stages ARE the business process. Kept in BP order so a UI can render a
  -- stepper straight from this list:
  --   draft         2.2.1 Preparation of Scope of Works / TOR
  --   issued        2.2.2 Issued, and 2.2.3 receiving proposals until bid_due_at
  --   clarification 2.3.1 Clarifying submitted proposals
  --   comparison    2.3.2 Summarization / Cost Comparison
  --   evaluation    2.3.3 Technical / Commercial / Financial evaluation
  --   negotiation   2.4.1 With the top 1-3 bidders
  --   awarded       2.4.2 NOA to the winner, regret to the rest
  stage             text not null default 'draft'
                      check (stage in ('draft','issued','clarification','comparison',
                                       'evaluation','negotiation','awarded','cancelled')),

  -- ⚠️ Two-envelope is the DEFAULT because 2.2.3 says so, but a simple
  --    materials RFQ is legitimately one quotation — the officer decides per
  --    round, and §7 enforces whatever this says.
  two_envelope      boolean not null default true,

  -- 2.2.1 TOR items: "Time of Bids, Submission of Bids, Contact Person,
  -- Protocols, Payment Terms, Conditions".
  scope_note        text,
  boq_note          text,
  bid_due_at        timestamptz,          -- the date & time set by the BAC
  prebid_at         timestamptz,          -- 2.2.2 "Prebid"
  payment_terms     text,
  contact_person    text,
  contact_email     text,
  conditions        text,

  issued_at         timestamptz,
  issued_by         uuid references users(id),
  issued_by_name    text,
  awarded_at        timestamptz,
  cancelled_reason  text,

  created_at        timestamptz default now(),
  created_by        uuid references users(id),
  updated_at        timestamptz default now(),
  updated_by        uuid references users(id),
  updated_by_name   text,

  constraint vendor_bid_rounds_wp_round_unique unique (wp_id, round_no)
);

create index if not exists idx_vbr_wp      on vendor_bid_rounds(wp_id);
create index if not exists idx_vbr_project on vendor_bid_rounds(project_id);
create index if not exists idx_vbr_stage   on vendor_bid_rounds(stage);

comment on table vendor_bid_rounds is
  'One solicitation of one work package, following Megawide EPC Procurement BP '
  '2.2-2.4. A package can be re-tendered, so each attempt is its own round with '
  'its own deadline, invitees and outcome, and earlier rounds stay as history.';

drop trigger if exists trg_vbr_updated on vendor_bid_rounds;
create trigger trg_vbr_updated before update on vendor_bid_rounds
  for each row execute function update_updated_at();


-- ══ 2. the invitation joins a round, and carries two envelopes ══════════════
alter table vendor_bid_invitations
  add column if not exists round_id uuid references vendor_bid_rounds(id) on delete cascade;

-- ⚠️ THE CAPABILITY TOKEN. Unguessable (uuid v4), scoped to exactly this
--    invitation, and useless once the round closes — see internal.bid_token_open.
--    It is NOT a login and grants nothing beyond this one work package.
alter table vendor_bid_invitations
  add column if not exists access_token uuid not null default gen_random_uuid();

-- 2.2.3 — the two envelopes. `offer_amount`/`offer_currency` (already present)
-- are the commercial figure; these are the documents behind each envelope.
alter table vendor_bid_invitations
  add column if not exists technical_path        text,
  add column if not exists technical_name        text,
  add column if not exists technical_submitted_at timestamptz,
  add column if not exists commercial_path       text,
  add column if not exists commercial_name       text;

-- 2.3.3 Evaluation
alter table vendor_bid_invitations
  add column if not exists technical_result text
        check (technical_result in ('pass','fail','conditional')),
  add column if not exists technical_score  numeric(5,2),
  add column if not exists evaluation_notes text,
  add column if not exists rank             integer;

-- 2.4.1 Negotiation — with the top 1-3 only, producing a revised offer.
alter table vendor_bid_invitations
  add column if not exists shortlisted        boolean default false,
  add column if not exists negotiated_amount  numeric(18,2),
  add column if not exists negotiation_notes  text,
  add column if not exists final_amount       numeric(18,2);

-- 2.4.2 Award — the FACT of a notice, never its wording (see the header).
alter table vendor_bid_invitations
  add column if not exists notice_issued_at timestamptz,
  add column if not exists notice_ref       text;

create index if not exists idx_vbi_round on vendor_bid_invitations(round_id);
create unique index if not exists idx_vbi_token on vendor_bid_invitations(access_token);


-- ══ 3. carry existing invitations into a round ══════════════════════════════
-- One round per work package that already has invitations, taking the earliest
-- deadline and scope note on it. No-op on a fresh database.
insert into vendor_bid_rounds (wp_id, project_id, round_no, stage, scope_note, bid_due_at, issued_at)
select i.wp_id,
       min(i.project_id),
       1,
       'issued',
       min(i.scope_note),
       min(i.due_at),
       min(i.invited_at)
from vendor_bid_invitations i
where i.round_id is null
group by i.wp_id
on conflict (wp_id, round_no) do nothing;

update vendor_bid_invitations i
   set round_id = r.id
  from vendor_bid_rounds r
 where i.round_id is null
   and r.wp_id = i.wp_id
   and r.round_no = 1;

-- The quotation column from 2026-09-03 IS the commercial envelope.
update vendor_bid_invitations
   set commercial_path = attachment_path,
       commercial_name = attachment_name
 where commercial_path is null
   and attachment_path is not null;

-- ⚠️ THE UNIQUENESS KEY MOVES FROM THE PACKAGE TO THE ROUND. Keying on
--    (wp_id, vendor_id) would forbid inviting the same vendor to a RE-TENDER of
--    the same package, which is exactly what a second round is for.
--    Safe by construction: every existing invitation just went into round 1, so
--    (round_id, vendor_id) is unique iff (wp_id, vendor_id) was.
alter table vendor_bid_invitations
  drop constraint if exists vendor_bid_invitations_wp_vendor_unique;
create unique index if not exists idx_vbi_round_vendor_unique
  on vendor_bid_invitations(round_id, vendor_id);


-- ══ 4. clarifications (2.3.1) ═══════════════════════════════════════════════
create table if not exists vendor_bid_clarifications (
  id              uuid primary key default gen_random_uuid(),
  invitation_id   uuid not null references vendor_bid_invitations(id) on delete cascade,
  round_id        uuid references vendor_bid_rounds(id) on delete cascade,
  -- Who is speaking. Set server-side for a vendor (see the guard) so it cannot
  -- be forged into looking like a Megawide message.
  author          text not null check (author in ('staff','vendor')),
  message         text not null,
  attachment_path text,
  attachment_name text,
  created_at      timestamptz default now(),
  created_by      uuid references users(id),
  created_by_name text
);
create index if not exists idx_vbc_invitation on vendor_bid_clarifications(invitation_id);
create index if not exists idx_vbc_round      on vendor_bid_clarifications(round_id);

comment on table vendor_bid_clarifications is
  'BP 2.3.1 Clarification — the thread between Procurement and one bidder about '
  'that bidder''s submitted proposal. Scoped per INVITATION, never per round: a '
  'clarification is between us and one vendor, and must never be visible to '
  'the others.';


-- ══ 5. RLS ══════════════════════════════════════════════════════════════════
alter table vendor_bid_rounds enable row level security;
alter table vendor_bid_clarifications enable row level security;

-- Rounds are staff-only in every direction. A vendor never reads the round
-- record — it names the other invitees' context, the BAC's internal dates and
-- the evaluation stage. What a vendor may see comes through the view in §8.
drop policy if exists "vbr_select_staff" on vendor_bid_rounds;
create policy "vbr_select_staff" on vendor_bid_rounds
  for select to authenticated
  using (internal.get_my_status() = 'approved'
         and internal.get_my_role() in ('super_admin','admin','specialist','manager','user','viewer_budget'));

-- ⚠️ Split per operation, never `for all` — `for all` INCLUDES DELETE, which is
--    how the vendor child tables ended up deletable (2026-09-01_vendor_child_soft_delete).
drop policy if exists "vbr_insert" on vendor_bid_rounds;
create policy "vbr_insert" on vendor_bid_rounds
  for insert to authenticated
  with check (internal.get_my_status() = 'approved'
              and internal.get_my_role() in ('super_admin','admin','specialist','manager','user'));

drop policy if exists "vbr_update" on vendor_bid_rounds;
create policy "vbr_update" on vendor_bid_rounds
  for update to authenticated
  using (internal.get_my_status() = 'approved'
         and internal.get_my_role() in ('super_admin','admin','specialist','manager','user'))
  with check (internal.get_my_status() = 'approved'
              and internal.get_my_role() in ('super_admin','admin','specialist','manager','user'));

drop policy if exists "vbr_delete" on vendor_bid_rounds;
create policy "vbr_delete" on vendor_bid_rounds
  for delete to authenticated
  using (internal.get_my_status() = 'approved'
         and internal.get_my_role() in ('super_admin','admin'));

-- Clarifications: staff see all; a vendor sees ONLY the thread on their own
-- invitation. The subquery is the row-scoping — never widen it to the round.
drop policy if exists "vbc_select" on vendor_bid_clarifications;
create policy "vbc_select" on vendor_bid_clarifications
  for select to authenticated
  using (
    (internal.get_my_status() = 'approved'
      and internal.get_my_role() in ('super_admin','admin','specialist','manager','user','viewer_budget'))
    or (internal.get_my_role() = 'vendor'
        and invitation_id in (select id from vendor_bid_invitations
                               where vendor_id = internal.get_my_vendor_id()))
  );

drop policy if exists "vbc_insert" on vendor_bid_clarifications;
create policy "vbc_insert" on vendor_bid_clarifications
  for insert to authenticated
  with check (
    (internal.get_my_status() = 'approved'
      and internal.get_my_role() in ('super_admin','admin','specialist','manager','user'))
    or (internal.get_my_role() = 'vendor'
        and invitation_id in (select id from vendor_bid_invitations
                               where vendor_id = internal.get_my_vendor_id()))
  );

-- ⚠️ NOBODY EDITS OR DELETES A CLARIFICATION. It is a record of what was said
--    between Megawide and a bidder during evaluation; an editable one is worth
--    less than none. There is deliberately no update or delete policy.


-- ══ 6. the clarification guard ══════════════════════════════════════════════
-- RLS decides WHICH ROWS a caller may insert and cannot constrain the VALUES,
-- so without this a vendor could post a clarification stamped author='staff'
-- and attributed to a Megawide name.
create or replace function internal.bid_clarification_guard()
returns trigger
language plpgsql
security definer
set search_path = public, internal
as $fn$
declare
  caller_role text;
begin
  select role into caller_role from public.users where id = auth.uid();

  if caller_role = 'vendor' then
    new.author          := 'vendor';
    new.created_by      := auth.uid();
    new.created_by_name := (select name from public.vendors
                             where id = internal.get_my_vendor_id());
  else
    new.author          := coalesce(new.author, 'staff');
    new.created_by      := coalesce(new.created_by, auth.uid());
    new.created_by_name := coalesce(new.created_by_name,
                                    (select name from public.users where id = auth.uid()));
  end if;

  -- Keep the round pointer honest whatever the client sent.
  new.round_id := (select round_id from public.vendor_bid_invitations where id = new.invitation_id);
  return new;
end;
$fn$;

drop trigger if exists trg_bid_clarification_guard on vendor_bid_clarifications;
create trigger trg_bid_clarification_guard before insert on vendor_bid_clarifications
  for each row execute function internal.bid_clarification_guard();


-- ══ 7. answering WITHOUT a login ════════════════════════════════════════════
-- ⚠️⚠️ THE POINT OF THIS SECTION. Requiring a portal account before a vendor can
--    price a package is the step that would keep everyone on email — the
--    officer would end up running the board AND the mailbox. The RFQ email
--    therefore carries a capability link, and these functions are the only way
--    an anonymous caller can touch anything.
--
--    THE RULES, and none of them may be relaxed:
--      · the token addresses exactly ONE invitation;
--      · it stops working the moment the round closes or the deadline passes;
--      · nothing it returns names another bidder, and nothing it returns is a
--        cost figure of Megawide's (no budget, no other offers);
--      · it can never move a staff-owned column.
create or replace function internal.bid_token_open(p_token uuid)
returns boolean
language sql
stable
security definer
set search_path = public, internal
as $fn$
  select exists (
    select 1
      from public.vendor_bid_invitations i
      left join public.vendor_bid_rounds r on r.id = i.round_id
     where i.access_token = p_token
       and i.status not in ('closed','withdrawn')
       and coalesce(r.stage, 'issued') not in ('awarded','cancelled')
       and coalesce(i.due_at, r.bid_due_at, now() + interval '100 years') >= now()
  );
$fn$;

comment on function internal.bid_token_open(uuid) is
  'True while the invitation behind this capability token can still be answered. '
  'Used by the anonymous bid RPCs and by the Storage upload policy.';

-- Read one invitation by token. Returns jsonb built field by field: an explicit
-- allow-list is the access control, exactly like vendor_bid_board_view.
create or replace function public.bid_by_token(p_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, internal
as $fn$
declare
  res jsonb;
begin
  select jsonb_build_object(
    'invitation_id', i.id,
    'status',        i.status,
    'vendor_name',   v.name,
    'open',          internal.bid_token_open(p_token),
    -- the ask
    'doc_type',      coalesce(r.doc_type, 'RFQ'),
    'two_envelope',  coalesce(r.two_envelope, false),
    'scope_note',    coalesce(i.scope_note, r.scope_note),
    'boq_note',      r.boq_note,
    'conditions',    r.conditions,
    'payment_terms_required', r.payment_terms,
    'contact_person', r.contact_person,
    'contact_email',  r.contact_email,
    'prebid_at',      r.prebid_at,
    'due_at',        coalesce(i.due_at, r.bid_due_at),
    -- the answer so far
    'offer_amount',    i.offer_amount,
    'offer_currency',  i.offer_currency,
    'lead_time_days',  i.lead_time_days,
    'validity_days',   i.validity_days,
    'payment_terms',   i.payment_terms,
    'vendor_notes',    i.vendor_notes,
    'technical_name',  i.technical_name,
    'commercial_name', i.commercial_name,
    'submitted_at',    i.submitted_at,
    'declined_reason', i.declined_reason,
    -- ⚠️ the work package, COST-FREE. Never add a budget, an awarded cost, or
    --    any column naming another vendor. Same list as vendor_bid_board_view.
    'wp_no',          w.wp_no,
    'description',    w.description,
    'detailed_description', w.detailed_description,
    'scope',          w.scope,
    'trade',          w.trade,
    'works',          w.works,
    'target_delivery',     w.target_delivery,
    'target_completion',   w.target_completion,
    'target_installation', w.target_installation,
    'surety_bond',       w.surety_bond,
    'performance_bond',  w.performance_bond,
    'warranty_bond',     w.warranty_bond,
    'requires_approval', w.requires_approval,
    'submittal_document_type', w.submittal_document_type,
    'project_name',     p.name,
    'project_location', p.location
  )
  into res
  from public.vendor_bid_invitations i
  join public.vendors v       on v.id = i.vendor_id
  join public.work_packages w on w.id = i.wp_id
  left join public.vendor_bid_rounds r on r.id = i.round_id
  left join public.projects p on p.id = i.project_id
  where i.access_token = p_token;

  -- A bad token and an expired one look the same from outside: no oracle.
  if res is null then
    raise exception 'This link is not valid.' using errcode = '42501';
  end if;
  return res;
end;
$fn$;

create or replace function public.submit_bid_by_token(
  p_token           uuid,
  p_offer_amount    numeric,
  p_offer_currency  text default 'PHP',
  p_lead_time_days  integer default null,
  p_validity_days   integer default null,
  p_payment_terms   text default null,
  p_vendor_notes    text default null,
  p_commercial_path text default null,
  p_commercial_name text default null,
  p_technical_path  text default null,
  p_technical_name  text default null
) returns uuid
language plpgsql
security definer
set search_path = public, internal
as $fn$
declare
  inv   public.vendor_bid_invitations%rowtype;
  rnd   public.vendor_bid_rounds%rowtype;
begin
  select * into inv from public.vendor_bid_invitations where access_token = p_token;
  if inv.id is null then
    raise exception 'This link is not valid.' using errcode = '42501';
  end if;
  if not internal.bid_token_open(p_token) then
    raise exception 'This invitation is closed and can no longer be answered.'
      using errcode = '42501',
            hint = 'Contact your Megawide Procurement contact if you need it re-opened.';
  end if;
  if p_offer_amount is null or p_offer_amount < 0 then
    raise exception 'Enter your offer amount before submitting.' using errcode = '23514';
  end if;

  select * into rnd from public.vendor_bid_rounds where id = inv.round_id;

  -- 2.2.3 — where the round is two-envelope, the technical bid is not optional.
  if coalesce(rnd.two_envelope, false)
     and coalesce(p_technical_path, inv.technical_path) is null then
    raise exception 'This package needs a Technical Bid as well as your price.'
      using errcode = '23514',
            hint = 'Attach the technical proposal, then submit again.';
  end if;

  update public.vendor_bid_invitations set
    status          = 'submitted',
    offer_amount    = p_offer_amount,
    offer_currency  = coalesce(p_offer_currency, 'PHP'),
    lead_time_days  = p_lead_time_days,
    validity_days   = p_validity_days,
    payment_terms   = p_payment_terms,
    vendor_notes    = p_vendor_notes,
    commercial_path = coalesce(p_commercial_path, commercial_path),
    commercial_name = coalesce(p_commercial_name, commercial_name),
    technical_path  = coalesce(p_technical_path, technical_path),
    technical_name  = coalesce(p_technical_name, technical_name),
    technical_submitted_at = case
      when p_technical_path is not null then now() else technical_submitted_at end,
    -- Server-stamped, and only on the FIRST submission: a revision does not
    -- reset the clock the BAC recorded.
    submitted_at    = coalesce(submitted_at, now()),
    declined_reason = null,
    updated_at      = now()
  where id = inv.id;

  return inv.id;
end;
$fn$;

create or replace function public.decline_bid_by_token(p_token uuid, p_reason text default null)
returns uuid
language plpgsql
security definer
set search_path = public, internal
as $fn$
declare
  inv_id uuid;
begin
  select id into inv_id from public.vendor_bid_invitations where access_token = p_token;
  if inv_id is null then
    raise exception 'This link is not valid.' using errcode = '42501';
  end if;
  if not internal.bid_token_open(p_token) then
    raise exception 'This invitation is closed.' using errcode = '42501';
  end if;
  update public.vendor_bid_invitations
     set status = 'declined', declined_reason = nullif(btrim(coalesce(p_reason,'')), ''),
         updated_at = now()
   where id = inv_id;
  return inv_id;
end;
$fn$;

-- Mark the invitation opened. Best-effort courtesy signal to the buyer.
create or replace function public.view_bid_by_token(p_token uuid)
returns void
language sql
security definer
set search_path = public, internal
as $fn$
  update public.vendor_bid_invitations
     set status = 'viewed'
   where access_token = p_token and status = 'invited';
$fn$;

-- 2.3.1 — a bidder answering a clarification from the same link.
create or replace function public.clarify_bid_by_token(p_token uuid, p_message text)
returns uuid
language plpgsql
security definer
set search_path = public, internal
as $fn$
declare
  inv public.vendor_bid_invitations%rowtype;
  new_id uuid;
begin
  select * into inv from public.vendor_bid_invitations where access_token = p_token;
  if inv.id is null then
    raise exception 'This link is not valid.' using errcode = '42501';
  end if;
  if btrim(coalesce(p_message,'')) = '' then
    raise exception 'Write your reply first.' using errcode = '23514';
  end if;
  -- ⚠️ Deliberately NOT gated on bid_token_open: clarification happens AFTER
  --    the bid deadline (BP 2.3.1 sits between receipt and evaluation), so the
  --    deadline check that stops late PRICING must not stop a reply. It is
  --    still closed once the round is awarded or cancelled.
  if exists (select 1 from public.vendor_bid_rounds
              where id = inv.round_id and stage in ('awarded','cancelled')) then
    raise exception 'This bid is closed.' using errcode = '42501';
  end if;

  insert into public.vendor_bid_clarifications
    (invitation_id, round_id, author, message, created_by_name)
  values
    (inv.id, inv.round_id, 'vendor', btrim(p_message),
     (select name from public.vendors where id = inv.vendor_id))
  returning id into new_id;
  return new_id;
end;
$fn$;

-- The clarification thread for one invitation, by token.
create or replace function public.bid_clarifications_by_token(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, internal
as $fn$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'author', c.author, 'message', c.message,
           'created_at', c.created_at,
           -- A staff author shows as the department, not an individual's name.
           'from', case when c.author = 'staff' then 'Megawide Procurement'
                        else coalesce(c.created_by_name, 'You') end
         ) order by c.created_at), '[]'::jsonb)
    from public.vendor_bid_clarifications c
    join public.vendor_bid_invitations i on i.id = c.invitation_id
   where i.access_token = p_token;
$fn$;

-- ⚠️ EXECUTE IS GRANTED EXPLICITLY, AND REVOKED FROM public FIRST. A function
--    in the public schema is executable by everyone by default; these are the
--    anonymous surface of the whole feature, so they are granted deliberately.
revoke all on function public.bid_by_token(uuid) from public;
revoke all on function public.submit_bid_by_token(uuid,numeric,text,integer,integer,text,text,text,text,text,text) from public;
revoke all on function public.decline_bid_by_token(uuid,text) from public;
revoke all on function public.view_bid_by_token(uuid) from public;
revoke all on function public.clarify_bid_by_token(uuid,text) from public;
revoke all on function public.bid_clarifications_by_token(uuid) from public;

grant execute on function public.bid_by_token(uuid) to anon, authenticated;
grant execute on function public.submit_bid_by_token(uuid,numeric,text,integer,integer,text,text,text,text,text,text) to anon, authenticated;
grant execute on function public.decline_bid_by_token(uuid,text) to anon, authenticated;
grant execute on function public.view_bid_by_token(uuid) to anon, authenticated;
grant execute on function public.clarify_bid_by_token(uuid,text) to anon, authenticated;
grant execute on function public.bid_clarifications_by_token(uuid) to anon, authenticated;


-- ══ 7b. where an anonymous bidder's files go ════════════════════════════════
-- A separate PRIVATE bucket, never vendor-certs: that one holds accreditation
-- evidence and its policies authorize on a vendor-id prefix, which an
-- anonymous caller has no way to prove.
insert into storage.buckets (id, name, public)
values ('bid-submissions', 'bid-submissions', false)
on conflict (id) do nothing;

-- ⚠️ THE PATH PREFIX IS THE AUTHORIZATION: an anonymous uploader may only write
--    inside a folder named for a token that is currently open. They cannot list
--    the bucket, cannot read anything back, and cannot touch another folder.
create or replace function internal.bid_token_folder_open(p_folder text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, internal
as $fn$
declare
  t uuid;
begin
  -- A non-uuid folder name must be a plain `false`, not an error: an invalid
  -- cast inside a policy would surface as a 500 rather than a refusal.
  begin
    t := p_folder::uuid;
  exception when others then
    return false;
  end;
  return internal.bid_token_open(t);
end;
$fn$;

drop policy if exists "bid_submissions_insert_anon" on storage.objects;
create policy "bid_submissions_insert_anon" on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'bid-submissions'
    and internal.bid_token_folder_open((storage.foldername(name))[1])
  );

-- Staff read every submission; nobody anonymous reads anything.
drop policy if exists "bid_submissions_select_staff" on storage.objects;
create policy "bid_submissions_select_staff" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'bid-submissions'
    and internal.get_my_status() = 'approved'
    and internal.get_my_role() in ('super_admin','admin','specialist','manager','user','viewer_budget')
  );

drop policy if exists "bid_submissions_delete_staff" on storage.objects;
create policy "bid_submissions_delete_staff" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'bid-submissions'
    and internal.get_my_status() = 'approved'
    and internal.get_my_role() in ('super_admin','admin')
  );


-- ══ 8. what a logged-in vendor sees ═════════════════════════════════════════
-- ⚠️ THE COLUMN LIST IS THE ACCESS CONTROL — see 2026-09-03 for the full list of
--    what must never appear here (budget, awarded cost, other vendors). This
--    recreates it only to add the new VENDOR-OWNED fields plus the round's ask.
--    Nothing about the evaluation, the shortlist, the ranking or another
--    bidder's number is exposed: those are ours.
drop view if exists public.vendor_bid_board_view;
create view public.vendor_bid_board_view
with (security_barrier = true) as
select
  i.id                as invitation_id,
  i.status,
  coalesce(i.scope_note, r.scope_note) as scope_note,
  coalesce(i.due_at, r.bid_due_at)     as due_at,
  i.invited_at,
  i.offer_amount,
  i.offer_currency,
  i.lead_time_days,
  i.validity_days,
  i.payment_terms,
  i.vendor_notes,
  i.attachment_path,
  i.attachment_name,
  i.technical_path,
  i.technical_name,
  i.commercial_path,
  i.commercial_name,
  i.submitted_at,
  i.declined_reason,
  i.vendor_id,
  -- ⚠️ access_token WAS SELECTED HERE AND WAS REMOVED 2026-09-05.
  --    It is a bearer capability that needs no login and keeps working after a
  --    password change, so a page that already holds a session must never be
  --    handed one. It was never a cross-vendor leak (the view is scoped to the
  --    caller's own vendor_id) and nothing read it from here — bids.html builds
  --    the RFQ link from the BASE TABLE as staff. Caught by the verification
  --    SELECT at the end of 2026-09-05_bid_reference_docs.sql; the live view is
  --    corrected by 2026-09-05_board_view_drop_token.sql. DO NOT PUT IT BACK.
  i.outcome,
  i.decided_at,
  i.notice_ref,
  -- the round's ask (staff-authored, meant for the bidder)
  coalesce(r.doc_type, 'RFQ')      as doc_type,
  coalesce(r.two_envelope, false)  as two_envelope,
  r.boq_note,
  r.conditions,
  r.contact_person,
  r.contact_email,
  r.prebid_at,
  r.stage,
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
  p.id                as project_id,
  p.name              as project_name,
  p.location          as project_location,
  -- Lifecycle flag only (active / archived). Not cost, not competitor data, and
  -- the portal needs it: an AWARDED package retires from the vendor's board once
  -- its project is archived, which is a truer "this is finished" signal than any
  -- fixed number of days.
  p.status            as project_status
from public.vendor_bid_invitations i
join public.work_packages w on w.id = i.wp_id
left join public.vendor_bid_rounds r on r.id = i.round_id
left join public.projects p on p.id = i.project_id
where internal.get_my_role() = 'vendor'
  and i.vendor_id = internal.get_my_vendor_id();

grant select on public.vendor_bid_board_view to authenticated;

comment on view public.vendor_bid_board_view is
  'A vendor login''s read surface on the packages it was invited to quote. '
  'INTENTIONAL SECURITY DEFINER (accepted exception, as wp_view_public and '
  'vendor_self_view): RLS filters rows, never columns. OMITS every cost column '
  'of ours and every column naming another bidder — including the evaluation, '
  'the shortlist and the ranking.';


-- ══ 9. verification — every column must read `true` ═════════════════════════
select
  (select count(*) = 1 from information_schema.tables
    where table_schema='public' and table_name='vendor_bid_rounds')                    as rounds_table,
  (select count(*) = 1 from information_schema.tables
    where table_schema='public' and table_name='vendor_bid_clarifications')            as clarifications_table,
  (select count(*) = 5 from information_schema.columns
    where table_schema='public' and table_name='vendor_bid_invitations'
      and column_name in ('technical_path','technical_name','technical_submitted_at',
                          'commercial_path','commercial_name'))                        as two_envelope_columns,
  (select count(*) = 1 from information_schema.columns
    where table_schema='public' and table_name='vendor_bid_invitations'
      and column_name='access_token')                                                  as token_column,
  (select count(*) = 1 from pg_indexes
    where tablename='vendor_bid_invitations' and indexname='idx_vbi_round_vendor_unique') as round_vendor_unique,
  (select count(*) = 0 from pg_constraint
    where conname='vendor_bid_invitations_wp_vendor_unique')                           as old_wp_unique_dropped,
  (select count(*) = 1 from pg_trigger
    where tgname='trg_bid_clarification_guard' and not tgisinternal)                   as clarification_guard,
  (select count(*) = 0 from pg_policies
    where tablename in ('vendor_bid_rounds','vendor_bid_clarifications') and cmd='ALL') as no_for_all_policy,
  (select count(*) = 0 from pg_policies
    where tablename='vendor_bid_clarifications' and cmd in ('UPDATE','DELETE'))        as clarifications_immutable,
  (select count(*) = 6 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('bid_by_token','submit_bid_by_token',
      'decline_bid_by_token','view_bid_by_token','clarify_bid_by_token',
      'bid_clarifications_by_token'))                                                  as token_rpcs,
  (select bool_and(p.prosecdef) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like '%_by_token')                          as token_rpcs_definer,
  (select count(*) = 1 from storage.buckets where id='bid-submissions')                as bucket_created,
  (select count(*) = 1 from pg_policies
    where tablename='objects' and policyname='bid_submissions_insert_anon')            as anon_upload_policy,
  (select count(*) = 0 from information_schema.columns
    where table_schema='public' and table_name='vendor_bid_board_view'
      and (column_name like '%budget%' or column_name like '%bcb%'
           or column_name like '%contractor%' or column_name like '%proposed%'
           or column_name in ('remarks','outcome_note','total_awarded','variance',
                              'awarded_cost','additionals','rank','technical_score',
                              'shortlisted','negotiated_amount','evaluation_notes')))  as view_leaks_nothing;
