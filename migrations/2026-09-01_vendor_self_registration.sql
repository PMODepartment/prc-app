-- ============================================================================
-- Vendor self-registration — one public URL, no per-vendor invite link
-- Megawide WPM Dashboard
-- ----------------------------------------------------------------------------
-- Run ONCE in the Supabase SQL Editor (production). Idempotent — safe to re-run.
-- No temp tables and no cross-statement state.
--
-- ⚠️ RUN AFTER the three vendor-data hardening migrations (soft-delete, audit
-- trail, doc lock). This opens registration up, and those are what make the
-- blast radius of a wrong admission survivable.
--
-- WHY
-- ---
-- The invite flow does not scale: 2,412 vendors x one
-- `vendor-register.html?vendor=<id>` link each, every one needing a real email
-- on file and individual coordination. Nobody has ever completed it (0 rows in
-- users where role='vendor').
--
-- And the per-vendor link was never doing the security work it cost:
-- internal.vendor_invite_valid requires v.id = vid AND lower(v.invite_email) =
-- lower(claim_email), and lower(invite_email) carries a UNIQUE index — so the
-- email alone already pinned exactly one row. The link proved nothing the email
-- did not.
--
-- Replaced by: one public URL. The claimant proves who they are with data only
-- the real vendor holds — Vendor Code (on every PO they have received), TIN, or
-- failing both, their company name — and lands in a staff review queue.
--
-- ⚠️ NO EMAIL IS SENT BY ANY OF THIS, by design. Supabase's built-in sender is
-- development-only on every plan (Pro included), and the standing constraint is
-- no new subscriptions. Identity proof plus staff review replaces inbox
-- verification, and is arguably stronger: the address on file is usually a
-- shared info@ that a departed employee may still read.
-- ============================================================================

-- ── 1. The claim ────────────────────────────────────────────────────────────
-- Deliberately NOT a public.users row. users_insert pins role='user' and
-- status='pending', so a claimant inserting there would land in admin.html's
-- INTERNAL STAFF approval queue — a different queue, reviewed by different
-- people, for a different purpose. Keeping claims in their own table also means
-- an un-approved claimant has no profile at all, so AppAuth.requireLogin signs
-- them straight out of every app page. The users row is created on approval.
create table if not exists public.vendor_claims (
  id                   uuid primary key default gen_random_uuid(),
  auth_user_id         uuid not null,
  email                text not null,
  -- What they typed. Kept verbatim even after matching, so a reviewer can see
  -- what was actually claimed rather than only what the matcher concluded.
  claimed_company      text not null,
  claimed_contact_name text,
  claimed_vendor_code  text,
  claimed_tin          text,
  -- What the claimant says they are. A company that has never worked with
  -- Megawide has no vendor code and no directory row to match against, so
  -- "no match" is the CORRECT and expected outcome for them, not a failure.
  -- The matcher still runs either way (see below).
  is_new_vendor        boolean not null default false,
  -- What the server concluded. NULL vendor_id = no confident match.
  vendor_id            uuid references public.vendors(id) on delete set null,
  match_method         text,     -- code_and_tin | code | tin | name | none | ambiguous
  match_confidence     text,     -- high | medium | none
  status               text not null default 'pending',   -- pending | approved | rejected
  decided_at           timestamptz,
  decided_by           uuid,
  decided_by_name      text,
  decision_notes       text,
  created_at           timestamptz default now(),
  constraint vendor_claims_status_check check (status in ('pending','approved','rejected'))
);

create index if not exists vendor_claims_status_idx on public.vendor_claims (status);
create index if not exists vendor_claims_vendor_idx on public.vendor_claims (vendor_id);

-- One PENDING claim per person. Partial, so decided rows stay as history and a
-- rejected claimant can try again.
create unique index if not exists vendor_claims_one_pending_idx
  on public.vendor_claims (auth_user_id) where status = 'pending';

alter table public.vendor_claims enable row level security;

