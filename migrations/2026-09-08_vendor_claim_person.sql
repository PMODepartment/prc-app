-- ============================================================================
-- Who is claiming this vendor account — first name, last name, position
-- ----------------------------------------------------------------------------
-- Run ONCE in the Supabase SQL Editor, AFTER 2026-09-03_vendor_claim_tin_only.sql.
-- Safe to re-run: every statement is idempotent and none carries state between
-- statements (the SQL Editor does not run a file as one transaction).
--
-- WHY: the registration form asked only "Your Name — who we should address",
-- one free-text box. A reviewer approving a claim could not see WHO inside the
-- company was asking for control of that vendor's account, or in what capacity.
-- That is the single most useful thing a human reviewer has to go on, because
-- the TIN is evidence about the COMPANY and says nothing about the PERSON.
--
-- ⚠️ THE OLD 4-ARGUMENT submit_vendor_claim IS DROPPED, NOT LEFT ALONGSIDE.
--    PostgREST resolves an overload by ARGUMENT NAMES, so leaving both in place
--    makes rpc('submit_vendor_claim') ambiguous and EVERY registration starts
--    failing. This has already had to be fixed twice in this project
--    (clarify_bid_by_token, and this same function on 2026-09-03).
--
-- ⚠️ claimed_contact_name IS KEPT AND STILL POPULATED, as "First Last". Every
--    downstream consumer reads it — approve_vendor_claim writes it to
--    users.name, create_vendor_from_claim writes it to vendors.contact_person —
--    so splitting it without keeping it would have broken both.
-- ============================================================================

-- 1 ─────────────────────────────────────────────────────────────────────────
-- The three new columns. Nullable: claims submitted before this migration have
-- no first/last split and must keep reading correctly.
alter table public.vendor_claims add column if not exists claimed_first_name text;
alter table public.vendor_claims add column if not exists claimed_last_name  text;
alter table public.vendor_claims add column if not exists claimed_position   text;

comment on column public.vendor_claims.claimed_position is
  'The claimant''s stated role at the company (e.g. Sales Manager). Evidence for '
  'the human reviewer, never used for matching — a job title proves nothing on '
  'its own and must not be treated as identity.';

-- 2 ─────────────────────────────────────────────────────────────────────────
-- ⚠️ DROP FIRST. See the header: two overloads = every registration fails.
drop function if exists public.submit_vendor_claim(text, text, text, boolean);

create or replace function public.submit_vendor_claim(
  p_company text, p_first_name text, p_last_name text, p_position text,
  p_tin text, p_is_new boolean default false)
returns uuid language plpgsql security definer
set search_path = public as $$
declare
  uid   uuid := auth.uid();
  em    text;
  v_id  uuid;
  v_method text := 'none';
  v_conf   text := 'none';
  nrm   text;
  cnt   int;
  full_name text;
