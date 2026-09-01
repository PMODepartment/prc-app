# Database migrations — Megawide WPM Dashboard

Every one-off SQL script that has been run against Supabase lives here, named
`YYYY-MM-DD_<name>.sql` where the date is **the day the file was first committed**
(recovered from `git log --diff-filter=A`, not the filesystem mtime, which OneDrive
sync and checkouts make meaningless).

`supabase-schema.sql` stays in the repo root — it is the reference schema, not a
migration.

---

## ⚠️ Filename order is NOT run order

Sorting the folder gets you *close*, but it is wrong in at least two places: eight
files share `2026-08-10`, and alphabetically `vendor_invite_rls_fix` sorts **before**
`vendor_management` — yet it depends on the tables that file creates. A date prefix
cannot encode within-day sequence. The same trap catches
`2026-09-01_vendor_child_audit_trail.sql`, which must run AFTER
`2026-09-01_vendor_child_soft_delete.sql` but sorts before it.

**The ordered list below is authoritative.** If you are rebuilding a database from
scratch, run them in exactly this order.

---

## Run order

| # | File | Notes |
|---|---|---|
| 1 | `2026-06-29_add_last_login.sql` | |
| 2 | `2026-06-29_update_status_align_2026.sql` | data fix |
| 3 | `2026-07-02_update_remove_partially_awarded.sql` | data fix — clears partial award costs |
| 4 | `2026-07-06_add_osm.sql` | |
| 5 | `2026-07-08_rls_hardening.sql` | closes a privilege-escalation hole in `users_insert`/`users_update` |
| 6 | `2026-07-08_seed_demo_project.sql` | sample data for the read-only `DEMO` project |
| 7 | `2026-07-09_admin_delete_user.sql` | `admin_delete_user()` RPC |
| 8 | `2026-07-09_specialist_scope_and_viewer_view.sql` | creates `wp_view_public`; **after** #5 |
| 9 | `2026-07-09_update_wpno_strip_prefix.sql` | data fix |
| 10 | `2026-07-14_contributor_wp_delete.sql` | widens `wp_delete` RLS |
| 11 | `2026-07-23_bcb_baselines.sql` | |
| 12 | `2026-07-23_wp_audit_trail.sql` | also recreates `wp_view_public` — **after** #8 |
| 13 | `2026-08-03_not_to_be_awarded.sql` | |
| 14 | `2026-08-03_viewer_budget_role.sql` | |
| 15 | `2026-08-06_project_group_head.sql` | |
| 16 | `2026-08-10_vendor_management.sql` | **⚠️ FIRST of the 08-10 group** — creates every vendor table, all vendor RLS, the `vendor-certs` bucket |
| 17 | `2026-08-10_vendor_invite_rls_fix.sql` | **after #16** |
| 18 | `2026-08-10_vendor_merge.sql` | `merge_vendors` / `delete_vendor_cascade` / `delete_vendors_cascade` |
| 19 | `2026-08-10_vendor_phase2b.sql` | `work_packages.vendor_id`, `vendor_bids` |
| 20 | `2026-08-10_vendor_product_type.sql` | |
| 21 | `2026-08-10_vendor_rates_wp_link.sql` | |
| 22 | `2026-08-10_vendor_rates_wp_link_fix.sql` | **must follow #21** — replaces its partial unique index with a full constraint |
| 23 | `2026-08-10_wp_proposed_vendor_ids.sql` | |
| 24 | `2026-08-11_wp_awarded_vendor_ids.sql` | index-aligned `awarded_vendor_ids` + `awarded_vendor_amounts` |
| 25 | `2026-08-11_wp_buyback.sql` | |
| 26 | `2026-08-13_vendor_code.sql` | |
| 27 | `2026-08-19_vendor_accreditation.sql` | |
| 28 | `2026-08-20_planners_need_by.sql` | mirror table pushed by the Planners app |
| 29 | `2026-08-20_product_taxonomy.sql` | |
| 30 | `2026-08-20_vendor_accreditation_requests.sql` | also creates `vendor_documents` |
| 31 | `2026-08-20_vendor_edited_flag.sql` | |
| 32 | `2026-08-20_vendor_field_ownership.sql` | |
| 33 | `2026-08-20_vendor_self_view.sql` | **after #32** — vendors read *and write* through `vendor_self_view` |
| 34 | `2026-08-25_planners_vendor_performance.sql` | mirror table pushed by the Planners app |
| 35 | `2026-08-25_wp_free_of_charge.sql` | |
| 36 | `2026-08-26_planners_packages.sql` | mirror table pushed by the Planners app |
| 37 | `2026-09-01_vendor_child_soft_delete.sql` | takes DELETE from the vendor role; adds `archived_at` |
| 38 | `2026-09-01_vendor_child_audit_trail.sql` | **must follow #37** — supersedes its `stamp_archived()` trigger. Sorts BEFORE it alphabetically (“audit” < “soft”), so this is the second place filename order is wrong |
| 39 | `2026-09-01_vendor_doc_lock.sql` | **after #37 and #38** — freezes the documents an approved accreditation rests on; back-fills already-accredited vendors |
| 40 | `2026-09-01_vendor_self_registration.sql` | **after #37–#39** — one public registration URL, the claim queue, and the RPCs that grant access. Opens registration up, so the three hardening migrations above are what make it safe |
| 41 | `2026-09-01_vendor_edit_guard_consolidated.sql` | **⚠️ MUST BE LAST — see below** |

---

## ⚠️ `2026-09-01_vendor_edit_guard_consolidated.sql` is special

Five separate migrations each `create or replace`d `internal.vendor_edit_guard()`,
and the last two branched from **different ancestors** without being supersets of
each other — so whichever ran last silently disabled part of the other. The
consolidated file is the union of all of them and is now the **only** place that
function is defined.

**Run it after every other vendor migration, and never re-run #16, #27, #31, #32
or #33 afterwards** — each would replace the function body with its own narrower
version and reintroduce the regression. Their *other* statements are still current;
it is only their guard block that is superseded.

(#40 sorts after it alphabetically but never touches the guard, so their order is
immaterial — what matters is that it follows the five that DO define the guard.)

Its section 6 is a verification `SELECT` whose every column must read `t`. That is
also how you diagnose a database where an older migration has been re-run on top.

---

## Conventions

- **Idempotent.** Everything here is written to be safe to re-run (`if not exists`,
  `drop policy if exists` before `create policy`, guarded `do $$` blocks) — with the
  one ordering caveat above.
- **Written for the Supabase SQL Editor**, which does **not** run a script as a single
  transaction and may pool statements across backends. So: **no temp tables and no
  state carried between statements.** A script that depends on session state passes
  `psql -f` (one session for the whole file) and then fails in the editor — that
  exact bug bit `SEED_vendor_accreditation.sql`. Validate the way it will be run.
- Most end with a verification `SELECT`. Run it.

## Real-data seeds are deliberately absent

`seed_vendor_accreditation`, `seed_vendor_accreditation_pass2` and
`seed_vendor_masterlist` are **git-ignored and must stay that way.** They embed
~2,400 real vendor names, TINs, contacts and addresses, and **GitHub Pages serves
this entire repo publicly** — committing one republishes the vendor masterdata at
`pmodepartment.github.io`, bypassing auth and RLS. Regenerate them locally from the
workbook with the (also ignored) `gen_*.py` scripts.

`.gitignore` carries a glob guard (`SEED_vendor_*.sql`, `*seed_vendor_*.sql`) so a
regenerated seed is caught **whatever** prefix or folder it lands in. Do not remove
it: the bare filenames it sits beside would not match a file renamed to this
folder's date-first convention.
