-- ════════════════════════════════════════════════════════════════════════════
-- MIGRATION_vendor_edited_flag.sql   (run once, idempotent)
-- ════════════════════════════════════════════════════════════════════════════
-- Give the "Vendor edits" KPI tile a TRUE signal.
--
-- The tile in vendors.html used to count vendors.status = 'pending_review',
-- on the assumption that only internal.vendor_edit_guard (a real vendor
-- self-edit) could set that value. It can't: 'pending_review' was ALSO the
-- default the older import/creation path wrote, so the tile counted hundreds of
-- masterlist-imported rows no vendor ever touched (the live "516" was entirely
-- legacy creation-state, not edits).
--
-- Fix: a dedicated timestamp stamped ONLY by the trigger on a vendor's own
-- UPDATE. NULL = no un-acknowledged vendor self-edit. Staff clears it (sets it
-- back to NULL) when they mark the change reviewed. The status column keeps its
-- existing behaviour untouched — this is purely an additive, authoritative flag.
--
-- NOT backfilled on purpose: existing pending_review rows stay NULL, so the
-- tile reads 0 until a genuine vendor self-edit occurs. That is the point — we
-- cannot retroactively know which legacy rows were "edited" (none were).
-- ════════════════════════════════════════════════════════════════════════════

alter table vendors add column if not exists vendor_edited_at timestamptz;

comment on column vendors.vendor_edited_at is
  'Set by internal.vendor_edit_guard to now() ONLY when the vendor edits their own row. NULL = no un-acknowledged self-edit (staff clears it on review). Authoritative source for the "Vendor edits" KPI — do NOT infer edits from status=''pending_review'', which is also the legacy creation default.';

-- ── Recreate the guard to stamp vendor_edited_at on a vendor self-edit ───────
-- Body is unchanged from MIGRATION_vendor_accreditation.sql except for the one
-- new stamp line. Still pins status + invite + all staff-owned columns so a
-- vendor cannot PATCH those about themselves via the REST API.
create or replace function internal.vendor_edit_guard()
returns trigger language plpgsql security definer
set search_path = public as $$
declare caller_role text;
begin
  select role into caller_role from public.users where id = auth.uid() limit 1;
  if caller_role = 'vendor' then
    new.status := 'pending_review';
    new.vendor_edited_at := now();                 -- TRUE self-edit signal (staff clears to NULL on review)
    new.invite_email := old.invite_email;          -- vendor can't reassign their own invite
    new.invite_claimed_at := old.invite_claimed_at;
    -- Staff-owned fields — a vendor can never set these about themselves.
    new.accreditation := old.accreditation;
    new.accreditation_notes := old.accreditation_notes;
    new.accreditation_date := old.accreditation_date;
    new.vendor_code := old.vendor_code;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_vendor_edit_guard on vendors;
create trigger trg_vendor_edit_guard before update on vendors
  for each row execute function internal.vendor_edit_guard();