begin
  if uid is null then
    raise exception 'You must be signed in to submit a claim.' using errcode = '28000';
  end if;
  select lower(btrim(email)) into em from auth.users where id = uid;
  if em is null then
    raise exception 'No email on this account.' using errcode = '28000';
  end if;
  if nullif(btrim(coalesce(p_company, '')), '') is null then
    raise exception 'A company name is required.' using errcode = '22023';
  end if;

  -- One open claim per person. A decided claim stays as history.
  select count(*) into cnt from public.vendor_claims
   where auth_user_id = uid and status = 'pending';
  if cnt > 0 then
    raise exception 'You already have a registration awaiting review.' using errcode = '23505';
  end if;

  full_name := nullif(btrim(
      coalesce(nullif(btrim(coalesce(p_first_name, '')), ''), '') || ' ' ||
      coalesce(nullif(btrim(coalesce(p_last_name,  '')), ''), '')), '');

  -- ── Matching. UNCHANGED from 2026-09-03: TIN, then exact company name, and
  --    each tier requires EXACTLY ONE hit or it matches nothing.
  -- ⚠️ THE PERSON'S NAME AND POSITION ARE DELIBERATELY NOT MATCHED ON. They are
  --    self-asserted free text; treating them as identity would weaken the
  --    check, not strengthen it.
  nrm := nullif(regexp_replace(coalesce(p_tin, ''), '\D', '', 'g'), '');
  if nrm is not null and length(nrm) >= 9 then
    select count(*) into cnt from public.vendors v
     where nullif(regexp_replace(coalesce(v.tin, ''), '\D', '', 'g'), '') = nrm;
    if cnt = 1 then
      select v.id into v_id from public.vendors v
       where nullif(regexp_replace(coalesce(v.tin, ''), '\D', '', 'g'), '') = nrm;
      v_method := 'tin'; v_conf := 'high';
    elsif cnt > 1 then
      v_method := 'ambiguous'; v_conf := 'none';
    end if;
  end if;

  if v_id is null and v_method <> 'ambiguous' then
    nrm := lower(btrim(regexp_replace(p_company, '\s+', ' ', 'g')));
    select count(*) into cnt from public.vendors v
     where lower(btrim(regexp_replace(coalesce(v.name, ''), '\s+', ' ', 'g'))) = nrm;
    if cnt = 1 then
      select v.id into v_id from public.vendors v
       where lower(btrim(regexp_replace(coalesce(v.name, ''), '\s+', ' ', 'g'))) = nrm;
      v_method := 'name'; v_conf := 'medium';
    elsif cnt > 1 then
      v_method := 'ambiguous'; v_conf := 'none';
    end if;
  end if;

  insert into public.vendor_claims (
      auth_user_id, email, claimed_company, claimed_contact_name,
      claimed_first_name, claimed_last_name, claimed_position,
      claimed_tin, is_new_vendor, vendor_id, match_method, match_confidence)
  values (uid, em, btrim(p_company), full_name,
          nullif(btrim(coalesce(p_first_name, '')), ''),
          nullif(btrim(coalesce(p_last_name,  '')), ''),
          nullif(btrim(coalesce(p_position,   '')), ''),
          nullif(btrim(coalesce(p_tin, '')), ''),
          coalesce(p_is_new, false), v_id, v_method, v_conf)
  returning id into v_id;

  -- ⚠️ ONLY THE CLAIM ID COMES BACK — never the match. Returning it, even as a
  --    boolean, would turn this into an oracle for brute-forcing TINs to
  --    discover which companies Megawide works with.
  return v_id;
end $$;

revoke all on function public.submit_vendor_claim(text, text, text, text, text, boolean) from public;
grant execute on function public.submit_vendor_claim(text, text, text, text, text, boolean) to authenticated;

comment on function public.submit_vendor_claim(text, text, text, text, text, boolean) is
  'Records a vendor registration and matches it to a directory vendor by TIN then '
  'exact company name, each requiring a unique hit. Returns ONLY the claim id — '
  'never the match — so it cannot be used to enumerate Megawide''s vendors.';

-- 3 ─────────────────────────────────────────────────────────────────────────
-- Carry the position onto the vendor record when a claim creates a new vendor.
-- ⚠️ Rewritten by SOURCE so the rest of the function is untouched.
do $$
declare src text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_vendor_from_claim'
   limit 1;
  if src is null then
    raise notice 'create_vendor_from_claim not found — skipping (run 2026-09-01 first).';
    return;
  end if;
  if position('claimed_position' in src) > 0 then
    raise notice 'create_vendor_from_claim already carries the position — nothing to do.';
    return;
  end if;
  -- contact_person is written from claimed_contact_name; add contact_position
  -- immediately after it, in both the column list and the values list.
  src := replace(src, 'contact_person,', 'contact_person, contact_position,');
  src := replace(src,
    'nullif(btrim(coalesce(r.claimed_contact_name, '''')), ''''),',
    'nullif(btrim(coalesce(r.claimed_contact_name, '''')), ''''), '
    || 'nullif(btrim(coalesce(r.claimed_position, '''')), ''''),');
  execute src;
  raise notice 'create_vendor_from_claim now carries the claimant position.';
end $$;

-- 4 ─────────────────────────────────────────────────────────────────────────
-- Verification. Every column must read true.
select
  (select count(*) = 3 from information_schema.columns
    where table_schema = 'public' and table_name = 'vendor_claims'
      and column_name in ('claimed_first_name','claimed_last_name','claimed_position'))
                                                                as person_columns_present,
  (select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'submit_vendor_claim')
                                                                as exactly_one_overload,
  (select p.pronargs = 6 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'submit_vendor_claim')
                                                                as takes_six_arguments,
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'submit_vendor_claim')
                                                                as is_security_definer,
  (select position('claimed_position' in pg_get_functiondef(p.oid)) > 0
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_vendor_from_claim')
                                                                as new_vendor_gets_position;