-- ⚠️ SELECT ONLY, and no INSERT/UPDATE/DELETE policy at all — every write goes
-- through the SECURITY DEFINER functions below. A claimant must not be able to
-- edit their own match result or approve themselves.
--
-- The own-claim branch is `auth_user_id = auth.uid()` and must NOT be expressed
-- via internal.get_my_role(): a claimant has no public.users row, so that
-- helper returns NULL for exactly the people this branch is for.
drop policy if exists "vendor_claims_select" on public.vendor_claims;
create policy "vendor_claims_select" on public.vendor_claims
  for select to authenticated
  using (
    auth_user_id = auth.uid()
    or internal.get_my_role() in ('super_admin','admin','specialist','manager','user')
  );

-- ── 2. Normalizers — the app's own conventions, in SQL ──────────────────────
-- Name: trim + collapse whitespace + lowercase (the key the dedup tools use).
create or replace function internal.norm_company(s text)
returns text language sql immutable as $$
  select nullif(lower(regexp_replace(btrim(coalesce(s,'')), '\s+', ' ', 'g')), '');
$$;

-- TIN: digits only. PH TINs are written 000-313-856-006 / 000313856006 / with a
-- branch suffix, so comparing raw text would miss obvious matches.
create or replace function internal.norm_tin(s text)
returns text language sql immutable as $$
  select nullif(regexp_replace(coalesce(s,''), '\D', '', 'g'), '');
$$;

-- Vendor code: upper, trimmed, inner spaces removed (V-00042 / v 00042).
create or replace function internal.norm_vcode(s text)
returns text language sql immutable as $$
  select nullif(upper(regexp_replace(btrim(coalesce(s,'')), '\s+', '', 'g')), '');
$$;

-- ── 3. Submit a claim ───────────────────────────────────────────────────────
-- ⚠️ ANTI-ENUMERATION: this returns THE SAME RESULT whether or not it matched.
-- Returning the matched company (or even a boolean) would turn the endpoint
-- into an oracle: anyone could brute-force TINs to discover which companies
-- Megawide works with, and confirm that a given TIN belongs to a vendor. The
-- match is recorded for STAFF to read, never handed back to the claimant.
-- Because the answer carries no information, unlimited retries gain an attacker
-- nothing, which is why there is no attempt counter here.
create or replace function public.submit_vendor_claim(
  p_company text, p_contact_name text, p_vendor_code text, p_tin text,
  p_is_new boolean default false)
returns uuid language plpgsql security definer
set search_path = public as $$
declare
  uid uuid := auth.uid();
  em text := lower(coalesce(auth.jwt() ->> 'email', ''));
  n_code text := internal.norm_vcode(p_vendor_code);
  n_tin  text := internal.norm_tin(p_tin);
  n_name text := internal.norm_company(p_company);
  v_id uuid; v_method text; v_conf text; n integer; claim_id uuid;
