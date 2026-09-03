-- ============================================================================
-- Vendor self-registration identifies by TIN, not Vendor Code
-- Megawide WPM Dashboard
-- ----------------------------------------------------------------------------
-- Run once in the Supabase SQL Editor (production). Idempotent — safe to re-run.
-- Run AFTER migrations/2026-09-01_vendor_self_registration.sql.
--
-- WHY
--   Vendor Code (the SAP BP id, V-000nn) is INTERNAL TAGGING. A vendor never
--   sees it: it is not on the purchase order, not on the PO/JO, not on anything
--   Megawide sends them. Verified against a real PO (376000333, Switch Gear
--   Phils.) — it carries the PO number, the project code, the supplier name and
--   address, and no vendor code at all. Asking a claimant for it meant asking
--   for something they cannot know, so the strongest tier of the matcher was
--   dead weight and the field was pure confusion on a public page.
--
--   TIN is the opposite: it is on their own BIR 2303 — a document they must
--   upload for accreditation anyway — it is nationally unique, and the
--   masterlist already gave us one for a large part of the directory.
--
-- WHAT CHANGES
--   Four tiers (code+TIN, code, TIN, name) become two: TIN, then exact
--   normalized company name. TIN alone is now the STRONGEST evidence available,
--   so it is rated 'high' rather than the 'medium' it carried when the code
--   tiers outranked it.
--
-- ⚠️ vendors.vendor_code IS NOT TOUCHED, and must not be. It is still the best
--    dedup key we have internally (of 1,461 codes only 97 mapped to more than
--    one name string, nearly all pure case/spacing variants), it is what the
--    PO-history backfill resolved against, and staff still set and search it.
--    What changes is only that a VENDOR is never asked for it.
--
-- ⚠️ vendor_claims.claimed_vendor_code IS ALSO KEPT. Claims already submitted
--    carry values in it, and dropping the column would destroy that record.
--    New claims simply leave it NULL.
--
-- No temp tables and no state carried between statements — the Supabase SQL
-- Editor does not run a script as one transaction.
-- ============================================================================


-- ── 1. the old 5-argument signature must GO, not just be replaced ───────────
-- PostgREST resolves overloads by ARGUMENT NAMES. Leaving the old signature in
-- place alongside a new 4-argument one would make `rpc('submit_vendor_claim')`
-- ambiguous — the call would start failing rather than picking one.
drop function if exists public.submit_vendor_claim(text, text, text, text, boolean);


-- ── 2. the matcher, TIN first ───────────────────────────────────────────────
-- ⚠️ ANTI-ENUMERATION IS UNCHANGED AND LOAD-BEARING: this returns ONLY the new
-- claim id, and the SAME answer whether or not it matched. Returning the
-- matched company — or even a boolean — would turn the endpoint into an oracle:
-- anyone could brute-force TINs to discover which companies Megawide works with
-- and confirm that a given TIN belongs to one. The match is recorded for STAFF
-- to read, never handed back. Because the answer carries no information,
-- unlimited retries gain an attacker nothing, which is why there is still no
-- attempt counter. NEVER surface the match on the registration page.
create or replace function public.submit_vendor_claim(
  p_company text, p_contact_name text, p_tin text,
  p_is_new boolean default false)
returns uuid language plpgsql security definer
set search_path = public as $$
declare
  uid uuid := auth.uid();
  em text := lower(coalesce(auth.jwt() ->> 'email', ''));
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
  -- company that believes it is new is often already in the directory (~2,400
  -- rows were derived from work packages and the SAP masterlist, so a vendor
  -- can exist without ever having logged in). Matching anyway is what stops
  -- staff creating a duplicate of a record we already hold — the exact problem
  -- the Merge and Split tools exist to clean up after.

  -- Tier 1 — TIN, unique. The strongest evidence a vendor can actually supply:
  -- nationally unique, on their own BIR 2303, and on file for much of the
  -- directory from the masterlist.
  if n_tin is not null then
    select count(*), (array_agg(v.id order by v.id))[1] into n, v_id from public.vendors v
     where internal.norm_tin(v.tin) = n_tin;
    if n = 1 then v_method := 'tin'; v_conf := 'high';
    else v_id := null; if n > 1 then v_method := 'ambiguous'; end if; end if;
  end if;

  -- Tier 2 — exact normalized company name, unique.
  -- ⚠️ NO FUZZY / CORE-NAME MATCHING HERE. The directory holds real duplicates
  -- and garbled multi-company rows; a fuzzy hit would hand one company's
  -- profile to another. Same refuse-to-guess rule the vendor analytics follows.
  if v_id is null and n_name is not null then
    select count(*), (array_agg(v.id order by v.id))[1] into n, v_id from public.vendors v
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

  -- claimed_vendor_code is deliberately left NULL now: a vendor is never asked
  -- for it. The column stays for the claims already submitted with one.
  insert into public.vendor_claims (
    auth_user_id, email, claimed_company, claimed_contact_name,
    claimed_tin, is_new_vendor, vendor_id, match_method, match_confidence)
  values (uid, em, btrim(p_company), nullif(btrim(coalesce(p_contact_name,'')),''),
          nullif(btrim(coalesce(p_tin,'')),''), coalesce(p_is_new, false),
          v_id, v_method, v_conf)
  returning id into claim_id;

  return claim_id;
