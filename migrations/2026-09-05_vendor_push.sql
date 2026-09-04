-- ═══════════════════════════════════════════════════════════════════════════
-- WEB PUSH for the vendor portal — a real notification while the app is CLOSED.
-- Run once, in the Supabase SQL Editor. Then deploy the Edge Function and add
-- ONE Database Webhook; see supabase/functions/send-bid-push/README.md.
--
-- ⚠️ NO SUBSCRIPTION IS NEEDED, and an earlier note in CLAUDE.md said otherwise.
--    Supabase Pro already includes Edge Functions, and the push services
--    themselves (Google, Mozilla, Apple) are free. What this costs is a
--    DEPLOYMENT STEP — the first thing in this project that lives outside the
--    repo — not money.
--
-- ⚠️ THE PUSH CARRIES NO PAYLOAD, AND THAT IS A DECISION, NOT A SHORTCUT.
--    A payloadless push needs only a signed VAPID header; a push WITH a payload
--    needs RFC 8291 content encryption. Skipping that is convenient, but the
--    real reason is that the message would travel through Google's or Apple's
--    infrastructure. "A new bid invitation is waiting" tells the vendor to look
--    without putting a package name, a deadline or a figure on that wire. The
--    service worker shows the generic notice and the portal shows the detail.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. where a device's push subscription lives ───────────────────────────
create table if not exists public.vendor_push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  vendor_id   uuid not null references public.vendors(id) on delete cascade,
  user_id     uuid,
  endpoint    text not null unique,   -- the push service URL; unique per device
  p256dh      text,                   -- kept for a future payload-carrying push
  auth        text,
  user_agent  text,
  created_at  timestamptz default now(),
  last_seen_at timestamptz default now(),
  last_error  text
);
create index if not exists idx_push_subs_vendor on public.vendor_push_subscriptions(vendor_id);

comment on table public.vendor_push_subscriptions is
  'One row per device that agreed to notifications. endpoint is unique: a browser '
  'reissues the same endpoint for the same device, so re-subscribing updates rather '
  'than duplicating.';

alter table public.vendor_push_subscriptions enable row level security;

-- A vendor manages its OWN devices and nobody else's. Staff have no business
-- here either — this is a device list, not procurement data.
drop policy if exists push_subs_own on public.vendor_push_subscriptions;
create policy push_subs_own on public.vendor_push_subscriptions
  for all to authenticated
  using (vendor_id = internal.get_my_vendor_id())
  with check (vendor_id = internal.get_my_vendor_id());

-- ── 2. the outbox ────────────────────────────────────────────────────────
-- ⚠️ A QUEUE, NOT A WEBHOOK PER SOURCE TABLE. Three different events deserve a
--    notification (an RFQ issued, a clarification asked, an outcome decided).
--    Pointing a webhook at each source table means three webhooks to configure
--    and three payload shapes in the function. One outbox means ONE webhook,
--    one shape, and — the part that matters — a row that survives a failed
--    send, so a notification that did not go out is visible instead of lost.
create table if not exists public.vendor_push_outbox (
  id          bigserial primary key,
  vendor_id   uuid not null references public.vendors(id) on delete cascade,
  kind        text not null check (kind in ('invited','clarification','outcome')),
  round_id    uuid,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  attempts    integer not null default 0,
  last_error  text
);
create index if not exists idx_push_outbox_unsent
  on public.vendor_push_outbox(created_at) where sent_at is null;

alter table public.vendor_push_outbox enable row level security;
-- ⚠️ NO POLICY AT ALL. Written by triggers (which run as the table owner) and
--    read by the Edge Function with the service role. Nothing in a browser has
--    any reason to see or touch this queue.

-- ── 3. what earns a notification ──────────────────────────────────────────
-- ⚠️ THREE EVENTS, AND NOTHING ELSE. A portal that notifies on every change
--    trains the vendor to swipe them away, and then the one that mattered goes
--    with them. These are the three where the vendor has to DO something or is
--    owed an answer.

-- 3a. The RFQ went out. ⚠️ On the ROUND reaching 'issued', not on the
--     invitation being created: bidders are added while the round is still a
--     draft, and notifying then would tell a vendor to quote something that has
--     not been sent yet.
create or replace function internal.push_on_round_issued()
returns trigger
language plpgsql
security definer
set search_path = public, internal
as $fn$
begin
  if new.stage = 'issued' and coalesce(old.stage, '') is distinct from 'issued' then
    insert into public.vendor_push_outbox (vendor_id, kind, round_id)
    select distinct i.vendor_id, 'invited', new.id
      from public.vendor_bid_invitations i
     where i.round_id = new.id
       and i.status not in ('withdrawn', 'declined')
       and i.vendor_id is not null;
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_push_round_issued on public.vendor_bid_rounds;
create trigger trg_push_round_issued
  after update on public.vendor_bid_rounds
  for each row execute function internal.push_on_round_issued();

-- 3b. A buyer asked this bidder something.
-- ⚠️ author = 'staff' ONLY. The vendor's own reply must not notify the vendor.
create or replace function internal.push_on_clarification()
returns trigger
language plpgsql
security definer
set search_path = public, internal
as $fn$
declare v uuid;
begin
  if new.author is distinct from 'staff' then return new; end if;
  select i.vendor_id into v from public.vendor_bid_invitations i where i.id = new.invitation_id;
  if v is not null then
    insert into public.vendor_push_outbox (vendor_id, kind, round_id)
    values (v, 'clarification', new.round_id);
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_push_clarification on public.vendor_bid_clarifications;
create trigger trg_push_clarification
  after insert on public.vendor_bid_clarifications
  for each row execute function internal.push_on_clarification();

-- 3c. The round was decided. Awarded or not, the bidder is owed the news.
create or replace function internal.push_on_outcome()
returns trigger
language plpgsql
security definer
set search_path = public, internal
as $fn$
begin
  if new.outcome is not null
     and coalesce(old.outcome, '') is distinct from coalesce(new.outcome, '')
     and new.vendor_id is not null then
    insert into public.vendor_push_outbox (vendor_id, kind, round_id)
    values (new.vendor_id, 'outcome', new.round_id);
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_push_outcome on public.vendor_bid_invitations;
create trigger trg_push_outcome
  after update on public.vendor_bid_invitations
  for each row execute function internal.push_on_outcome();

-- ── 4. verification — every column must read true ─────────────────────────
select
  exists (select 1 from information_schema.tables
           where table_schema='public' and table_name='vendor_push_subscriptions')  as subs_table,
  exists (select 1 from information_schema.tables
           where table_schema='public' and table_name='vendor_push_outbox')         as outbox_table,
  -- a vendor sees only its own devices
  (select count(*) = 1 from pg_policies
    where schemaname='public' and tablename='vendor_push_subscriptions'
      and qual like '%get_my_vendor_id%')                                           as subs_scoped_to_vendor,
  -- and nothing in a browser can touch the queue
  (select count(*) = 0 from pg_policies
    where schemaname='public' and tablename='vendor_push_outbox')                   as outbox_has_no_policy,
  (select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='vendor_push_outbox')                    as outbox_rls_on,
  (select count(*) = 3 from pg_trigger
    where tgname in ('trg_push_round_issued','trg_push_clarification','trg_push_outcome')
      and not tgisinternal)                                                         as three_triggers,
  -- the clarification trigger must ignore the vendor's own replies
  (select p.prosrc like '%author is distinct from ''staff''%'
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='internal' and p.proname='push_on_clarification')                as staff_only_clarifications;
