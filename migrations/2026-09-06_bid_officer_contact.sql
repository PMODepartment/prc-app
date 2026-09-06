-- ─────────────────────────────────────────────────────────────────────────────
-- The round's contact is MEGAWIDE PROCUREMENT, and it carries a number
--
-- The ask already recorded a contact person and email, labelled just "Contact".
-- On a page that also holds every BIDDER's contact person, that is ambiguous in
-- exactly the wrong direction: a vendor reading the RFQ has to work out whose
-- details they are looking at. They are the procurement officer's, and the
-- screen now says so.
--
-- A phone number is added because that is how a vendor with a question about a
-- quotation actually gets in touch before the deadline. The RFQ template's
-- signature block already prints one from `users.mobile_number`; this is the
-- round's own, so a round handled by somebody else, or by a shared desk line,
-- can say so without editing the officer's profile.
--
-- ⚠️ NOTHING IS BACK-FILLED. A blank number means nobody has said what it is;
--    inventing one from the creating officer's profile retroactively would put
--    a number in front of vendors that nobody chose to publish.
--
-- Run once. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.vendor_bid_rounds
  add column if not exists contact_number text;

comment on column public.vendor_bid_rounds.contact_number is
  'Megawide procurement officer''s contact number for this round. Shown to '
  'bidders in the RFQ. Defaults from the creating officer''s users.mobile_number '
  'at creation; blank means none was published.';

-- verification: must read true
select
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'vendor_bid_rounds'
            and column_name = 'contact_number') as contact_number_present;
