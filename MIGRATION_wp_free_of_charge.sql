-- MIGRATION_wp_free_of_charge.sql
-- Run once in the Supabase SQL Editor. Idempotent, additive, safe to re-run.
--
-- FREE-OF-CHARGE AWARDS
-- Some work packages are genuinely awarded at ZERO cost: the vendor provides the
-- scope free of charge. That is a real, closed award with real savings (the whole
-- BCB is never spent) -- NOT a data gap.
--
-- Until now the app could not tell that apart from "Awarded, cost not encoded yet",
-- because window.isMoneyAwarded() required total_awarded > 0 (Known Issue #17). Both
-- cases fell out of the money side of the ledger, so a free award booked no savings
-- and its BCB sat in "Balance to Award" forever.
--
-- WHY AN EXPLICIT FLAG AND NOT "awarded_cost = 0 MEANS FREE":
-- a literal 0 is NOT a reliable signal of intent in this data. On AVR101 alone,
-- WP 35 (Architectural Design) and WP 45 (Gravel Bedding and Lean Concrete Labor
-- Works) already store awarded_cost = 0 with NO vendor -- an importer default on
-- rows whose cost simply was never entered. Inferring "0 = free" would instantly
-- book those as realized savings. The flag has to be something a person ticks.
--
-- SEMANTICS (mirrors not_to_be_awarded's money treatment -- see MIGRATION_not_to_be_awarded.sql):
--   award_status = 'Awarded' AND free_of_charge  ->  counts as money-awarded,
--                                                   effective awarded cost = PHP 0,
--                                                   full BCB counts as savings.
-- Unlike not_to_be_awarded, this flag does NOT stand on its own: it describes an
-- award, so it only takes effect on a WP whose Award Status is actually 'Awarded'.
-- It waives the Awarded Cost requirement but NOT the Awarded Vendor requirement --
-- somebody is providing the scope for free and we record who.
-- Mutually exclusive (enforced in the UI) with not_to_be_awarded and with buyback
-- (there is nothing to recover from a PHP 0 award).

alter table work_packages
  add column if not exists free_of_charge boolean default false;

comment on column work_packages.free_of_charge is
  'Awarded at PHP 0 -- the vendor provides this scope free of charge. A real award with '
  'real savings, as opposed to "Awarded, cost not encoded yet". Only meaningful when '
  'award_status = ''Awarded''. See window.isMoneyAwarded / effectiveAwardedCost in assets/js/db.js.';

-- Existing rows keep false: this flag asserts a business fact and must never be
-- back-filled by inference. In particular do NOT run something like
--   update work_packages set free_of_charge = true where awarded_cost = 0;
-- for exactly the reason given above.

-- The viewer-facing cost-free view must expose this flag, or a viewer's dashboard
-- computes a different awarded set than everyone else's. It is a boolean, not money,
-- so it is safe to expose. This block only REPORTS -- it does not rewrite the view,
-- because rolling that definition forward blind risks dropping a column from it.
do $$
begin
  if exists (select 1 from information_schema.views
             where table_schema = 'public' and table_name = 'wp_view_public')
     and not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'wp_view_public'
                       and column_name = 'free_of_charge') then
    raise notice 'ACTION REQUIRED: add free_of_charge to wp_view_public''s select list (canonical definition lives in MIGRATION_wp_audit_trail.sql), otherwise the viewer role computes a different awarded set than every other role.';
  end if;
end $$;

select 'free_of_charge added' as status,
       count(*) filter (where free_of_charge) as flagged_rows,
       count(*) as total_rows
from work_packages;
