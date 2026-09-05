-- ============================================================================
-- WHICH MIGRATIONS HAVE ACTUALLY BEEN RUN?   read-only, safe any time
-- ----------------------------------------------------------------------------
-- Paste into the Supabase SQL Editor. One row per migration, in run order.
-- `applied` must read `t`. An `f` names a file to run.
--
-- ⚠️ WHY THIS EXISTS, AND WHY IT WAS REWRITTEN (2026-09-05).
--    A migration that has not run does NOT announce itself. The client guards
--    degrade quietly by design, so a missing column or table surfaces as a
--    blank panel or a feature that never appears — never as an error.
--    The previous version of this file covered the VENDOR migrations only. It
--    reported every column `true` while THREE migrations were missing
--    (`bcb_baselines`, `planners_need_by`, `board_view_round_id_fix`), because
--    none of them was in its scope. A partial check that reads all-green is
--    worse than no check. This one covers every migration in the folder.
--
-- ⚠️ Run order matters where noted; migrations/README.md is authoritative.
--    In particular `2026-09-01_vendor_edit_guard_consolidated.sql` must be LAST.
--
-- ⚠️ Rows marked `data fix` test the DATA, not the schema, so they can read `t`
--    on a database where the file never ran, simply because there was nothing
--    to fix. That is a "nothing to do" pass, not proof of execution.
--
-- ⚠️ Rows marked `body` inspect a function's SOURCE TEXT. That proves the
--    definition currently installed, not that a particular file installed it.
-- ============================================================================

