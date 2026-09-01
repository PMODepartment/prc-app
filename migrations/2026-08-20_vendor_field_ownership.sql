-- ============================================================================
--  Lock the staff-owned columns on public.vendors against vendor self-edits.
--
--  Run ONCE in the Supabase SQL Editor. Idempotent (create or replace).
--  Requires: migrations/2026-08-10_vendor_management.sql, migrations/2026-08-19_vendor_accreditation.sql,
--            migrations/2026-08-20_vendor_accreditation_requests.sql (the profile columns).
--
--  WHY A TRIGGER AND NOT RLS
--    A vendor legitimately needs UPDATE on their own vendors row — that is what
--    vendor-portal.html is for. RLS decides WHICH ROWS a caller may touch; it
--    cannot restrict WHICH COLUMNS an update writes. So a vendor could PATCH
--    any column of their own row straight at the REST API, whatever the portal
--    happens to render. Pinning the values here is the only real enforcement.
--
--  WHAT CHANGED (2026-08-20)
--    The guard already pinned status, invite_*, accreditation* and vendor_code.
--    It did NOT pin the fields below, all of which are Megawide's to set:
--
--      name             identity. A vendor renaming themselves breaks the
--                       directory's link to the masterlist and to their own
--                       work packages, and lets one company take another's name.
--      payment_terms    a COMMERCIAL TERM Megawide agrees, not a self-declared
--                       one. A vendor could have set themselves to "7 Days".
--      vendor_category  Megawide's SAP classification (Supplier/Subcon/Services).
--      vendor_group     Megawide's SAP grouping ("Ready Mix Concrete").
--      notes            STAFF-INTERNAL remarks. The Add Vendor modal labels this
--                       "Anything else worth recording about this vendor" — yet
--                       the portal was editing the SAME column, so a vendor
--                       could overwrite staff's private notes about them.
--
--      tin              FILL-ONCE. A vendor may supply it while completing
--                       accreditation (it is on the required-information list),
--                       but must not change it afterwards — the TIN is tied to
--                       the BIR 2303 on file, so a later change would silently
--                       break that evidence.
--
--  STILL VENDOR-OWNED, deliberately: contact_person, contact_position,
--  contact_number, telephone, contact_email, website, address, city,
--  trade_categories. These are the vendor telling us how to reach them and what
--  they do — the whole point of self-service.
--
--  KNOWN LIMITATION, NOT FIXED HERE
--    This stops vendors WRITING those columns. It does not stop them READING
--    them: vendors_select lets a vendor read their own row in full, so
--    vendors.notes and accreditation_notes are visible to them via the API even
--    though the portal no longer shows notes. Fixing that needs a column-free
--    view for the vendor role (the same shape as wp_view_public for viewers).
--    Until then, treat vendors.notes as "staff-only to write, but readable by
--    that vendor" and keep anything genuinely private out of it.
-- ============================================================================

create or replace function internal.vendor_edit_guard()
returns trigger language plpgsql security definer
set search_path = public as $$
declare caller_role text;
begin
  select role into caller_role from public.users where id = auth.uid() limit 1;

  if caller_role = 'vendor' then
    -- Any vendor self-edit flags the row for staff. Nothing else writes
    -- vendors.status any more, so it reads as "changed since acknowledged".
    new.status := 'pending_review';

    -- Invite / login plumbing.
    new.invite_email      := old.invite_email;
    new.invite_claimed_at := old.invite_claimed_at;

    -- Accreditation is Megawide's judgement about the vendor.
    new.accreditation       := old.accreditation;
    new.accreditation_notes := old.accreditation_notes;
    new.accreditation_date  := old.accreditation_date;

    -- Identity and Megawide's own classification / commercial terms.
    new.vendor_code     := old.vendor_code;
    new.name            := old.name;
    new.payment_terms   := old.payment_terms;
    new.vendor_category := old.vendor_category;
    new.vendor_group    := old.vendor_group;

    -- Staff-internal remarks.
    new.notes := old.notes;

    -- TIN: settable while blank, frozen once on file (tied to the BIR 2303).
    if old.tin is not null and btrim(old.tin) <> '' then
      new.tin := old.tin;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_vendor_edit_guard on public.vendors;
create trigger trg_vendor_edit_guard
  before update on public.vendors
  for each row execute function internal.vendor_edit_guard();

comment on function internal.vendor_edit_guard() is
  'Pins staff-owned columns on a vendor self-edit. RLS cannot restrict which '
  'columns an UPDATE writes, so this is the only enforcement — the portal UI is '
  'presentation, not a control. Add any new staff-owned vendors column here.';

-- ── sanity check ────────────────────────────────────────────────────────────
select tgname, tgenabled
  from pg_trigger
 where tgname = 'trg_vendor_edit_guard';
-- Expect one row, tgenabled = 'O'.