begin
  if uid is null then
    raise exception 'You must be signed in to submit a claim.' using errcode = '42501';
  end if;
  if n_name is null then
    raise exception 'Company name is required.' using errcode = '22023';
  end if;
  if exists (select 1 from public.users u where u.id = uid) then
    raise exception 'This login already has a profile. Sign in instead.' using errcode = '42710';
  end if;

  -- ⚠️ THE MATCHER RUNS EVEN WHEN THEY SAY THEY ARE NEW, deliberately. A
  -- company that believes it is new is often already in the directory (2,400
  -- rows were derived from work packages and the SAP masterlist, so a vendor
  -- can exist without ever having logged in). Matching anyway is what stops
  -- staff creating a duplicate of a record we already hold — the exact problem
  -- the Merge and Split tools exist to clean up after.

  -- Tier 1 — vendor code AND TIN agree on ONE vendor. The strongest evidence.
  if n_code is not null and n_tin is not null then
    select count(*), min(v.id) into n, v_id from public.vendors v
     where internal.norm_vcode(v.vendor_code) = n_code
       and internal.norm_tin(v.tin) = n_tin;
    if n = 1 then v_method := 'code_and_tin'; v_conf := 'high';
    else v_id := null; end if;
  end if;

  -- Tier 2 — vendor code alone, unique.
  if v_id is null and n_code is not null then
    select count(*), min(v.id) into n, v_id from public.vendors v
     where internal.norm_vcode(v.vendor_code) = n_code;
    if n = 1 then v_method := 'code'; v_conf := 'medium';
    else v_id := null; if n > 1 then v_method := 'ambiguous'; end if; end if;
  end if;

  -- Tier 3 — TIN alone, unique.
  if v_id is null and n_tin is not null then
    select count(*), min(v.id) into n, v_id from public.vendors v
     where internal.norm_tin(v.tin) = n_tin;
    if n = 1 then v_method := 'tin'; v_conf := 'medium';
    else v_id := null; if n > 1 then v_method := 'ambiguous'; end if; end if;
  end if;

  -- Tier 4 — exact normalized company name, unique.
  -- ⚠️ NO FUZZY / CORE-NAME MATCHING HERE. The directory holds real duplicates
  -- and garbled multi-company rows; a fuzzy hit would hand one company's
  -- profile to another. Same refuse-to-guess rule the vendor analytics follows.
  if v_id is null and n_name is not null then
    select count(*), min(v.id) into n, v_id from public.vendors v
     where internal.norm_company(v.name) = n_name;
    if n = 1 then v_method := 'name'; v_conf := 'medium';
    else v_id := null; if n > 1 then v_method := 'ambiguous'; end if; end if;
  end if;

  if v_id is null then
    v_method := coalesce(v_method, 'none');
    v_conf := 'none';
  end if;

  -- Re-submitting replaces the pending claim rather than piling rows up. The
  -- partial unique index is the arbiter.
  delete from public.vendor_claims
   where auth_user_id = uid and status = 'pending';

  insert into public.vendor_claims (
    auth_user_id, email, claimed_company, claimed_contact_name,
    claimed_vendor_code, claimed_tin, is_new_vendor, vendor_id, match_method, match_confidence)
  values (uid, em, btrim(p_company), nullif(btrim(coalesce(p_contact_name,'')),''),
          nullif(btrim(coalesce(p_vendor_code,'')),''), nullif(btrim(coalesce(p_tin,'')),''),
          coalesce(p_is_new, false), v_id, v_method, v_conf)
  returning id into claim_id;

  return claim_id;   -- deliberately NOT the match result
end $$;

-- Drop the earlier 4-argument signature if this migration is being re-run over
-- a database that got the first version; leaving it would expose a second entry
-- point that skips the is_new flag.
drop function if exists public.submit_vendor_claim(text,text,text,text);
revoke all on function public.submit_vendor_claim(text,text,text,text,boolean) from public, anon;
grant execute on function public.submit_vendor_claim(text,text,text,text,boolean) to authenticated;

comment on function public.submit_vendor_claim(text,text,text,text,boolean) is
  'INTENTIONAL SECURITY DEFINER, and it MUST be: it reads public.vendors to '
  'match the claimant, who has no public.users row yet and therefore no read '
  'access to that table under vendors_select. Self-authorizing via auth.uid(). '
  'Returns only the new claim id — never whether or to whom it matched — so it '
  'cannot be used to enumerate vendors or confirm a TIN.';

-- ── 4. Staff decisions ──────────────────────────────────────────────────────
-- Definer because users_insert pins role='user' AND status='pending', so no
-- staff member can create a vendor profile for someone else under normal RLS.
create or replace function public.approve_vendor_claim(
  p_claim uuid, p_vendor uuid, p_notes text default null)