with t as (
  select table_name from information_schema.tables where table_schema = 'public'
), v as (
  select table_name from information_schema.views where table_schema = 'public'
), c as (
  select table_name, column_name from information_schema.columns where table_schema = 'public'
), f as (
  select n.nspname as sch, p.proname as fn,
         pg_get_function_identity_arguments(p.oid) as args, p.prosrc as src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'internal')
), pol as (
  select tablename, policyname, cmd,
         coalesce(qual, '') || ' ' || coalesce(with_check, '') as body
    from pg_policies where schemaname = 'public'
), con as (
  select conname, contype, conrelid::regclass::text as tbl, pg_get_constraintdef(oid) as def
    from pg_constraint
), guard as (
  select coalesce((select src from f where sch = 'internal' and fn = 'vendor_edit_guard'), '') as src
)
select ord, migration, note, applied from (

  select '01' as ord, '2026-06-29_add_last_login' as migration, '' as note,
    (select count(*) = 1 from c where table_name='users' and column_name='last_login') as applied

  union all select '02', '2026-06-29_update_status_align_2026', 'data fix',
    (select count(*) = 0 from public.work_packages
      where procurement_status in ('Sourcing','Solicitation','Evaluation & Negotiation'))

  union all select '03', '2026-07-02_update_remove_partially_awarded', 'data fix',
    (select count(*) = 0 from public.work_packages where award_status = 'Partially Awarded')

  union all select '04', '2026-07-06_add_osm', '',
    (select count(*) = 1 from c where table_name='work_packages' and column_name='osm')

  union all select '05', '2026-07-08_rls_hardening', 'users_insert must pin status',
    (select count(*) > 0 from pol
      where tablename='users' and cmd='INSERT' and body like '%pending%')

  union all select '06', '2026-07-08_seed_demo_project', 'sample data',
    (select count(*) = 1 from public.projects where id = 'DEMO')

  union all select '07', '2026-07-09_admin_delete_user', '',
    (select count(*) > 0 from f where sch='public' and fn='admin_delete_user')

  union all select '08', '2026-07-09_specialist_scope_and_viewer_view', 'creates wp_view_public',
    (select count(*) = 1 from v where table_name='wp_view_public')

  union all select '09', '2026-07-09_update_wpno_strip_prefix', 'data fix',
    (select count(*) = 0 from public.work_packages
      where wp_no like 'WP-%' or wp_no like 'WP %')

  union all select '10', '2026-07-14_contributor_wp_delete', 'wp_delete widened past super_admin',
    (select count(*) > 0 from pol
      where tablename='work_packages' and cmd='DELETE' and body like '%manager%')

  union all select '11', '2026-07-23_bcb_baselines', 'was MISSING on 2026-09-05',
    (select count(*) = 3 from c where table_name='work_packages'
       and column_name in ('budget_bcb0','budget_bcb1','budget_bcb2'))

  union all select '11b', '  budget_bcb0 backfilled', 'part of #11',
    (select count(*) = 0 from public.work_packages
      where budget_bcb0 is null and approved_budget_bcb is not null)

  union all select '11c', '  money kept OUT of wp_view_public', 'viewers must never see it',
    (select count(*) = 0 from c
      where table_name='wp_view_public' and column_name like 'budget_bcb%')

  union all select '12', '2026-07-23_wp_audit_trail', 'also rebuilds wp_view_public',
    (select count(*) = 3 from c where table_name='work_packages'
       and column_name in ('updated_at','updated_by','updated_by_name'))

  union all select '13', '2026-08-03_not_to_be_awarded', '',
    (select count(*) = 1 from c
      where table_name='work_packages' and column_name='not_to_be_awarded')

  union all select '14', '2026-08-03_viewer_budget_role', 'users_role_check must allow it',
    (select count(*) > 0 from con
      where tbl='users' and contype='c' and def like '%viewer_budget%')

  union all select '15', '2026-08-06_project_group_head', '',
    (select count(*) = 1 from c where table_name='projects' and column_name='group_head')

  union all select '16', '2026-08-10_vendor_management', 'FIRST of the 08-10 group',
    (select count(*) = 5 from t where table_name in
      ('vendors','vendor_products','vendor_certifications','vendor_personnel','vendor_rates'))

  union all select '17', '2026-08-10_vendor_invite_rls_fix', 'after #16',
    (select count(*) > 0 from f where sch='internal' and fn='vendor_invite_valid')

  union all select '18', '2026-08-10_vendor_merge', '',
    (select count(*) = 3 from f where sch='public' and fn in
      ('merge_vendors','delete_vendor_cascade','delete_vendors_cascade'))

  union all select '19', '2026-08-10_vendor_phase2b', '',
    (select count(*) = 1 from t where table_name='vendor_bids')

  union all select '20', '2026-08-10_vendor_product_type', '',
    (select count(*) = 1 from c where table_name='vendor_products' and column_name='item_type')

  union all select '21', '2026-08-10_vendor_rates_wp_link', '',
    (select count(*) = 1 from c where table_name='vendor_rates' and column_name='wp_id')

  union all select '22', '2026-08-10_vendor_rates_wp_link_fix', 'FULL unique, not a partial index',
    (select count(*) > 0 from con where tbl='vendor_rates' and contype='u'
       and def like '%vendor_id%' and def like '%wp_id%')

  union all select '23', '2026-08-10_wp_proposed_vendor_ids', '',
    (select count(*) = 1 from c
      where table_name='work_packages' and column_name='proposed_vendor_ids')

  union all select '24', '2026-08-11_wp_awarded_vendor_ids', 'index-aligned pair',
    (select count(*) = 2 from c where table_name='work_packages'
       and column_name in ('awarded_vendor_ids','awarded_vendor_amounts'))

  union all select '25', '2026-08-11_wp_buyback', '',
    (select count(*) = 3 from c where table_name='work_packages'
       and column_name in ('buyback','buyback_depreciation_percent','buyback_amount'))

  union all select '26', '2026-08-13_vendor_code', '',
    (select count(*) = 1 from c where table_name='vendors' and column_name='vendor_code')

  union all select '27', '2026-08-19_vendor_accreditation', '',
    (select count(*) = 3 from c where table_name='vendors'
       and column_name in ('accreditation','accreditation_notes','accreditation_date'))

  union all select '28', '2026-08-20_planners_need_by', 'was MISSING on 2026-09-05',
    (select count(*) = 1 from t where table_name='planners_need_by')

  union all select '28b', '  need_by is read-only to clients', 'the Edge Function owns it',
    (select count(*) = 0 from pol where tablename='planners_need_by' and cmd <> 'SELECT')

  union all select '29', '2026-08-20_product_taxonomy', '',
    ((select count(*) = 1 from t where table_name='product_taxonomy')
     and (select count(*) = 1 from c
           where table_name='vendor_products' and column_name='taxonomy_id'))

  union all select '30', '2026-08-20_vendor_accreditation_requests', 'also creates vendor_documents',
    (select count(*) = 2 from t
      where table_name in ('vendor_documents','vendor_accreditation_requests'))

  union all select '31', '2026-08-20_vendor_edited_flag', '',
    (select count(*) = 1 from c where table_name='vendors' and column_name='vendor_edited_at')

  union all select '32', '2026-08-20_vendor_field_ownership', 'body: guard pins name/notes/tin',
    (select src like '%new.name%' and src like '%new.notes%' and src like '%new.tin%' from guard)

  union all select '33', '2026-08-20_vendor_self_view', 'vendors read AND write through it',
    (select count(*) = 1 from v where table_name='vendor_self_view')

  union all select '34', '2026-08-25_planners_vendor_performance', '',
    (select count(*) = 1 from t where table_name='planners_vendor_performance')

  union all select '35', '2026-08-25_wp_free_of_charge', '',
    (select count(*) = 1 from c where table_name='work_packages' and column_name='free_of_charge')

  union all select '36', '2026-08-26_planners_packages', '',
    ((select count(*) = 1 from t where table_name='planners_packages')
     and (select count(*) = 1 from c
           where table_name='work_packages' and column_name='planners_package_id'))

  union all select '37', '2026-09-01_vendor_child_soft_delete', 'archive, not delete',
    (select count(*) = 1 from c where table_name='vendor_products' and column_name='archived_at')

  union all select '37b', '  vendor cannot DELETE its child rows', 'the point of #37',
    (select count(*) = 0 from pol
      where tablename='vendor_products' and cmd='DELETE' and body like '%get_my_vendor_id%')

  union all select '38', '2026-09-01_vendor_child_audit_trail', 'MUST follow #37',
    ((select count(*) = 1 from c
       where table_name='vendor_products' and column_name='created_by')
     and (select count(*) > 0 from f where sch='internal' and fn='stamp_child_audit'))

  union all select '39', '2026-09-01_vendor_doc_lock', 'after #37 and #38',
    (select count(*) = 1 from c where table_name='vendor_documents' and column_name='locked_at')

  union all select '40', '2026-09-01_vendor_self_registration', 'after #37-#39',
    ((select count(*) = 1 from t where table_name='vendor_claims')
     and (select count(*) > 0 from f where sch='public' and fn='submit_vendor_claim'))

  union all select '41', '2026-09-01_vendor_history_restore', 'after #37-#39',
    ((select count(*) = 1 from t where table_name='vendor_history')
     and (select count(*) > 0 from f where sch='public' and fn='restore_vendor_to'))

  union all select '41b', '  history is append-only', 'no write policy at all',
    (select count(*) = 0 from pol where tablename='vendor_history' and cmd <> 'SELECT')

  union all select '42', '2026-09-02_vendor_catalogue', '',
    ((select count(*) = 1 from c where table_name='vendor_products' and column_name='brand')
     and (select count(*) = 1 from c
           where table_name='vendors' and column_name='can_surety_bond'))

  union all select '42b', '  capability visible to the vendor', 'RE-RUN #33 if false',
    (select count(*) = 1 from c
      where table_name='vendor_self_view' and column_name='can_surety_bond')

  union all select '43', '2026-09-03_vendor_owner_and_logo', 'required accreditation items',
    (select count(*) = 3 from c where table_name='vendors'
       and column_name in ('owner_name','owner_contact_number','logo_path'))

  union all select '43b', '  owner visible to the vendor', 'rebuilds vendor_self_view itself',
    (select count(*) = 1 from c where table_name='vendor_self_view' and column_name='owner_name')

  union all select '44', '2026-09-03_vendor_claim_tin_only', 'DROPS the 5-arg overload',
    (select count(*) = 1 from f where sch='public' and fn='submit_vendor_claim')

  union all select '45', '2026-09-03_vendor_country', '',
    ((select count(*) = 1 from c where table_name='vendors' and column_name='country')
     and (select count(*) = 1 from c
           where table_name='vendor_self_view' and column_name='country'))

  union all select '46', '2026-09-03_vendor_bid_board', 'invitation-only by design',
    ((select count(*) = 1 from t where table_name='vendor_bid_invitations')
     and (select count(*) = 1 from v where table_name='vendor_bid_board_view'))

  union all select '47', '2026-09-04_bid_process', 'BP 2.2 to 2.4',
    ((select count(*) = 2 from t
       where table_name in ('vendor_bid_rounds','vendor_bid_clarifications'))
     and (select count(*) > 0 from f where sch='public' and fn='bid_by_token'))

  union all select '47b', '2026-09-04_bid_one_quotation', 'body: one quotation, not two envelopes',
    (select count(*) > 0 from f
      where sch='public' and fn='submit_bid_by_token' and src like '%attachment%')

  union all select '47c', '2026-09-04_bid_negotiated_quotation', '',
    (select count(*) = 1 from c
      where table_name='vendor_bid_invitations' and column_name='negotiated_doc_path')

  union all select '47d', '2026-09-04_vendor_personnel_owner', '',
    (select count(*) = 1 from c where table_name='vendor_personnel' and column_name='is_owner')

  union all select '47e', '2026-09-04_bid_simplify', 'approved Procurement Status wording',
    ((select count(*) = 1 from c
       where table_name='vendor_bid_invitations' and column_name='technical_compliant')
     and (select count(*) = 1 from c
           where table_name='vendor_bid_clarifications' and column_name='category'))

  union all select '47f', '2026-09-05_bid_reference_docs', 'what a bidder prices against',
    (select count(*) = 2 from t where table_name in ('vendor_bid_documents','vendor_bid_items'))

  union all select '47g', '2026-09-05_board_view_drop_token', 'access_token must be ABSENT',
    (select count(*) = 0 from c
      where table_name='vendor_bid_board_view' and column_name='access_token')

  union all select '47h', '2026-09-05_board_view_round_id_fix', 'was MISSING on 2026-09-05',
    (select count(*) = 1 from c
      where table_name='vendor_bid_board_view' and column_name='round_id')

  union all select '47i', '2026-09-05_class_codes', 'Finance chart of accounts',
    ((select count(*) = 1 from t where table_name='class_codes')
     and (select count(*) = 1 from c
           where table_name='work_packages' and column_name='class_code'))

  union all select '47j', '  class codes are SEEDED', 'SEED_class_codes.sql, git-ignored',
    (select count(*) > 100 from public.class_codes)

  union all select '47k', '2026-09-05_vendor_push', 'web push',
    (select count(*) = 2 from t
      where table_name in ('vendor_push_subscriptions','vendor_push_outbox'))

  -- ⚠️ MUST BE LAST. Five migrations each defined this trigger and the last two
  --    branched from different ancestors, so whichever ran last silently
  --    disabled part of the other. Amended 2026-09-03 to STOP pinning
  --    payment_terms, which is a required accreditation item a vendor has to be
  --    able to fill — so the absence of that pin is itself asserted.
  union all select '48', '2026-09-01_vendor_edit_guard_consolidated', 'body: MUST RUN LAST',
    (select src like '%new.status%' and src like '%new.vendor_edited_at%'
        and src like '%new.name%' and src like '%new.accreditation%' from guard)

  union all select '48b', '  payment_terms left to the vendor', 'the 2026-09-03 amendment',
    (select src not like '%new.payment_terms %' and src not like '%new.payment_terms;%'
       from guard)

) x order by ord;