end;
$$;

revoke all on function public.submit_vendor_claim(text, text, text, boolean) from public;
grant execute on function public.submit_vendor_claim(text, text, text, boolean) to authenticated;

comment on function public.submit_vendor_claim(text, text, text, boolean) is
  'Records a vendor self-registration and matches it against the directory by '
  'TIN, then exact company name. Vendor Code was removed as an input: it is '
  'internal SAP tagging that never appears on anything a vendor receives. '
  'Returns ONLY the new claim id — never whether or to whom it matched — so it '
  'cannot be used to enumerate which companies Megawide works with. '
  'INTENTIONAL SECURITY DEFINER: the claimant has no users row yet and so no '
  'visibility of vendors under RLS.';


-- ── 3. stop stamping a claimed vendor_code onto a newly created vendor ──────
-- Nothing collects it any more, so the value would always be NULL — but leaving
-- the column in the INSERT invites someone to wire it back to a vendor-supplied
-- field later, which is the thing this migration exists to prevent. Staff set
-- vendor_code from the SAP master, on the vendor's own page.
create or replace function public.create_vendor_from_claim(p_claim uuid, p_name text default null, p_notes text default null)
returns uuid language plpgsql security definer
set search_path = public as $$
declare r public.vendor_claims; nm text; v_id uuid; caller text;
begin
  caller := internal.get_my_role();
  if caller is null or caller not in ('super_admin','admin','specialist','manager','user') then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  select * into r from public.vendor_claims where id = p_claim;
  if r.id is null then raise exception 'No such registration.' using errcode = 'P0002'; end if;
  if r.status <> 'pending' then raise exception 'This claim has already been decided.' using errcode = '42710'; end if;

  nm := btrim(coalesce(nullif(btrim(coalesce(p_name,'')),''), r.claimed_company));
  if nm = '' then raise exception 'A company name is required.' using errcode = '22023'; end if;

  -- ⚠️ REFUSE A DUPLICATE. The directory already holds ~2,400 rows derived from
  -- work packages and the SAP masterlist, so "we are new" is often wrong, and
  -- creating a second record is exactly the duplication Merge/Split exist to
  -- clean up. Link the existing vendor instead.
  if exists (select 1 from public.vendors v where internal.norm_company(v.name) = internal.norm_company(nm)) then
    raise exception 'A vendor called "%" already exists — approve the claim against that record instead of creating a second one.', nm
      using errcode = '23505';
  end if;

  insert into public.vendors (
    name, invite_email, status, contact_person, contact_email, tin, notes)
  values (
    nm,
    -- Deterministic and unique, so it cannot collide with the unique index on
    -- lower(invite_email), and _displayEmail() hides @no-invite.local in the UI.
    'claim+' || replace(p_claim::text, '-', '') || '@no-invite.local',
    'approved',
    nullif(btrim(coalesce(r.claimed_contact_name, '')), ''),
    r.email,
    nullif(btrim(coalesce(r.claimed_tin, '')), ''),
    'Created from a self-registration on ' || to_char(now(), 'YYYY-MM-DD') || '.')
  returning id into v_id;

  -- One place grants access. Do not inline a second copy of that logic here.
  perform public.approve_vendor_claim(p_claim, v_id, p_notes);
  return v_id;
end;
$$;

revoke all on function public.create_vendor_from_claim(uuid, text, text) from public;
grant execute on function public.create_vendor_from_claim(uuid, text, text) to authenticated;


-- ── 4. verification — every column must read `true` ────────────────────────
select
  (select count(*) = 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'submit_vendor_claim'
      and pg_get_function_identity_arguments(p.oid) = 'text, text, text, text, boolean')  as old_signature_gone,
  (select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'submit_vendor_claim')                     as exactly_one_overload,
  (select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'submit_vendor_claim'
      and pg_get_function_identity_arguments(p.oid) = 'text, text, text, boolean')        as new_signature_present,
  (select p.prosrc not like '%norm_vcode%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'submit_vendor_claim')                     as no_vendor_code_tier,
  (select p.prosrc not like '%claimed_vendor_code%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_vendor_from_claim')                as create_ignores_code,
  (select count(*) = 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'vendors' and column_name = 'vendor_code') as vendor_code_column_kept,
  (select count(*) = 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'vendor_claims'
      and column_name = 'claimed_vendor_code')                                            as claim_history_kept;