returns void language plpgsql security definer
set search_path = public as $$
declare r public.vendor_claims%rowtype; caller text; caller_name text; v_name text;
begin
  select u.role, coalesce(u.name, u.email) into caller, caller_name
    from public.users u where u.id = auth.uid();
  -- Allow-list, never a deny-list: a role added later must be granted access
  -- deliberately rather than inheriting it (the merge_vendors lesson).
  if caller is null or caller not in ('super_admin','admin','specialist','manager','user') then
    raise exception 'Not authorised to decide vendor claims.' using errcode = '42501';
  end if;

  select * into r from public.vendor_claims where id = p_claim;
  if r.id is null then raise exception 'Claim not found.' using errcode = 'P0002'; end if;
  if r.status <> 'pending' then
    raise exception 'This claim has already been decided.' using errcode = '42710';
  end if;
  if p_vendor is null then
    raise exception 'Pick the vendor this claim belongs to before approving.' using errcode = '22023';
  end if;
  select v.name into v_name from public.vendors v where v.id = p_vendor;
  if v_name is null then raise exception 'Vendor not found.' using errcode = 'P0002'; end if;

  -- The profile. on conflict covers a retried approval.
  insert into public.users (id, name, email, role, status, vendor_id)
  values (r.auth_user_id,
          coalesce(nullif(btrim(coalesce(r.claimed_contact_name,'')),''), split_part(r.email,'@',1)),
          r.email, 'vendor', 'approved', p_vendor)
  on conflict (id) do update
    set role = 'vendor', status = 'approved', vendor_id = excluded.vendor_id;

  update public.vendor_claims
     set status = 'approved', vendor_id = p_vendor, decided_at = now(),
         decided_by = auth.uid(), decided_by_name = caller_name, decision_notes = p_notes
   where id = p_claim;

  -- Mark the vendor as having a live login. Only the first one stamps it.
  update public.vendors
     set invite_claimed_at = now()
   where id = p_vendor and invite_claimed_at is null;
end $$;

revoke all on function public.approve_vendor_claim(uuid,uuid,text) from public, anon;
grant execute on function public.approve_vendor_claim(uuid,uuid,text) to authenticated;

-- ── 4b. Approving a company we have NEVER dealt with ────────────────────────
-- A genuinely new supplier (a walk-in, an FTA introduction, anyone answering a
-- printed QR) has no vendor code and no directory row, so there is nothing for
-- approve_vendor_claim to point at. This creates the record first, then hands
-- off to the normal approval so there is only ONE place that grants access.
create or replace function public.create_vendor_from_claim(
  p_claim uuid, p_name text default null, p_notes text default null)
returns uuid language plpgsql security definer
set search_path = public as $$
declare r public.vendor_claims%rowtype; caller text; v_id uuid; nm text;
begin
  select u.role into caller from public.users u where u.id = auth.uid();
  if caller is null or caller not in ('super_admin','admin','specialist','manager','user') then
    raise exception 'Not authorised to decide vendor claims.' using errcode = '42501';
  end if;

  select * into r from public.vendor_claims where id = p_claim;
  if r.id is null then raise exception 'Claim not found.' using errcode = 'P0002'; end if;
  if r.status <> 'pending' then
    raise exception 'This claim has already been decided.' using errcode = '42710';
  end if;

  nm := nullif(btrim(coalesce(p_name, r.claimed_company)), '');
  if nm is null then raise exception 'A company name is required.' using errcode = '22023'; end if;

  -- ⚠️ REFUSE if that name already exists. Creating a second record for a
  -- company we already hold is precisely the duplication the Merge and Split
  -- tools exist to clean up after — and the directory has 2,400 rows derived
  -- from work packages and the SAP masterlist, so "I am new" is often wrong.
  -- The reviewer should link to the existing record instead.
  select v.id into v_id from public.vendors v
   where internal.norm_company(v.name) = internal.norm_company(nm)
   limit 1;
  if v_id is not null then
    raise exception
      'A vendor named "%" is already in the directory. Link this registration to that record instead of creating a duplicate.', nm
      using errcode = '23505';
  end if;

  -- accreditation is left NULL — Not Accredited. A brand-new supplier has not
  -- been assessed, and saying otherwise would assert a business fact nobody
  -- checked. They can request accreditation from the portal once they are in.
  insert into public.vendors (
    name, invite_email, status, contact_person, contact_email, tin, vendor_code, notes)
  values (
    nm,
    -- Deterministic and unique, so it cannot collide with the unique index on
    -- lower(invite_email), and _displayEmail() hides @no-invite.local in the UI.
    'claim+' || replace(p_claim::text, '-', '') || '@no-invite.local',
    'approved',
    nullif(btrim(coalesce(r.claimed_contact_name, '')), ''),
    r.email,
    nullif(btrim(coalesce(r.claimed_tin, '')), ''),
    nullif(btrim(coalesce(r.claimed_vendor_code, '')), ''),
    'Created from a self-registration on ' || to_char(now(), 'YYYY-MM-DD') || '.')
  returning id into v_id;

  -- One place grants access. Do not inline a second copy of that logic here.
  perform public.approve_vendor_claim(p_claim, v_id, p_notes);
  return v_id;
