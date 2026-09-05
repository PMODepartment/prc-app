-- ============================================================================
-- Bid Management: what a quoted figure actually MEANS -- VAT-in, VAT-ex, or
-- a non-VAT vendor.
-- Run ONCE, in the Supabase SQL Editor, AFTER 2026-09-05_bid_cost_comparison.sql
-- ============================================================================
--
-- WHY -- THIS FIXES A REAL, LIVE ERROR
-- -----------------------------------
-- Megawide's own RFQ template says: "The price indicated in the quotation shall
-- be inclusive of VAT." So bidders quote GROSS.
--
-- But everything the figure is measured against, and everything it is written
-- into, is NET:
--
--   * work_packages.approved_budget_bcb  -- the sheets head it "BUDGET (BCB)
--     (NET)" / "BUDGET (VAT EX)"
--   * work_packages.awarded_cost         -- the WP form labels it "Awarded Cost
--     (Net)"; the importer maps "AWARDED COST (NET)" / "AWARDED (VAT EX)"
--
-- So doAward() has been writing a VAT-INCLUSIVE figure into a VAT-EXCLUSIVE
-- column -- a 12% overstatement of cost, and therefore of every savings figure,
-- KPI and variance derived from it, on any package awarded through Bid
-- Management. Comparing a VAT-in bid against a VAT-ex budget in the battery had
-- the same 12% error, and comparing a VAT-registered bidder against a non-VAT
-- one ranked them on figures that were never on the same basis.
--
-- WHAT THIS ADDS
-- --------------
--   vendor_bid_rounds.tax_basis / vat_rate        what the RFQ ASKED FOR
--   vendor_bid_invitations.tax_basis / vat_rate   what THIS bidder actually quoted
--
-- THE BIDDER-LEVEL OVERRIDE IS THE ONE THAT MATTERS. A non-VAT-registered
--   vendor in the same round is common, and their quotation is not on the round's
--   basis however clearly the letter asked. NULL there means "follow the round",
--   so nothing has to be filled in twice.
--
-- NET IS DERIVED, NEVER STORED. A stored net goes stale the moment somebody
--   corrects the basis, and there would then be two disagreeing numbers with
--   nothing to say which is right. The one place a net figure IS stored is
--   work_packages.awarded_cost, because that is the record of the award.
--
-- NON-VAT IS TREATED AS ALREADY NET, and that rests on an assumption worth
--   stating: input VAT on a VAT-registered vendor's invoice is creditable
--   against Megawide's output VAT, so a gross 112 and a non-VAT 100 cost the
--   same 100. The CASH paid differs (112 vs 100) and the PO carries the gross,
--   which is why the app shows both figures rather than only the one it ranks on.
--
-- THE RATE IS A COLUMN, NOT A CONSTANT. It is 12% in the Philippines today, but
--   zero-rated and exempt transactions exist and rates change. A tax rate
--   hardcoded into a comparison goes stale silently.
-- ============================================================================

-- -- 1. what the round asked for -------------------------------------------
alter table public.vendor_bid_rounds
  add column if not exists tax_basis text,
  add column if not exists vat_rate  numeric(6,4);

-- The template asks for VAT-inclusive, so that is the default for a new round.
update public.vendor_bid_rounds set tax_basis = 'vat_inclusive' where tax_basis is null;
update public.vendor_bid_rounds set vat_rate  = 0.12            where vat_rate  is null;

alter table public.vendor_bid_rounds
  alter column tax_basis set default 'vat_inclusive',
  alter column vat_rate  set default 0.12;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vendor_bid_rounds_tax_basis_chk') then
    alter table public.vendor_bid_rounds
      add constraint vendor_bid_rounds_tax_basis_chk
      check (tax_basis in ('vat_inclusive','vat_exclusive','non_vat'));
  end if;
end $$;

-- -- 2. what THIS bidder quoted --------------------------------------------
-- NULL = follow the round. Deliberately NOT defaulted and NOT back-filled: a
-- bidder whose basis nobody has confirmed must read as unconfirmed, not as
-- agreeing with the round.
alter table public.vendor_bid_invitations
  add column if not exists tax_basis text,
  add column if not exists vat_rate  numeric(6,4);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vendor_bid_invitations_tax_basis_chk') then
    alter table public.vendor_bid_invitations
      add constraint vendor_bid_invitations_tax_basis_chk
      check (tax_basis is null or tax_basis in ('vat_inclusive','vat_exclusive','non_vat'));
  end if;
end $$;

-- -- 3. verification -- every column must read true --------------------------
select
  exists (select 1 from information_schema.columns
           where table_schema='public' and table_name='vendor_bid_rounds'
             and column_name='tax_basis')                        as round_tax_basis,
  exists (select 1 from information_schema.columns
           where table_schema='public' and table_name='vendor_bid_rounds'
             and column_name='vat_rate')                         as round_vat_rate,
  exists (select 1 from information_schema.columns
           where table_schema='public' and table_name='vendor_bid_invitations'
             and column_name='tax_basis')                        as bidder_tax_basis,
  exists (select 1 from information_schema.columns
           where table_schema='public' and table_name='vendor_bid_invitations'
             and column_name='vat_rate')                         as bidder_vat_rate,
  not exists (select 1 from public.vendor_bid_rounds
               where tax_basis is null or vat_rate is null)      as every_round_has_a_basis,
  -- The bidder override must stay UNSET: null means "follow the round", and a
  -- back-filled value would assert a basis nobody has confirmed.
  not exists (select 1 from public.vendor_bid_invitations
               where tax_basis is not null)                      as bidder_override_left_unset,
  exists (select 1 from pg_constraint
           where conname='vendor_bid_rounds_tax_basis_chk')      as round_check_present,
  exists (select 1 from pg_constraint
           where conname='vendor_bid_invitations_tax_basis_chk') as bidder_check_present;