end $$;

revoke all on function public.create_vendor_from_claim(uuid,text,text) from public, anon;
grant execute on function public.create_vendor_from_claim(uuid,text,text) to authenticated;

comment on function public.create_vendor_from_claim(uuid,text,text) is
  'INTENTIONAL SECURITY DEFINER. Creates a vendors row for a company that is '
  'not in the directory yet, then delegates to approve_vendor_claim. Refuses if '
  'the name already exists, so a self-registration cannot create a duplicate of '
  'a record we already hold. Self-authorizes against the staff allow-list.';

create or replace function public.reject_vendor_claim(p_claim uuid, p_notes text default null)
returns void language plpgsql security definer
set search_path = public as $$
declare caller text; caller_name text;
begin
  select u.role, coalesce(u.name, u.email) into caller, caller_name
    from public.users u where u.id = auth.uid();
  if caller is null or caller not in ('super_admin','admin','specialist','manager','user') then
    raise exception 'Not authorised to decide vendor claims.' using errcode = '42501';
  end if;
  update public.vendor_claims
     set status = 'rejected', decided_at = now(), decided_by = auth.uid(),
         decided_by_name = caller_name, decision_notes = p_notes
   where id = p_claim and status = 'pending';
end $$;

revoke all on function public.reject_vendor_claim(uuid,text) from public, anon;
grant execute on function public.reject_vendor_claim(uuid,text) to authenticated;

comment on function public.approve_vendor_claim(uuid,uuid,text) is
  'INTENTIONAL SECURITY DEFINER. Creates the vendor''s public.users profile, '
  'which no staff role can do under users_insert (it pins role=''user'' and '
  'status=''pending''). Self-authorizes against an allow-list of staff roles.';

-- ── 5. Verification — EVERY column must read true ───────────────────────────
select
  (select count(*) = 1 from information_schema.tables
     where table_schema='public' and table_name='vendor_claims')                    as claims_table,
  (select relrowsecurity from pg_class where oid = 'public.vendor_claims'::regclass) as rls_enabled,
  (select count(*) = 1 from pg_policies
     where schemaname='public' and tablename='vendor_claims')                       as select_policy_only,
  (select count(*) = 0 from pg_policies
     where schemaname='public' and tablename='vendor_claims' and cmd <> 'SELECT')   as no_write_policies,
  (select bool_and(prosecdef) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public'
       and p.proname in ('submit_vendor_claim','approve_vendor_claim','reject_vendor_claim','create_vendor_from_claim'))
                                                                                    as rpcs_security_definer,
  (select count(*) = 1 from information_schema.columns
     where table_schema='public' and table_name='vendor_claims'
       and column_name='is_new_vendor')                                              as is_new_col,
  (select count(*) = 1 from pg_indexes
     where schemaname='public' and indexname='vendor_claims_one_pending_idx')       as one_pending_per_user;
