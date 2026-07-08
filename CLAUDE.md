# Megawide EPC Procurement â€” WPM Dashboard

## Project Overview
Work Package Management (WPM) Dashboard for Megawide Construction Corporation EPC projects. Tracks procurement work packages, award status, budgets, and contractors across multiple projects.

**Live URL:** https://pmodepartment.github.io/prc-app (login: `/login.html`)
**Staging URL:** https://fmlozano-pmo.github.io/prc-app-dev (login: `/login.html`)
**Stack:** Vanilla HTML/CSS/JS (no build step) + Supabase (PostgreSQL + Auth) + GitHub Pages hosting
**GitHub (prod):** https://github.com/PMODepartment/prc-app
**GitHub (staging):** https://github.com/fmlozano-pmo/prc-app-dev â€” branch `staging`, push via `git push dev staging:main`
**Supabase (prod):** `https://cayjeqeleenizbdzrums.supabase.co`
**Supabase (staging):** `https://duivwgmjcbxtfagkiqyj.supabase.co`

---

## Architecture

No build step â€” edit files directly, push to GitHub, GitHub Pages auto-deploys (~1â€“2 min).

### Key Files
| File | Purpose |
|---|---|
| `assets/js/auth.js` | Supabase auth wrapper â€” `AppAuth.requireLogin()`, `AppAuth.requireAdmin()`, `getSB()`, profile cache |
| `assets/js/db.js` | All DB operations via `WPDb.*` â€” also `computeStats()`, `Fmt.*`, `renderUserBar()` |
| `assets/js/ui.js` | Shared UI helpers â€” sidebar init, modals, toast, hamburger menu, iOS pinch-zoom prevention |
| `assets/css/dashboard.css` | Global styles, CSS variables, responsive breakpoints, view-tabs, mobile fixes |
| `supabase-schema.sql` | Full DB schema for reference |
| `assets/js/onboarding.js` | Role-aware guided-tour modal (`window.Onboarding`) â€” auto-opens on first login, re-openable via topbar **?** button. Self-contained (injects own CSS, follows dark mode via CSS vars). |
| `onboarding.html` | Standalone 13-slide onboarding deck for training (keyboard nav, F=fullscreen, P=print). Not wired into the app. |
| `WPM_Dashboard_Onboarding.pptx` | Editable PowerPoint version of the onboarding deck (same content). |

> `assets/js/` files are canonical. Root-level copies (`auth.js`, `db.js`, `ui.js`) are **not referenced by any page** â€” do not edit them.

### Pages
| File | Auth | Purpose |
|---|---|---|
| `login.html` | public | Sign-in + Step 2 project picker. Shows Portfolio Overview card (admins), project list, Add New Project (admin/super_admin). On create â†’ `project.html?id=<newId>`. |
| `register.html` | public | Self-registration (creates `pending` user) |
| `pending.html` | public | Shown to unapproved users |
| `forgot-password.html` | public | Password reset â€” `redirectTo` points to `/prc-app/login.html` |
| `index.html` | user | Portfolio Overview â€” consolidated dashboard, 6 tabs (Dashboard tab merged into Overview) |
| `project.html` | user | Single project dashboard â€” 3 tabs |
| `wp-form.html` | user | Add / edit work package |
| `review.html` | user+ | View WP submissions for assigned projects; admins can approve/reject |
| `admin.html` | admin + manager | User management + project management (admin/super_admin); Performance tab (all three roles) |
| `claim-form.html` | user | Add / edit claim or CO â€” **hidden feature, not yet active** |
| `my-wps.html` | user | Officer's WP list |
| `project-selector.html` | user | Standalone picker â€” **unused, not linked** |

---

## Database (Supabase)

**URL:** `https://cayjeqeleenizbdzrums.supabase.co`

### Tables
- **`projects`** â€” `id` (text PK e.g. 'AVR101'), name, location, status, budget_bcb, start_date, end_date
- **`users`** â€” `id` (UUID FK â†’ auth.users), name, email, role (`super_admin|admin|user|viewer`), status (`pending|approved|rejected`), projects (text[]), last_login
- **`work_packages`** â€” all WP fields. **Generated columns (never INSERT into):** `total_awarded` (= `awarded_cost + additionals`), `awarding_lead_time` (= `actual_awarding_date - awarding_date`), `variance` (= `approved_budget_bcb - total_awarded`). Use `awarded_cost` and `lead_time` instead. `unmap()` in `db.js` strips all three automatically.
- **`claims`** â€” `id`, `project_id`, `claim_no`, `claim_type`, `party` (`Client|Vendor`), `description`, `wp_no`, `contractor`, `date_filed`, `amount_claimed`, `basis`, `status`, `approved_amount`, `date_resolved`, `review_status`, `review_notes`, `remarks`, `submitted_by`

### WPDb API (db.js)
```js
WPDb.getProjects()                         // all projects
WPDb.getProject(id)
WPDb.createProject(data)
WPDb.updateProject(id, data)
WPDb.archiveProject(id)                    // sets status='archived'
WPDb.unarchiveProject(id)
WPDb.deleteProject(id)                     // also deletes all WPs

WPDb.getApprovedWPs(pid)                   // approved WPs for one project
WPDb.getAllApprovedWPs()                   // all approved WPs (single query)
WPDb.getApprovedWPsForProjects(ids)        // approved WPs for array of IDs â€” avoids N+1
WPDb.getAllWPs(pid)                        // all WPs regardless of status
WPDb.getPendingWPs()                       // pending_review WPs (admin)
WPDb.submitWP(data, user)                  // inserts with review_status='pending_review'; throws on error
WPDb.updateWP(id, data)                    // update (resets to pending_review); throws on error
WPDb.updateWPDirect(id, data)             // update without status change; throws on error
WPDb.approveWP(id)
WPDb.rejectWP(id, _, reason)
WPDb.deleteWP(id)                          // permanently deletes one WP; throws on error
WPDb.getAllUsers()
WPDb.updateUser(id, updates)
WPDb.updateLastLogin(userId)
```

### Auth Flow
1. `getSB()` â€” returns `window.__sb` (Supabase client, UMD bundle, created synchronously on page load)
2. `AppAuth.requireLogin(cb)` â€” checks session â†’ loads profile from `sessionStorage` cache (`wpm_prof_{userId}`) or fetches from DB â†’ checks `status === 'approved'` â†’ calls cb(user, profile)
3. `AppAuth.requireAdmin(cb)` â€” wraps `requireLogin`, requires role in `['admin', 'super_admin']`
4. `AppAuth.logout()` â€” clears `wpm_prof_*` sessionStorage keys, signs out, redirects to login
5. Role in `window.__wpmRole`, profile in `window.__profile`

### Supabase Settings
- **Email confirmation disabled** â€” users go straight to `pending` for admin approval
- **Free tier cold start:** Pauses after 7 days inactivity â†’ 5â€“30s delay. Use UptimeRobot (ping every 3â€“4 days) to prevent.
- **Email rate limit:** ~3 auth emails/hour on free tier. Use custom SMTP (Resend/Brevo) for reliability.

---

## DB Migrations â€” Run in Supabase SQL Editor (all IF NOT EXISTS, safe to re-run)

```sql
-- WP form fields
ALTER TABLE work_packages ADD COLUMN IF NOT EXISTS works text DEFAULT NULL;
ALTER TABLE work_packages ADD COLUMN IF NOT EXISTS type_of_works text DEFAULT NULL;
ALTER TABLE work_packages ADD COLUMN IF NOT EXISTS scope text DEFAULT NULL;
ALTER TABLE work_packages ADD COLUMN IF NOT EXISTS actual_delivery date DEFAULT NULL;
ALTER TABLE work_packages ADD COLUMN IF NOT EXISTS type_of_service text DEFAULT NULL;
ALTER TABLE work_packages ADD COLUMN IF NOT EXISTS charging_type text DEFAULT NULL;
ALTER TABLE work_packages ADD COLUMN IF NOT EXISTS contract_package_no text DEFAULT NULL;
ALTER TABLE work_packages ADD COLUMN IF NOT EXISTS co_description text DEFAULT NULL;
-- Bond / payment / retention
ALTER TABLE work_packages ADD COLUMN IF NOT EXISTS surety_bond text DEFAULT 'No';
ALTER TABLE work_packages ADD COLUMN IF NOT EXISTS performance_bond text DEFAULT 'No';
ALTER TABLE work_packages ADD COLUMN IF NOT EXISTS warranty_bond text DEFAULT 'No';
ALTER TABLE work_packages ADD COLUMN IF NOT EXISTS payment_terms_days integer;
ALTER TABLE work_packages ADD COLUMN IF NOT EXISTS dp_percent numeric(5,4);
ALTER TABLE work_packages ADD COLUMN IF NOT EXISTS dp_terms text;
ALTER TABLE work_packages ADD COLUMN IF NOT EXISTS dp_release_date date;
ALTER TABLE work_packages ADD COLUMN IF NOT EXISTS dp_amount numeric(18,2);
ALTER TABLE work_packages ADD COLUMN IF NOT EXISTS retention_percent numeric(5,4);
ALTER TABLE work_packages ADD COLUMN IF NOT EXISTS retention_amount numeric(18,2);
ALTER TABLE work_packages ADD COLUMN IF NOT EXISTS approver_name text;
ALTER TABLE work_packages ADD COLUMN IF NOT EXISTS approval_date date;
ALTER TABLE work_packages ADD COLUMN IF NOT EXISTS submittal_document_type text;
-- Columns missing from original live DB
ALTER TABLE work_packages ADD COLUMN IF NOT EXISTS approver text DEFAULT NULL;
ALTER TABLE work_packages ADD COLUMN IF NOT EXISTS support_team text DEFAULT NULL;
ALTER TABLE work_packages ADD COLUMN IF NOT EXISTS delivery_status text DEFAULT 'Not Awarded';
ALTER TABLE work_packages ADD COLUMN IF NOT EXISTS submittal_type text DEFAULT 'Not Required';
ALTER TABLE work_packages ADD COLUMN IF NOT EXISTS dp_notes text DEFAULT NULL;
ALTER TABLE work_packages ADD COLUMN IF NOT EXISTS retention_period text DEFAULT NULL;
ALTER TABLE work_packages ADD COLUMN IF NOT EXISTS awarding_status text DEFAULT NULL;
ALTER TABLE work_packages ADD COLUMN IF NOT EXISTS purchase_request text DEFAULT NULL;
ALTER TABLE work_packages ADD COLUMN IF NOT EXISTS osm text DEFAULT 'No';   -- OSM flag (Yes/No), filterable in WP List
-- Users: activity tracking. WITHOUT this, getAllUsers() returns last_login=undefined for
-- every row and admin.html shows EVERY approved user as "Active" (the activity badge
-- degrades gracefully when the column is missing). auth.js/login.html already write it.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login timestamptz;
-- Viewer role
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('super_admin','admin','user','viewer'));
```

> The live DB was created from an early schema version. Any "column not found" error means a column needs to be added above â€” all statements are idempotent.

---

## Role-Based Access Control

| Role | Projects Visible | Edit WPs | Auto-Approve | Admin Rights | Cost Data |
|---|---|---|---|---|---|
| `super_admin` | All | All | âœ… | Full | âœ… |
| `admin` | All | All | âœ… | Users + Projects | âœ… |
| `specialist` | All (read) | Assigned only | âœ… | None | âœ… |
| `manager` | Assigned | Assigned | âœ… | None | âœ… |
| `user` | Assigned | Assigned | ✅ | None | ✅ |
| `viewer` | Assigned | None | â€” | None | âŒ |

**Auto-approve roles** (`AppAuth.isAutoApprove(profile)`): `super_admin`, `admin`, `specialist`, `manager`, `user` (added 2026-07 — regular users add/edit/delete WPs freely, no manager/WP-approver sign-off; only `viewer` is read-only) **Archived projects are READ-ONLY for everyone** (incl. admins — they can only unarchive): `project.html` sets `window.__archived` + `body.archived-readonly` (CSS hides `#add-wp-link`/`#sidebar-tools`/`#status-tracker`; edit/delete links gated by `window.__archived`), and `openAddWPModal`/`saveQuickWP`/`updateWpStatus`/`deleteWPFromDetail`/`importWPsFromCSV` all early-return when archived; `wp-form.html` `submitForm()`/`deleteCurrentWP()` block if the selected project's status is `archived`. In the **Portfolio Overview** archived projects start **UNSELECTED** (`_activeIds` excludes `status==='archived'`) so they're out of the charts by default (their pill can still be toggled on). The **project-filter label** (`updateFilterLabel`) counts against **active (non-archived) projects only** — reads `"N of M active projects selected"` (e.g. `6 of 6 active projects selected`, not `6 of 7 projects selected`), appending ` (+K archived)` only when archived pills are toggled on. â€” WPs save directly as `approved`; no `pending_review` step.

**Specialist** sees all projects in login picker and `index.html` (same as admin) but `canAccessProject()` still limits editing to `profile.projects`. Uses `getAllApprovedWPs()` (single query, no N+1).

**Viewer restrictions** (`body.viewer-mode` + `window.__isViewer`): cost KPIs hidden, Budget tab hidden, Financial WP List tab hidden, cost columns excluded via `_getActiveCols()`/`getActiveCols()`, Add WP + Edit buttons hidden, Tools section hidden, `wp-form.html` redirects immediately. **Viewers must not see ANY budget / cost / award-amount in charts, graphs or tables** — enforced by `body.viewer-mode` CSS rules in BOTH pages plus a few JS guards. Hidden for viewers: the **Top 5 panels** (`.top5-row` — High Value / Savings / Overbudget), the **% Awarded by Value** battery (`#ov-battery-val` / `#idx-ov-battery-val` — the **% by WP** battery + count stats table stay), the **Procurement Budget (BCB) & Awarded by Period** chart panels (`#dash-period-panel`/`#idx-dash-period-panel`) and the **backlog period** chart panels (`#backlog-period-panel`/`#idx-bl-period-panel`), the **WP-List Filtered Analysis** (project `#pwa-analysis` via JS, portfolio `#wp-mon-analysis` via CSS), the **Status Tracker** (`#status-tracker`, JS), the project **Budget** + **Works** tabs (`#tab-works`/`#tab-works-btn`, plus a `switchTab` redirect to overview), the Schedule **Budget** data-mode toggle (`#sch-btn-budget` — chart stays in #WPs count mode), the backlog-table budget column (project `#backlog-table` col 6, portfolio `#bl-table` col 7), the portfolio **project-table Budget column** (`#proj-data-table` col 7) and the **project-card Budget/Awarded ₱ line** (guarded by `window.__isViewer` in `renderProjectCard`). When adding any new money-bearing chart/panel/column, add a matching `body.viewer-mode` hide rule.

**Admin role restriction**: admins cannot assign `super_admin` or `specialist` roles to other users (only `super_admin` can).

**User â†’ Manager assignment**: `assigned_admin` DB column stores the manager's UUID. `admin.html` uses `WPDb.getManagerUsers()` to populate the dropdown (role=`manager` only). The "Assign to Manager" section is visible to `super_admin` only. Column header in user table shows "Manager".

**DB constraint** (run in Supabase SQL Editor):
```sql
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('super_admin','admin','specialist','manager','user','viewer'));
```

Both approval modal (`modalRoleSelect`) and Change Role modal (`crm-role-select`) in `admin.html` include all 6 roles.

---

## Navigation & Sidebar

**Collapsible sidebar + topbar logo** (`initMobileMenu` in `ui.js`, central â€” applies to every page with a `.topbar`): the `.btn-menu` hamburger is now visible on **all** sizes. On desktop/tablet (â‰¥768px) it toggles `body.sidebar-collapsed` (CSS slides `.sidebar` out via `translateX(-100%)` and sets `.main { margin-left:0 }` to reclaim the space); state persisted in `localStorage.wpm_sidebar_collapsed` and restored on load with a `.no-transition` guard to avoid a slide animation on first paint. On mobile (<768px) the hamburger still opens the slide-in drawer + overlay. `initMobileMenu` also injects the **Megawide mark** (`assets/img/megawide-mark.png`, `.topbar-logo`, ~26px) into `.topbar-left` right after the menu button (idempotent) â€” mirrors the Planning App topbar (hamburger + mark + title).

**Nav context** (`sessionStorage` key `wpm_nav_ctx`): stores project ID or `'consolidated'`. Set by `project.html` and `index.html`; read by `admin.html` and `review.html` for context-aware sidebar.

### Sidebar per Page

**`project.html`**
```
Current Project â†’ [project name]
Work Packages â†’ Add Work Package | Review WPs (admin, pending badge)
Claims & Change Order Register â†’ HIDDEN (display:none)
Tools â†’ Download Template
Admin (admin only) â†’ Portfolio Overview | User Management | Pinned/Recent Projects
```

**`wp-form.html`**
```
Current Project â†’ Back to [project]
Work Packages â†’ WP Form | Review WPs (admin)
Navigation â†’ Portfolio Overview
Tools â†’ Download Template
Admin (admin only) â†’ User Management
```

**`review.html`**
```
Overview â†’ Portfolio Overview
Current Project â†’ Back to [project] (project context only)
Projects â†’ [list]
Work Packages â†’ Add Work Package | Review WPs (active)
Admin â†’ User Management
```

**`admin.html`** â€” consolidated context
```
Projects â†’ [searchable list] | New Project
Admin â†’ User Management (active) | Portfolio Overview
```

**`admin.html`** â€” project context
```
Current Project â†’ Back to [project]
Admin â†’ User Management (active) | Portfolio Overview
```

**Key rules:**
- "Add Work Package" must NOT appear in `admin.html`
- `admin.html` uses plain project links (no pin/star)
- `project.html` and `review.html` use `SidebarPrefs.projectLink()`
- `SidebarPrefs`: pins in `localStorage` key `wpm_sidebar_{userId}`; `window.__sidebarRefresh` callback re-renders after pin toggle

---

## Consolidated Dashboard (index.html)

Single Supabase query: `getAllApprovedWPs()` (admin) or `getApprovedWPsForProjects(ids)` (user). **Never revert to per-project N+1 calls.**

Lazy rendering: `_rendered` flags per tab â€” charts render on first open, reset on filter change.

**Tabs** (Claims tab hidden):

| Tab | Key content |
|---|---|
| Overview | Mirrors the per-project Overview layout (**Dashboard tab removed** â€” merged here). Top row: Cost Overview **4 KPIs (BCB, Actual Award, Balance to Award [amount + WP qty remaining], Savings / Loss [â‚± + %]) â€” matches the per-project Overview** (`.ov-cost-grid` is 2-col; `card()` takes `sub`/`subColor` for the qty/% sub-line; `balanceAmt=ctc`, `savings=hm.budgetAwarded-awardedCost`) left + two WP Status cards (donut % by WP/Value toggle + stats table) right. Then **Procurement Budget (BCB) and Awarded by Period** chart (`c-idx-dash-period`, Monthly/Quarterly + Budget/# WPs toggles, `_idxDashRenderPeriod`) + **Top 5 panels** (High Value / Savings / Overbudget). **Portfolio-specific:** clickable **project cards/table** (`setProjectView`) come **last, after the Top 5**. Rendered by the `tab==='overview'` branch of `_renderTab` (the former Dashboard render body was merged in; the old status-bars/summary/dashboard-backlog statements remain but self-no-op since their DOM was removed). |
| Backlog | **Charts first** (aging chart + status donut + period chart + submittal donut), then the Backlog — Not Awarded WPs table **below** (so charts are visible on tab open) |
| Budget | Cost KPIs + budget-by-period + budget-by-trade HBar + Budget vs Awarded by Project grouped bar + budget table by trade. **KPI cards use `helpingMetrics(wps)` — the SAME authoritative basis as the Overview tab — so BCB / Awarded Cost / CTC / EAC / SavY-Loss reconcile across tabs.** The old naive `Σ total_awarded` over ALL rows over-counted provisional costs on Not-Yet-Awarded WPs (see #17), making the Budget-tab figures disagree with the Overview. The 5th/6th cards are **Savings / Loss** (`budgetAwarded − awardedCost` = `BCB − EAC`) + **% Savings / Loss** (`savings ÷ budgetAwarded`) — renamed from "Variance"/"% Variance". The budget-by-trade table's Awarded column + TOTAL also use the strict `award_status==='Awarded' && total_awarded>0` predicate so the table reconciles with the cards (the per-trade **Variance / % Var** column headers are unchanged). |
| Schedule | Period chart (# WPs Planned vs Actual default; Budget toggle available via `_idxSchDataMode`) + WP by Trade + WP by Status + collapsible schedule summary table |
| Works | Stacked period chart + donuts by trade + collapsible BCB by Period per Scope table + BCB & Awarded by Period per Scope table |
| WP List | **Project-grouped â†’ Trade-grouped** (two-level: a prominent red Project group header above each project's Trade subheaders), 5 view tabs (Overview/Award/Schedule/Submittals/All), sortable headers, virtual pagination, slide-in detail panel |

**IDX_TRADE_ORDER** (used for Budget, Schedule, Works tables):
```js
['General Requirements','Site Works','Structural Works','Architectural Works',
 'Mechanical Works','Electrical Works','Auxiliary Works','Plumbing Works',
 'Fire Protection Works','Allied Services','Site Development Works']
```

**WP List** (`index.html`): `_WPC` column defs + `_WP_VIEWS` + `_getActiveCols()`. `renderWPMonTable()` rebuilds colgroup/thead per view and also populates `#wp-mon-cards` (mobile card view). `setWPListView(view)` switches + resets sort. `openWPDetail(w)` / `closeWPDetailModal()` â€” slide-in panel. All tab hidden for viewers.
  - An **OSM filter** (`wp-mon-osm`: All/Yes/No, filters `w.osm==='Yes'`) sits in the filter bar too. **Cascading multiselect filters (Trade â†’ Works â†’ Vendor)**: Trade is a single native `<select>` (`wp-mon-trade`, `onWpMonTradeChange()`); **Works and Vendor are custom checkbox-dropdown multiselects** (`.msf`/`.msf-btn`/`.msf-pop`, state in `_msfSel={works:Set,vendor:Set}`). `_recomputeFilterOptions()` cascades: Works options = distinct works of the trade-filtered set; Vendor options = distinct vendors (`_wpVendors(w)` splits `contractor||proposed_vendors` on `/[\r\n;|]+/` â€” newline/semicolon/pipe only, NEVER comma or space so multi-word names and "Company, Inc." stay intact; source data must use one of these delimiters) of the trade+works-filtered set. Selecting a Trade clears Works+Vendor and repopulates; selecting Works narrows the Vendor list and drops now-invalid vendor selections. `msfToggle/msfOnToggle/msfSelectAll/msfFilterOpts` drive the popovers; outside-click closes them. `filterWPTable()` reads the two Sets (empty Set = all). The custom buttons are fixed-width (`min/max-width` 150â€“190px) so the filter bar stays a **single row** regardless of project selection (replaced the old wide native selects that wrapped to 3 rows when all projects were selected).
  - **Filtered Analysis KPIs**: 4 cards â€” Work Packages, Total Budget (BCB), Total Awarded, **Total to be Awarded** (`wpmon-sum-tba`, amber â€” sum of `approved_budget_bcb` for `award_status!=='Awarded'` rows). The period chart uses `{tidyLabels:true}` (see charts.js `_dlTidy`) to declutter dense month/quarter bars.
  - **Budget / # WPs toggle** (`setWpMonDataMode('budget'|'count')`, state `_wpMonDataMode`, buttons `wpmon-btn-budget`/`wpmon-btn-count`): mirrors the Overview-tab chart's toggle. `budget` (default) → `budgetAwardedByPeriod(Monthly)` (BCB + Awarded cost, distinct-colour `_dlTidy` labels); `count` → `wpCountByPeriod(Monthly)` (Planned vs Actual WP counts). In **table** view the count mode renders a Planned/Actual-WPs count table (Planned by `awarding_date`, Actual by `actual_awarding_date` clamped to today) instead of the Budget/Awarded ₱ table. Applies to BOTH chart and table view. Same toggle added to the per-project WP List Analysis (`setPwaDataMode`, `_pwaDataMode`, `pwa-btn-budget`/`pwa-btn-count`).
  - **Chart / Table toggle** (`setWpMonViewMode('chart'|'table')`, state `_wpMonViewMode`): Chart|Table switch beside Monthly|Quarterly. Table view (`renderWpMonPeriodTable`) shows the same per-period buckets as the chart â€” Month/Quarter, Budget (BCB), Awarded (red), Cum. Budget, Cum. Awarded + Total row â€” respecting Monthly/Quarterly mode and active filters. Bucketing mirrors charts.js (budget by planned `awarding_date`; awarded by `actual_awarding_date||awarding_date` fallback, `total_awarded>0`). `renderWPMonAnalysis()` renders chart OR table per `_wpMonViewMode`; `#wpmon-chart-wrap`/`#wpmon-table-wrap` toggled in `setWpMonViewMode`.
  - **Month-to-month (From/To) range scope + bidirectional cascade** (`wpmon-from` + `wpmon-to`, state `_wpMonFrom`/`_wpMonTo`): two dropdowns in the Filtered Analysis header restrict the **KPIs + chart + table** to WPs whose **planned award month/quarter (`awarding_date`)** falls within the inclusive `[From, To]` range (`_wpMonPeriodMatch` on `_wpMonKey(d)` — `YYYY-MM` monthly / `YYYY-Qn` quarterly, string-comparable). Either end "all" = unbounded; both "all" keeps null-date rows. **Bidirectional faceting:** `populateWpMonAnalysisFilters()` (called at the top of `renderWPMonAnalysis`) rebuilds the From/To option lists from the **Trade/Works/Vendor/Status-filtered** set (`_wpMonFiltered`) so the periods map to those filters; and `_recomputeFilterOptions()` scopes the **Trade + Works + Vendor** option lists to the selected period range (`periodOk`/`inRange`) so picking a range narrows them too (Trade value is preserved even if out-of-range so the main list isn't silently cleared; Works/Vendor invalid selections are dropped). `onWpMonAnalysisFilterChange` → `_recomputeFilterOptions()` then `filterWPTable()` (which re-renders + remaps From/To). `setWpMonPeriodMode` resets the range to "all" (keys change format) and re-renders. Scope applies ONLY to the analysis panel, not the main WP list below.
  - **Two-level grouping (Project â†’ Trade)**: rows group by `project_id` first (ordered by the `permitted` list), then by trade (ordered by `TRADE_ORDER`) within each project. The virtual `items[]` interleaves `projheader` (greater, red `#f0f0f0`/`#EE3124` header â€” `toggleProjectGroup(pid)`, state in `_projCollapseState`) â†’ `header` (trade subheader, indented, `toggleTradeGroup(key)` where **key = `${project_id}||${trade}`** so the same trade collapses independently per project, state in `_collapseState`) â†’ `row`. `collapseAllTrades`/`expandAllTrades` operate on the composite keys; expand-all also clears `_projCollapseState`. Mobile cards get a `.wpc-projgroup` header (dark-mode rule in dashboard.css "Mobile WP List cards"). The per-project dashboard (`project.html`) stays single-level trade grouping (one project only).
  - **WP No. display normalization**: `_normWpNo(v)` (index.html) / `normWpNo(v)` (project.html) strip a trailing `.0`/`.00` from purely-numeric WP numbers at data-load (e.g. SLN101 stores `"2.0"` â†’ shown as `"2"`); real decimals like `2.1` are preserved. Applied in the `.map()` right after `normTrade` on every load/reload path. The DB still stores the original; `UPDATE_wpno_normalize_SLN101.sql` (one-off) normalizes the stored values, and the award-date UPDATE scripts match `wp_no` via `regexp_replace(wp_no,'\.0+$','')` so they work regardless.

**Mobile WP List (both pages)**: On â‰¤767px the `.wp-table-wrap` is hidden and `.wp-card-list` shown instead. Cards render from the same paged `items[]` â€” trade group header + one card per WP. Each card: WP No (red, tappable â†’ detail panel) + status badge, description, trade â€º works, budget/awarded/variance (non-viewer), target award + delivery dates, vendors, View Details + Edit. CSS classes: `.wp-card-list`, `.wp-card`, `.wp-card-*`, `.wp-table-wrap` â€” defined in each page's inline `<style>` block.

**Collapse pattern**: items[] built from trade groups (header always + rows only if expanded). `toggleTradeGroup` / `collapseAllTrades` / `expandAllTrades`. Works tab uses DOM-only toggle (`toggleWkTrade`, `toggleWkBudget`). Schedule tab uses `toggleSchRow`.

**Project filter**: `_activeIds` Set; `toggleProjectPill` calls `renderAll()` immediately. Empty Set = "No projects selected" state (red label, empty charts).

**READ-ONLY badge**: never add `display:inline-flex` as inline style â€” media query sets `display:none` and inline overrides it.

---

## Per-Project Dashboard (project.html)

Tabs: Overview → Backlog → WP List (**Dashboard tab removed** — its period chart + Top 5 panels moved into Overview)

- **Overview**: Left/right split. Left: Cost Overview 6 KPIs (BCB, Actual Award, Cost to Complete, Estimate at Completion, Variance, %Variance) via `buildMetrics(wps)`. Right: two WP Status cards â€” battery chart card (`#ov-battery-charts`, renders via `renderOvBattery(wps)` â€” two vertical CSS battery bars for % by WP and % by Value, segments: green=Awarded, red=Due Not Awarded, gray=Not Due Yet; no toggle, no Canvas) + stats table card (`#metrics-wp`). CSS: `.ov-top-row`, `.ov-cost-grid` (2-col), `.ov-wp-split`, `.ov-donut-card`, `.ov-stats-card`. Below the top row: **Procurement S-Curve** (`#c-ov-scurve`, `Charts.sCurve(id, wps)`, project view only) â€” cumulative WP count by month, Planned line from `awarding_date` (Planned Award) vs Actual line from `actual_awarding_date` of `award_status==='Awarded'` WPs; the actual line stops at the current month (no future projection). Mirrors the Excel "S-Curve" sheet (Cumulative Planned WP vs Cumulative Actual WP) and updates automatically as WPs are awarded. Rendered from `buildMetrics()`. **Date parsing (`sCurve` in charts.js) must be format-agnostic**: the internal `pd()` helper extracts the `YYYY-MM-DD` prefix via regex from ANY value (date-only string, full ISO timestamp `â€¦T00:00:00+00:00` / `â€¦Z`, space-separated timestamp, or a `Date` object) and builds a **local-midnight** Date. This fixes two bugs at once â€” (1) `new Date('2026-06-30')` is UTC midnight = June 29 evening in UTC+8, which pushed month-end comparisons into the wrong bucket; (2) a naive `split('-')` parser returned `null` for timestamp-typed columns (the live DB predates the current schema and may return timestamps), which made `valid` empty and hid the curve for EVERY project behind the `.scurve-nodata` placeholder. When there are genuinely no parseable award dates, a `.scurve-nodata` message is shown and the canvas hidden. **Call-site guard gotcha (was the real "no S-curve on any project" bug):** `buildMetrics()` in `project.html` must guard the call with `if (typeof Charts !== 'undefined' && Charts.sCurve)` â€” NOT `if (window.Charts && â€¦)`. `Charts` is a top-level `const` in charts.js, which does **not** create a `window.Charts` property, so the old `window.Charts` guard was always falsy and the S-curve was never even called (blank panel, no chart, no placeholder). **Actual-award-date fallback:** both the S-curve "Actual" line and the period charts' "Awarded"/"Cumulative Awarded" series fall back to the **planned `awarding_date`** when `actual_awarding_date` is null â€” the WP-Monitoring imports populate `award_status` + `total_awarded` (award flag from Remarks col P) but never an actual award *date*, so without the fallback every awarded series was flat at â‚±0 / had zero points. Awarded series filter on `total_awarded>0`; the month/quarter key set includes awarded WPs' fallback dates so their buckets exist. **No future awards (clamp-to-today):** an awarded WP can never be plotted in the future â€” the effective award date is **clamped to today** (`_awDate`/`_actAwDate` in charts.js; inline `awd()` in `sCurve`; clamped `awDate` in index.html `renderWpMonPeriodTable`). So when the actual date is missing and the planned `awarding_date` is in the **future**, the award is pulled back to the current day (it lands in the current period instead of a future month). Budget (BCB) bars still use the raw planned `awarding_date`, so future **budget** is shown but future **awarded** never is. Applies to `budgetAwardedByPeriod(Monthly)`, `wpCountByPeriod(Monthly)`, `wpByPeriodQuarterly`, `sCurve`, and the WP-List period table. **Cumulative Awarded line stops at today:** in `budgetAwardedByPeriod(Monthly)` the `Cumulative Awarded` series is nulled for periods after the current month/quarter (`cumADisp`, `spanGaps:false`) so the red cumulative line **ends at today** rather than running flat across the future budget months to the last planned quarter (the awarded bars are already 0 there, but the line previously extended to e.g. Q3 2028). Cumulative Budget still extends (future planned budget is legitimate).
- **Dashboard**: Period chart + **WP Status split** (donut card `c-dash-status` with `setDashStatusMode('wp'|'val')` toggle + stats table `#dash-status-table`) + WP by Trade + **Top 5 panels (now ABOVE the backlog)** + **Work Package Backlog â€” Not Awarded** table. `renderDashBacklog()` now also applies a **Trade filter** (`#dash-bl-trade`, populated once from the not-awarded set) and **Min/Max â‚±M budget filter** (`#dash-bl-bmin`/`#dash-bl-bmax`) in addition to the existing sort dropdown (single project â†’ no project grouping)
- **Backlog**: Filter bar (Trade, Sort, Search, Budget min/max) + backlog table + aging/status/period/submittal charts. `renderBacklog()` applies filters. Collapsible trade groups.
- **WP List**: filter bar = Status / **OSM (`f-osm`: All/Yes/No)** / Trade / **Works (multi)** / **Vendor (multi)** / Search. (**Zone filter removed** — to match the Portfolio WP List, which has none. The `f-zone` `<select>` was earlier dropped from the markup but JS references lingered; `document.getElementById('f-zone').innerHTML=…` in the data-load path then threw a TypeError that **aborted the rest of `loadData` → project views appeared to not load / load slowly**. All `f-zone` reads removed from `getFilteredSorted`, `_pwaFilteredWPs`, the filter-populate block, and the change-listener array.) Works + Vendor are the same `.msf` checkbox-dropdown multiselects as the portfolio (CSS now in `dashboard.css`, shared), cascading **Trade â†’ Works â†’ Vendor** via `_recomputeFilterOptions()` (state `_msfSel={works:Set,vendor:Set}`; `applyWpListFilters()` re-renders table + Filtered Analysis). Vendor options from `_projVendors(w)` (`contractor||proposed_vendors` split on `/[\r\n;|]+/` â€” newline/semicolon/pipe only, never comma/space). Applied in `getFiltered`, `getFilteredSorted`, and `_pwaFilteredWPs` (empty Set = all). **Source data must delimit multiple vendors with a newline (Alt+Enter) or `;`** â€” AVR101's legacy data is space-joined with no delimiter (can't be auto-split reliably), so re-import with a delimiter is required to get per-vendor options. 5 view tabs (Overview/Award/Schedule/Submittals/All). `WP_TABLE_VIEWS` + `getActiveCols()`. `setWPTableView(view)`. `buildTable()` renders colgroup + thead + tbody via `innerHTML` exactly like `renderWPMonTable()` in `index.html` â€” uses `_stickyLeft` dict (never mutates col objects), `renderCell` switch, `white-space:normal` on `<th>`. Trade group header splits into sticky + non-sticky cells. Also populates `#proj-wp-cards` (mobile card view â€” same paged items, CSS toggles visibility). `openWPDetail(w)` slide-in panel.
  - **Work Package Status Tracker** (`#status-tracker`, between `#pwa-analysis` and the WP table): a scrollable inline-edit table letting user/manager/specialist/admin update **Award Status / Procurement Status / Delivery Status** per WP without opening the form. `renderStatusTracker()` builds it from `getFilteredSorted()` (respects the WP-List filters, trade-grouped). Each cell is a `<select>` (`_stSelect`/`_stOptsHtml`; option sets `ST_AWARD_OPTS`/`ST_PROC_OPTS`/`ST_DELIV_OPTS`; a stored value outside the set is prepended so legacy data shows pre-migration). `updateWpStatus(id,field,value,sel)` **respects the approval model** (`_stAutoApprove()` = `AppAuth.isAutoApprove({role})`): auto-approve roles (admin/super_admin/specialist/manager) → `WPDb.updateWPDirect` (live, keeps approved status, toast "Saved"); non-auto-approve `user` → `WPDb.updateWP` (sets `review_status='pending_review'`, toast "Submitted for approval") so the change goes to the manager/WP approver — same as editing via the form. Either way it updates the local `allWPs` object, busts the `wpm_wps_idx*` cache, then re-renders `renderPwaAnalysis()`+`buildTable()` (NOT the tracker, to avoid scroll jump). The header hint text (`#status-tracker-hint`) switches to reflect whether edits are live or sent for approval. Wired into `switchView('table')` and `applyWpListFilters()`. **Hidden for viewers** (display:none in the `__isViewer` block). **Award column is a READ-ONLY badge** (`_stAwardBadge`, id `st-aw-<id>`) — Award Status is derived from Procurement Status, not edited directly. Changing **Procurement Status** drives it: →`Awarded` sets award=Awarded and, if the WP lacks a cost/vendor, opens the `#st-award-modal` popup (`_stOpenAwardModal`/`stAwardConfirm`/`stAwardCancel`) to collect **Awarded Cost (Net)** + **Awarded Vendor** and commits `{procurement_status, award_status, awarded_cost, contractor}` together via `_stSaveFields`; any earlier stage sets award=Not Yet Awarded. `_stRefreshAwardBadge(id)` updates the badge after save (tracker isn't fully re-rendered, to avoid scroll jump); Cancel reverts the Procurement dropdown. **"Partially Awarded" was removed everywhere** (tracker `ST_AWARD_OPTS=['Not Yet Awarded','Awarded']`, `awardDonut`, `statusByZone`, CSV import `pAward` maps "partial"→Not Yet Awarded; existing rows migrated by `UPDATE_remove_partially_awarded.sql` — **ALL** Partially Awarded → Not Yet Awarded with the partial `awarded_cost` **cleared** so it can't be read as fully awarded or inflate savings).
  - **Filtered Analysis â€” Budget & Awarded by Period** (`#pwa-analysis`, ported from the index.html WP-List panel): sits above the WP table, scoped to the project's `f-status`/`f-trade`/`f-zone`/`f-search`-filtered set (`_pwaFilteredWPs()`). Same controls as the portfolio version â€” **From/To month-to-month range** (`pwa-from`/`pwa-to`, state `_pwaFrom`/`_pwaTo`, `_pwaPeriodMatch`), Monthly/Quarterly (`setPwaPeriodMode`), Chart/Table (`setPwaViewMode`) â€” plus the 4 KPI cards (Work Packages / Total Budget / Total Awarded / Total to be Awarded) and the period chart (`c-pwa-period`, `{tidyLabels:true}`) or `renderPwaPeriodTable`. From/To options come from the filtered set (`_populatePwaFilters`). `renderPwaAnalysis()` is called from `switchView('table')` and the WP-List filter/search listeners (NOT pagination). **Hidden for viewers** (`#pwa-analysis` display:none in the `__isViewer` block). All ids/functions use a `pwa`/`_pwa` prefix to avoid collision with the per-project chart code.
- Claims tab exists in HTML but hidden (`display:none`)

`_rendered = { overview, dashboard, backlog, table }` â€” reset on filter change or data reload.

---

## WP Form (wp-form.html)

### Sections & Key Fields
1. **Identity & Classification**: Cost Code, Trade â†’ Works â†’ Type (cascade), WP No., Description, Scope, Project, Zone, **OSM (Yes/No, `f-osm` → `osm` column, filterable in the WP List)**, Detailed Description, Type of Service, Type of Procurement, Type of Contract, Proposed Vendors, No. of PO/JO, PO/JO Numbers
2. **Approval Matrix**: Responsible (multi-select), Approver (single select, admin/super_admin only), Support (multi-select). All from `WPDb.getAllUsers()`. Uses `u.name` for display. Values stored comma-separated in `responsible_team` / `approver` / `support_team`.
3. **Insurance Bonds**: Surety Bond, Performance Bond, Warranty Bond
4. **Material/Subcon Submittals**: Requires Approval, Type of Submittal, Name of Approver, Date of Approval. **When Requires Approval = "No" the other three fields are Not Applicable** — `onRequiresApprovalChange()` (wired to the `f-requires-approval` `onchange`) sets Type of Submittal + Name of Approver to **`N/A`** and disables them, and clears + disables Date of Approval (a date can't hold "N/A"). Switching to "Yes" re-enables all three and clears the "N/A" placeholders. Called on fresh load (new WP defaults to "No" → fields start N/A) and after edit-fill (`fill('f-requires-approval', …)` then `onRequiresApprovalChange()`) so stored values sync to the flag. Disabled fields still return their `.value` via `getVal`, so save persists `submittal_document_type='N/A'` / `approver_name='N/A'` / `approval_date=null`.
5. **Procurement Schedule**: Lead Time (â†’ `lead_time`), Awarding Date, Actual Awarding Date, Target Delivery, Actual Delivery, Target Installation, Target Completion
6. **Budget & Contract**: **Budget (BCB) (Net)** (label; â†’ `approved_budget_bcb`), **Awarded Cost (Net)** (label; â†’ `awarded_cost`), Award Status, **Awarded Vendor** (label; â†’ `contractor`)
7. **Payment Terms**: Terms (Days) (**free numeric input** â€” any value, not a fixed dropdown), Down Payment % (free numeric input â€” user enters percentage e.g. 20, stored as 0.20), DP Terms, DP Amount, Date of DP Release, Payment Notes, **Retention %** (**free numeric input** â€” user enters percentage e.g. 7, stored as 0.07; edit mode multiplies by 100; was a fixed 5/10/15% dropdown), Retention Amount, Retention Period
8. **Procurement Status**: Procurement Status, Submittal Status, Delivery Status, Remarks, Charging (required: Main Contract â†’ Contract Package No. | Change Order â†’ CO Description)

### Trade â†’ Works â†’ Type Cascade
`TRADE_WORKS` object maps Trade â†’ array of `[works, type]`. `onTradeChange()` repopulates Works; `onWorksChange()` sets Type. The Type dropdown (`_setTypeOptions`) offers **`Materials` / `Labor`** for material works (the combined **"Materials & Labor" option was removed** per user request) and **`Service`** for service works; no value is auto-selected for material works. Legacy stored values (incl. old "Materials & Labor" records) are preserved via the `unshift` fallback.

### Approval Matrix Multi-Select
`toggleMs(field)`, `msClearAll(field)`, `getMsValues(field)`, `_setMsFromText(field, text)`, `_msPillRemove(field, uid)`. Mobile: dropdown uses `position:fixed` full-width.

### Budget Input Formatting
`f-budget` uses `type="text" inputmode="numeric"` with comma formatting on blur, stripped on focus. All reads use `.replace(/,/g,'')` before `parseFloat`.

### Unsaved Changes Guard
`formDirty` flag. `markDirty()` on input/change events. `markClean()` called on successful save. `beforeunload` fires only if `formDirty`.

### Save Validation
Required fields (in `save()`): WP No., Work Package Description, Project, Trade, Awarding Date, Target Delivery Date, Target Completion Date, Budget (BCB), Charging type. **Cost Code No. is NOT required** (label has no `*`, no validation check). **Award-status safeguards:** when Award Status = `Awarded`, both **Awarded Cost (Net)** (`f-contract`) and **Awarded Vendor** (`f-contractor`) are required. **PO/JO consistency:** `No. of PO/JO` (`f-po-jo-count`) must equal the number of entries in `PO/JO Numbers` (`f-po-jo-numbers`, split on `/[\s,;]+/`); mismatch aborts the save. **Actual Awarding Date cannot be in the future** — if `f-actual-awarding-date` parses to a date after today (local midnight), `save()` aborts with "Actual Awarding Date cannot be in the future." (a WP can't be awarded on a date that hasn't happened yet). The **CSV import** path enforces the same rules (future-date + the Awarded-cost/vendor + PO/JO safeguards): both `importWPsFromCSV()` (in `project.html` and `wp-form.html`) validate the whole batch up front and `throw` (naming the offending WP No(s)) before any DB write, so any violation aborts the entire import with no partial rows. The **quick-add modal** (`saveQuickWP()` in `project.html` — now has `wqm-contract` Awarded Cost + `wqm-contractor` Awarded Vendor inputs) enforces the Award-status safeguard too (it has no PO/JO fields, so that check is N/A there).

### Cost Overview KPIs â€” abbreviated headline figures
The 6 Cost Overview KPIs (`#metrics-cost`, `.ov-cost-grid`) show **`Fmt.moneyShort`** (auto-scales: `â‚±16.52B` / `â‚±2.40M` / full < 1M; sign dropped, callers prepend +/-) with the exact value in a `title` tooltip (`Fmt.moneyFull` â†’ `â‚±16,521,423,165`). This replaced the earlier "shrink-to-fit" approach for billion-scale portfolios. The `card()` helper in both `index.html` and `project.html` takes a 4th `full` arg for the title. `.ov-cost-grid .metric-value` stays `white-space:nowrap;overflow:hidden` and `fitMetricValues()` still runs as a harmless safety net. Scoped to `.ov-cost-grid` only.

### Forecast Diagnostic (`?diag=1`)
`project.html?id=<PID>&diag=1` runs `runForecastDiag()` after data load (non-viewers only): a dismissible panel (prepended to `#view-overview`) + `console.table` output that explains when the dashed Forecast line sits above the Cumulative Budget. The chart's red lines are **row-derived** (sum of per-WP `total_awarded` vs `approved_budget_bcb`), while the Cost-Overview "Savings" KPI is **Helping-Sheet-derived** (`HELPING_FIGURES`/`helpingMetrics`). The diag shows the row-based forecast end vs budget, the row-vs-Helping-Sheet reconciliation gap, and lists: WPs awarded over their own BCB, cost-bearing rows still flagged "Not Awarded" (`total_awarded>0` but `award_status!=='Awarded'`), and awarded rows with no BCB. Use it to find which WPs push the forecast over budget.

### Delete WP
A WP can be deleted from three places (non-viewers only): the **WP detail slide-in panel** on `index.html` and `project.html` (`deleteWPFromDetail(id, wpNo)` â€” Edit + Delete buttons in the panel footer), and **`wp-form.html` edit mode** (`#btn-delete` â†’ `deleteCurrentWP()`, shown only when `editId` is set). All confirm first, call `WPDb.deleteWP(id)`, bust the `wpm_wps_idx*` sessionStorage cache, then reload (index: `location.reload()`; project: `loadData()`; form: redirect to `project.html?id=`). Requires DELETE granted on `work_packages` (already present â€” `deleteProject` uses it).

---

## CSV Import (Work Packages)

`downloadCSVTemplate()` generates `WPM_Import_Template.csv`. Both `project.html` and `wp-form.html` share the same 54-column template. The two sample rows are clearly marked **EXAMPLE ROW - edit or delete before importing** in the Description and are self-consistent valid samples (one Not-Yet-Awarded minimal row; one Awarded row with cost+vendor+matching PO/JO and no future dates) so they pass the import safeguards; officers edit or delete them freely. `importWPsFromCSV()` calls `WPDb.submitWP()` per row (throws on error), then `WPDb.approveWP()` if auto-approve role.

**Import is de-duplicating (upsert by WP No.)** â€” re-importing a CSV that already contains existing WPs plus a few new ones will **UPDATE the matching rows in place and only INSERT the genuinely new ones**, so no duplicate work packages are created. Both import paths (`project.html` and `wp-form.html` `importWPsFromCSV()`) first load the project's existing WPs, build a map keyed by **normalized WP No.** (`String(wp_no).trim().replace(/\.0+$/,'').toLowerCase()` â€” so `"5"`â†”`"5.0"` match), then per row: if the key exists â†’ `WPDb.updateWPDirect(existingId, wpData)` (keeps approved status), else `WPDb.submitWP()` (+`approveWP` for auto-approve roles). The map is updated after each insert so repeated WP Nos. within the same CSV also don't duplicate. Status message reports `N new, M updated (no duplicates)`.

**`WPCsv` shared module (`db.js`, `window.WPCsv`)** â€” both pages now route import through it:
- **`WPCsv.parse(text)`** â€” RFC-4180 tokenizer. Respects quoted fields containing embedded newlines (e.g. a header like `"BUDGET (BCB)\n(Net)"`). The old `text.split('\n')` broke on these â†’ counted 705 "rows" for an 87-row file. Returns array-of-row-arrays, drops blank rows, strips BOM.
- **`WPCsv.isHeaderMode(table)`** â€” true when the header row contains a recognizable WP No. column. When true, `toWPData` maps **by normalized header name** (not position), so the existing **Work Package Monitoring** layout imports directly â€” no need to reorder columns into the native template. `HMAP` aliases cover both the native template headers and the WP-Monitoring headers; `norm()` = lowercase + strip non-alphanumerics.
- **`WPCsv.toWPData(table, pid)`** â€” header-name mapping; falls back to position-based (native 54-col / legacy <40-col) when no header match. Handles: **Excel serial-number dates** (`pDate` converts e.g. `46050` â†’ `2026-01-28` via the 1899-12-30 epoch; range 20000â€“80000); **procurement_status** from the explicit `Procurement Status` column, else the right-most marked stage column; `pPct` treats values >1 as percentages (Ã·100) and â‰¤1 as already-decimal. Arbitrary `type_of_works` and combined trades (e.g. "Electrical & Auxiliary") pass through unchanged â€” dashboards group by exact trade string.
- **Award status comes from the Remarks/AWARDED text, NOT the stage**: `award_status = pAward(AWARDED col) || pAward(REMARKS col) || (awarded_cost>0 ? Awarded : Not Yet Awarded)`. In the WP-Monitoring files the award flag lives in **Column P â€“ Remarks** ("Not yet Awarded" / "Awarded"). Procurement stage columns are NOT a reliable award signal (a WP can be flagged stage=Mob/Del yet still "Not yet Awarded"), so the old "Contract/Mob-Del â‡’ Awarded" inference was **removed**. Award Status (under Budget & Contract) is the single source of truth for whether a WP is awarded; dashboard KPIs read `award_status`.
- **`WPCsv.dataRowCount(table)`** â€” counts rows with a WP No. for the "Ready to import N" message.

> The `f-proc-status` dropdown options were **updated (2026-06)** to: **Not Started / Sourcing / Solicitation / Evaluation & Negotiation / Awarded** (was the longer WP-Monitoring stage list RFQ/Bid Open/Bid Closed/LOA/Contract/Mob-Del). `f-delivery-status` options updated to: **Not Awarded / DP Processing / Detailed Drawings / Production / Delivered / Installed**. **Award Status is DERIVED from Procurement Status** (`onProcStatusChange()`): `proc==='Awarded'` → Award Status = `Awarded`, any earlier stage → `Not Yet Awarded`. The `f-award-status` select is **disabled** (auto-set, with a hint); edit mode calls `onProcStatusChange()` after filling proc to sync it. Edit mode uses `fillSelectLegacy()` to append any stored value not in the new list as a temporary "(legacy)" option so old data still displays pre-migration. Existing data is aligned by `UPDATE_status_align_2026.sql` (run once in Supabase SQL Editor — maps RFQ/Bid Open→Solicitation, Bid Closed→Evaluation & Negotiation, LOA/Contract/Mob-Del→Awarded; delivery Awarded→DP Processing, In-Transit/Not Installed→Delivered, Installation→Installed). The CSV import `STAGES` map in `db.js` was likewise remapped to the new values.

**Importing the WP-Monitoring `.xlsx` files** â€” they are NOT in importable shape (hierarchical: trade in Column A, works-subgroup rows, WP leaf rows; cost/award/schedule columns spread across cols Aâ€“EB; dates as real datetimes). A one-off Python extractor (openpyxl) flattens each monitoring sheet into the adopted CSV format: trade from **Column A** (with "MEPF" split into Mechanical/Electrical&Auxiliary/Plumbing/Fire by keyword), Works from the nearest sub-header row, award from **Remarks (Col P)**, budgets/dates/vendors by header-name lookup. Generated CSVs (87/87/80/84/104 WPs for SLN101/SLT101/GRP101/UPTM/OPW101) live next to the source files as `EPC. PMO. Import WP. <PID>. 2026 06 11.csv` and import directly via the dashboard. OPW101 uses a different sheet (`OPW WP Monitoring`) and VAT-EX cost headers â€” the extractor detects both by header name.

The native template (`downloadCSVTemplate`) remains 54-column and imports via header mode (its headers all map through `HMAP`). Legacy files (<40 cols, no header match) still parse via position fallback.

**54-column mapping (position-based) â€” WP No. at col 4 is required (row skipped if blank):**

| # | Header | DB Column | Notes |
|---|---|---|---|
| **Identity & Classification** |
| 0 | Cost Code No. | `cost_code` | |
| 1 | Trade | `trade` | |
| 2 | Works | `works` | |
| 3 | Type of Works | `type_of_works` | |
| 4 | WP No. | `wp_no` | **Required** |
| 5 | Work Package Description | `description` | |
| 6 | Detailed Description | `detailed_description` | |
| 7 | Scope of Work | `scope` | |
| 8 | Zone | `zone` | |
| 9 | Type of Service | `type_of_service` | |
| 10 | Type of Procurement | `type_of_procurement` | |
| 11 | Type of Contract | `type_of_contract` | |
| 12 | Charging Type | `charging_type` | |
| 13 | Contract Package No. | `contract_package_no` | |
| 14 | CO Description | `co_description` | |
| 15 | Proposed Vendors | `proposed_vendors` | |
| 16 | No. of PO/JO | `po_jo_count` | |
| 17 | PO/JO Numbers | `po_jo_numbers` | |
| **Approval Matrix** |
| 18 | Responsible Team | `responsible_team` | |
| 19 | Approver | `approver` | |
| 20 | Support Team | `support_team` | |
| **Insurance Bonds** |
| 21 | Surety Bond (Yes/No) | `surety_bond` | |
| 22 | Performance Bond (Yes/No) | `performance_bond` | |
| 23 | Warranty Bond (Yes/No) | `warranty_bond` | |
| **Submittals** |
| 24 | Requires Submittal Approval (Yes/No) | `requires_approval` | stored as boolean |
| 25 | Submittal Document Type | `submittal_document_type` | |
| 26 | Submittals Approver Name | `approver_name` | |
| 27 | Date of Approval (MM/DD/YYYY) | `approval_date` | |
| 28 | Submittal Status | `submittal_type` | e.g. Not Required / Submitted / Approved |
| **Schedule** |
| 29 | Lead Time (Days) | `lead_time` | NOT `awarding_lead_time` (generated) |
| 30 | Planned Award Date (MM/DD/YYYY) | `awarding_date` | |
| 31 | Actual Award Date (MM/DD/YYYY) | `actual_awarding_date` | |
| 32 | Target Delivery Date (MM/DD/YYYY) | `target_delivery` | |
| 33 | Actual Delivery Date (MM/DD/YYYY) | `actual_delivery` | |
| 34 | Target Installation Date (MM/DD/YYYY) | `target_installation` | |
| 35 | Target Completion Date (MM/DD/YYYY) | `target_completion` | |
| **Budget & Contract** |
| 36 | Procurement Budget BCB (PHP) | `approved_budget_bcb` | |
| 37 | Contract Amount Awarded (PHP) | `awarded_cost` | NOT `total_awarded` (generated) |
| 38 | Award Status | `award_status` | |
| 39 | Vendor/Contractor | `contractor` | |
| **Payment Terms** |
| 40 | Payment Terms (Days) | `payment_terms_days` | |
| 41 | Down Payment % | `dp_percent` | enter as e.g. 20 â†’ stored as 0.20 |
| 42 | DP Terms | `dp_terms` | |
| 43 | DP Amount (PHP) | `dp_amount` | |
| 44 | Date of DP Release (MM/DD/YYYY) | `dp_release_date` | |
| 45 | Payment Notes | `dp_notes` | |
| 46 | Retention % | `retention_percent` | enter as e.g. 10 â†’ stored as 0.10 |
| 47 | Retention Amount (PHP) | `retention_amount` | |
| 48 | Retention Period | `retention_period` | |
| **Status** |
| 49 | Procurement Status | `procurement_status` | default: Not Started |
| 50 | Awarding Status | `awarding_status` | |
| 51 | Delivery Status | `delivery_status` | default: Not Awarded |
| 52 | Remarks | `remarks` | |
| 53 | Purchase Request | `purchase_request` | |

Dates accept MM/DD/YYYY or YYYY-MM-DD. `dp_percent` and `retention_percent` are entered as plain percentages (e.g. 20) and divided by 100 before storing.

---

## Claims & Change Orders (HIDDEN â€” not yet active)

To re-enable: remove `style="display:none"` from sidebar section + tab button in `project.html`; Claims tab button in `index.html`; restore Claims/CO cards in template picker modals.

`claim-form.html`: `?section=change-order` for CO mode, `?project=ID` pre-selects project, `?id=UUID` for edit. Claims and COs share the `claims` table distinguished by `claim_type`.

---

## CSS / Styling

**Design system**: `--mw-red: #EE3124`, `--mw-black: #231F20`, `--mw-dark: #282C28`. Font: Montserrat via `<link>` (not `@import`). Icons: Tabler Icons v2.44 (`ti ti-*`).

**Breakpoints**: â‰¥1024px desktop sidebar (240px) | â‰¤1024px tablet (220px) | â‰¤767px mobile slide-in drawer | â‰¤399px single-column.

**View tabs** (`.view-tabs` / `.view-tab`): defined globally in `dashboard.css` â€” do NOT redefine inline. On mobile: `position:sticky; top:52px`, horizontally scrollable.

**Mobile topbar** (52px): `.topbar` must have `overflow:visible` â€” `hidden` clips the user profile dropdown.

**Critical â€” sticky tabs + overflow**: Never set `overflow-x:hidden` or `overflow-x:clip` on `.main`, `.content`, `html`, or `body` on pages with sticky tabs â€” kills `position:sticky` in Safari iOS. Clamp overflow at element level:
```css
canvas { max-width:100% !important; }
.panel, .grid-2 > *, .grid-3 > * { min-width:0; }
.data-table, .budget-table { display:block; overflow-x:auto; }
```
Standalone pages (login, register, pending, forgot-password) without sticky tabs can use `overflow-x:hidden` safely.

**Logo**: styled globally in `dashboard.css` â€” do NOT add inline `.sidebar-logo img` CSS to individual HTML files.

**PWA / Add-to-Home-Screen icon**: `manifest.webmanifest` (repo root) + `assets/icons/` (generated from `../procurement app-white-logo.png` via Pillow â€” **white** Megawide mark + "PROCUREMENT APP" text on a full-bleed **red `#EE2E24`** square; the source tile has transparent corners so the canvas is filled with the sampled tile-red to avoid black corners on iOS). Icons: `apple-touch-icon.png` (180, iOS), `icon-192/512.png` (`purpose:any`), `icon-192/512-maskable.png` (18% padding for Android adaptive safe-zone), `favicon-32.png`. **Every** `*.html` `<head>` carries the same block (`rel=manifest`, `apple-touch-icon`, favicon, `apple-mobile-web-app-*` + `mobile-web-app-capable` metas, title "Procurement") â€” inserted idempotently (skip if `apple-touch-icon` already present). All paths are relative (pages + assets are at the `/prc-app/` root). To regenerate icons: re-run the Pillow snippet (sample tile-red bg, center, pad 4% regular / 14% maskable).

**iOS pinch zoom**: handled in `ui.js` via `touchmove` + `gesturestart` listeners. `user-scalable=no` viewport is ignored by Safari iOS 10+.

**iOS PWA pull-to-refresh**: not available in standalone mode. A `.btn-refresh` button (Tabler `ti-refresh` icon, same style as `.btn-menu`) is added to `.topbar-right` on both `index.html` and `project.html`, left of the Export PDF button. On `project.html` it calls `loadData()` in-place; on `index.html` it busts `wpm_wps_idx_*` sessionStorage cache then reloads. Shows a CSS spin animation while loading; disabled during refresh to prevent double-taps. Style defined in `dashboard.css` (`.btn-refresh`, `.spin`, `@keyframes spin`).

---

## Script Loading (Dashboard Pages)

Scripts at **bottom of `<body>`** in this order â€” do NOT move to `<head>` without `defer`:
```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
<script src="assets/js/auth.js"></script>
<script src="assets/js/db.js"></script>
<script src="assets/js/ui.js"></script>
<!-- index.html + project.html also load Chart.js + charts.js -->
<script>/* inline init */</script>
```

Public pages (login, register, pending, forgot-password) load UMD bundle inline and call `window.supabase.createClient()` directly â€” they do NOT load `auth.js`/`db.js`/`ui.js`.

Resource hints in `<head>`: `preconnect` for fonts.googleapis.com, fonts.gstatic.com, cdn.jsdelivr.net, cdnjs.cloudflare.com; `dns-prefetch` for Supabase URL; `preload as="script"` for all body scripts.

**Cache-busting (`?v=` query param)**: ALL five core asset includes (`auth.js`, `db.js`, `ui.js`, `charts.js`, `dashboard.css`) carry a shared `?v=YYYYMMDD<letter>` param in `index.html` and `project.html` â€” on both the `<link rel=preload>` and the `<script>`/`<link rel=stylesheet>` tags. GitHub Pages + browser caching can serve a **stale** asset for up to ~10 min after a push (symptom: a JS/CSS fix is confirmed live via `curl` but the user still sees old behavior â€” e.g. dark-mode chart bars still dark, or a `db.js` rank-table fix not applying, because the browser cached the previous file). **When you change ANY of those five files, bump the single `?v=` value in BOTH `index.html` and `project.html`** (use one replace for the old `?v=` string + ensure any newly-versioned file matches) so browsers refetch immediately. Current version: `20260708m`. (Other pages â€” admin/review/wp-form/etc. â€” are not versioned; they rely on ETag revalidation and don't host the chart/rank features.)

---

## Onboarding / Guided Tour

Three deliverables share the same copy, organised by **capability tier** (not the 6 raw roles):
- **admin** = `super_admin`, `admin` · **contributor** = `specialist`, `manager`, `user` · **viewer** = `viewer`.
- `tierOf(role)` in `onboarding.js` does the mapping; content is personalised to the logged-in user's tier.

1. **In-app modal** (`assets/js/onboarding.js`, `window.Onboarding`) â€” a carousel of ~7 slides (Welcome → Two views → Reading the dashboard → Finding WPs → **your tier** → capability matrix → Tips). Self-contained: injects its own `#ob-css` styles (uses the `--surface`/`--text-*`/`--mw-*` CSS vars so it follows dark mode), builds its own DOM, keyboard nav (←/→/Esc), backdrop-click + **×** to close, progress dots. Viewer variant drops all cost content.
   - **Auto-open once per user:** `Onboarding.maybeAutoOpen(userId, role)` opens the tour ~650 ms after load unless `localStorage['wpm_onboarded_<userId>']` is set. The **"Don't show on login"** checkbox (checked by default) + finishing on the last slide set that flag.
   - **Re-open any time:** a **?** `.btn-guide` button is injected into `.topbar-right` (before `#user-bar`, idempotent) on every page that loads the script; `onclick → Onboarding.open()` reads `window.__wpmRole` at open time. A **Restart tour** item in the profile dropdown (`renderUserBar` in `db.js`, above Sign out) calls `Onboarding.open()` when available, else navigates to `onboarding.html` (fallback for pages that don't load onboarding.js). The **login page** also links to `onboarding.html` ("View the Training Guide", opens new tab) for pre-login training access.

**Coach-mark tour (`assets/js/coachmarks.js`, `window.CoachTour`):** an interactive spotlight tour that dims the screen and highlights REAL UI elements with a tooltip card (Back/Next/Done, progress, Esc/arrow keys, auto-skips missing/hidden elements, card auto-flips above/below). Self-contained (injects `#ct-css`, dark-mode via CSS vars). `CoachTour.configure({key,steps})` where a step is `{sel,title,body,before?,pad?}` (`before()` can switch tabs to reveal the target); `start(force)`, `maybeAutoStart()` (once per user via `localStorage['wpm_<key>_<uid>']`, ~800ms delay), `available()`. **index.html** (`key:coach_portfolio`) and **project.html** (`key:coach_project`) build role-aware steps in their `requireLogin` callback (viewer/archived-only steps skipped) and call `maybeAutoStart()` — this REPLACED the slide-deck auto-open (`Onboarding.maybeAutoOpen`). The slide deck stays reachable via the topbar **?** button; the profile-menu **Restart tour** now prefers `CoachTour.start(true)` (falls back to `Onboarding.open()` / `onboarding.html`). Versioned independently: `?v=20260708b`.

**New-user aids (in-context help):** (1) **KPI tooltips** — `window.KPI_HELP` + `window.kpiLabelAttrs(lbl)` in `db.js` add a hover `title` to every Cost-Overview metric label (`card()` helpers in `index.html`/`project.html`). (2) **WP-form field tooltips** — small `ⓘ` info spans (native `title`) on Budget (BCB), Awarded Cost, No. of PO/JO and Charging. (3) **WP List empty state** — `_wpEmptyState()` in `project.html`: a brand-new project (no WPs) shows an **Add Work Package / Import from CSV** CTA (hidden for viewers/archived); a filtered-to-empty list shows a "no matches" hint. Used by `buildTable()` for both the table body and mobile cards.
   - **Wiring:** `index.html` + `project.html` each load `<script src="assets/js/onboarding.js?v=…">` (after ui.js/db.js) and call `Onboarding.maybeAutoOpen(profile.id, profile.role)` inside their `AppAuth.requireLogin` callback. To add to another page: include the script and call `maybeAutoOpen` (or rely on the injected **?** button for manual open). `onboarding.js` is versioned independently (`?v=20260708a`), NOT part of the 5-file shared `?v=` bump.
2. **Standalone deck** (`onboarding.html`, repo root) â€” 13-slide training deck, self-contained (Montserrat + Tabler via CDN, same as the app), keyboard/dot nav, `F` fullscreen, `P`/print CSS (one slide per page). Covers all three tiers in full (for group training). Not linked from the app.
3. **PowerPoint** (`WPM_Dashboard_Onboarding.pptx`, repo root) â€” editable pptxgenjs-generated version mirroring the deck (13 slides, Calibri, circle-motif, no icon-font dependency). Regenerate from `scratchpad/gen.js` if content changes.

> `.claude/launch.json` (a `python -m http.server 8765` config) exists only to preview static pages locally â€” not a deploy dependency.

---

## Known Issues / Gotchas

1. **Generated columns**: `total_awarded`, `awarding_lead_time`, `variance` â€” never INSERT into them. Use `awarded_cost` and `lead_time`. `unmap()` strips all three automatically.
2. **Sticky tabs + overflow**: `overflow:hidden/clip` on any ancestor of `.view-tabs` breaks `position:sticky` in Safari. See CSS section.
3. **READ-ONLY badge**: never set `display:inline-flex` as inline style on `.topbar-badge-readonly` â€” mobile media query can't override it.
4. **N+1 query**: never use `Promise.all(projects.map(p => WPDb.getApprovedWPs(p.id)))` â€” use `getAllApprovedWPs()` or `getApprovedWPsForProjects(ids)`.
5. **Role caching**: `window.__wpmRole` set once at login. Role/project changes require the user to log out and back in.
6. **Chart.js leaks**: always `chartInstance.destroy()` before re-rendering.
7. **Trade name consistency â€” 10 canonical trades only**: `normTrade(t)` in `index.html` and `project.html` (identical) collapses EVERY trade string into one of exactly 10: General Requirements, Site Works, Structural Works, Architectural Works, Mechanical Works, **Electrical and Auxiliary Works**, Plumbing Works, Fire Protection Works, Allied Services, Site Development Works. **Electrical Works and Auxiliary Works are combined into a single bucket named "Electrical and Auxiliary Works"** (per user request â€” the combined label keeps Auxiliary visible in the trade name): `electrical works` â†’ Electrical and Auxiliary Works; `auxiliary works` â†’ Electrical and Auxiliary Works; the combined `electrical and auxiliary works` / `electrical & auxiliary works` â†’ Electrical and Auxiliary Works. Other variants: OPW101 granular arch sub-trades â†’ Architectural; Structural Labor And Services â†’ Structural; Housekeeping & Sanitation / Drawing / Security Services â†’ General Requirements; Other Allied Services â†’ Allied Services. Keyword-regex fallback: both `/electr/` AND `/auxiliary/` â†’ Electrical and Auxiliary Works. Applied at data load time. `IDX_TRADE_ORDER`/`TRADE_ORDER` list the same 10 (drives chart colour order; the combined label sits in the Electrical slot, "Auxiliary Works" removed). Keep the explicit map + keyword fallback in sync across both files.
8. **Supabase cold start**: free tier pauses after 7 days â†’ 5â€“30s delay. UptimeRobot ping every 3â€“4 days prevents this.
9. **Duplicate `saveProject` in db.js**: second definition shadows first â€” harmless but note when editing.
10. **dp_percent**: stored as decimal (0.20 = 20%). Form input accepts percentage (user types "20"), divided by 100 before storing; edit mode multiplies by 100 to display.
11. **Sticky columns require `table-layout:fixed` + colgroup**: Both `index.html` (`renderWPMonTable`) and `project.html` (`buildTable`) use `<table style="table-layout:fixed">` + a `<colgroup>` rebuilt on every render with explicit pixel widths matching the column defs. Without this, the browser auto-sizes columns narrower than the hardcoded sticky `left` offsets â€” causing sticky cells to physically overlap adjacent columns. Always keep colgroup in sync: `cg.innerHTML = cols.map(c => \`<col style="width:${c.w}px;min-width:${c.w}px">\`).join('')`.
12. **Sticky column chain must be contiguous**: All sticky columns must be consecutive from the left with no non-sticky column in between. A non-sticky column between two sticky ones causes the right sticky column to get a wrong `left` offset. In `index.html` overview: project(0)â†’cost_code(90)â†’wp_no(180); description NOT sticky. In `project.html` overview: cost_code(0)â†’wp_no(90)â†’works(180); description NOT sticky. In non-overview tabs (both pages): description is made sticky immediately after wp_no. In the **All tab** only `wp_no` and `description` are frozen â€” description is placed right after wp_no in the column order (before works) so the chain is unbroken.
13. **Period chart mode/button mismatch**: `_idxSchPeriodMode` (Schedule), `_idxDashPeriodMode` (Dashboard), `_idxBudPeriodMode` (Budget), `_idxBlPeriodMode` (Backlog) in `index.html` must match the button that is styled active in HTML. Schedule also has `_idxSchDataMode` (`'count'` default = # WPs; `'budget'` = BCB/Awarded). `_renderIdxSchPeriodChart()` branches on both. Mismatch = chart renders wrong on first load.
    - **Backlog period charts pass `{hideAwarded:true}`**: the Backlog tab (both pages) feeds `budgetAwardedByPeriod`/`Monthly` only not-awarded WPs, whose Awarded/Cumulative-Awarded series are â‚±0 by definition (red line stuck flat at 0M). All four backlog call sites pass `{hideAwarded:true}` so those two series are omitted â€” only Budget bars + Cumulative Budget line render. Don't remove the opts arg. The Dashboard tab instances get ALL WPs and keep all four series.
14. **Staging credential swap**: `git push origin main` (PMODepartment) and `git push dev staging:main` (fmlozano-pmo) use different GitHub accounts. After pushing to one, Windows Credential Manager caches that account and the next push to the other fails with 403. Fix: run `git credential reject` (protocol=https, host=github.com) before each cross-account push, then re-authenticate when prompted.
15. **Staging schema setup**: New Supabase staging project requires (1) run `supabase-schema.sql` in SQL Editor, (2) run all `ALTER TABLE` migrations from CLAUDE.md, (3) run GRANT statements: `GRANT SELECT,INSERT,UPDATE ON public.users TO authenticated; GRANT INSERT ON public.users TO anon; GRANT ALL ON public.users TO service_role;` (repeat for projects, work_packages, claims). Without GRANTs, all REST API calls return 403 even with valid JWT.
16. **WP List `buildTable`/`renderWPMonTable` rendering pattern**:
17. **`actualAward` / awarded count come from `helpingMetrics(wps)` in `db.js` — FULLY ROW-DERIVED** (no Helping Sheet; `HELPING_FIGURES = {}`). **Stricter awarded definition:** a WP is awarded only when **`award_status==='Awarded'` AND `total_awarded>0`** ("if it's awarded it must have an awarded cost"). Awarded count, Awarded Cost (= "Actual Award") AND Budget-for-Awarded all use that SAME set so they reconcile with each other, with the chart/forecast, and with the source Helping Sheets. `totalBudget = Σ approved_budget_bcb` (all rows). Self-maintaining for every project incl. new ones. **All six projects (AVR/GRP/OPW/SLN/SLT/UTM) were reconciled against their WP-Monitoring files** and this basis reproduces their Helping Sheets — and CORRECTS AVR101 (its Helping Sheet under-counted ₱8.9M because its date-gated `SUMIFS` over a hardcoded row range silently dropped awarded WPs with a blank actual-award date / below the last row → AVR truly runs ~₱10M OVER budget). It also rejects the opposite failure mode (GRP/SLN/SLT/OPW had **provisional costs on "Not yet Awarded" WPs** that a naive `total_awarded>0` basis over-counted — the `award_status` filter excludes them). `HELPING_FIGURES` + the override branch are retained only as an escape hatch (currently empty); prefer fixing rows. The **chart/forecast budget series** (`budgetAwardedByPeriod`/`Monthly` `isAwd` + the `_wpForecastLine` `awardedFn`) use the SAME `award_status==='Awarded' && total_awarded>0` predicate so chart ↔ KPI agree. Use `project.html?id=<PID>&diag=1` for a per-project awarded reconciliation. Consumers: `buildMetrics()`/`renderOvBattery()`/`renderStatusTable()` (project.html); `renderAll()`/`renderIdxOvBattery()`/`computeStats()` (index.html). `Cost to Complete = totalBudget − budgetAwarded`; `Variance = totalBudget − (awardedCost + CTC)`. Due-Not-Awarded / Not-Due splits remain row+date derived. **Data-quality note:** awarded WPs with a blank cost, or costs on not-yet-awarded WPs, are excluded by design — fix them at source (the diag panel lists them).
18. **`award_status` is DERIVED from `procurement_status`**: `award_status` (`Not Yet Awarded | Awarded` — **"Partially Awarded" removed**, no partial state) follows `procurement_status` (`Not Started | Sourcing | Solicitation | Evaluation & Negotiation | Awarded`): **proc `Awarded` → award `Awarded`; any earlier stage → `Not Yet Awarded`.** One-way (proc drives award). Enforced in: **WP form** `onProcStatusChange()` (award select disabled/auto); **Status Tracker** (`updateWpStatus` — the Award column is a **read-only badge** `_stAwardBadge`, and changing Procurement Status sets award, opening the `#st-award-modal` for cost+vendor when →Awarded); **CSV import** still sets award from the WP-Monitoring **Remarks (Col P)** text. Dashboard KPIs (`buildMetrics`, `computeStats`, `helpingMetrics`) still read `award_status` (now kept consistent with proc). Because awarded requires an Awarded Cost + Vendor (safeguard), setting proc→Awarded triggers that requirement.
18. **Dashboard stale data / bfcache**: `project.html` has a `pageshow` handler that calls `__wpmReloadFn()` when restored from bfcache. `index.html` has a `pageshow` handler that busts the `wpm_wps_idx_*` sessionStorage cache and reloads. `wp-form.html` and `review.html` bust that cache on save/approve/reject. Never revert these handlers. Use `_stickyLeft = {}` dict (never mutate col objects with `c._left`). Build thead via `innerHTML` with `white-space:normal;overflow:hidden` on `<th>` â€” NOT `nowrap`, which overflows adjacent cells. Build tbody via `innerHTML` string concat with a `renderCell(key, wp)` switch. Trade group header: split into `<td colspan=nSticky>` (sticky, `left:0`) + `<td colspan=rest>` (non-sticky, WP count right-aligned) â€” a full-colspan cell has nothing to stick against horizontally.

---

## Workflow Rules

- **After every prompt:** Update relevant sections of this CLAUDE.md, then commit and push all modified files (including CLAUDE.md) to **production only** (`git push origin main`). **NEVER push to staging** (`git push dev staging:main`) â€” user has explicitly stopped staging pushes.
- **Cross-account push 403:** Windows Credential Manager caches one GitHub account at a time. Before switching accounts, run `git credential reject` (protocol=https, host=github.com) then re-authenticate when prompted. See Known Issues #14.

---

## Deployment

```bash
git add <files>
git commit -m "description"
# Push to production (PMODepartment/prc-app)
git push origin main
# Push to staging (fmlozano-pmo/prc-app-dev) â€” clear credentials first if last push was to prod
git push dev staging:main
```

GitHub Pages auto-deploys on push to main (~1â€“2 min).

---

## Development Notes

- Pure vanilla JS â€” no npm, no bundler, no TypeScript
- Supabase via UMD bundle (`supabase.min.js`) â€” `window.supabase.createClient()` called in `auth.js`
- Always use `AppAuth.requireLogin()` / `AppAuth.requireAdmin()` as page entry point
- `WPDb.mapWP()` normalizes aliases: `budget_bcb` â†” `approved_budget_bcb`, `contract_amount_php` â†” `total_awarded`
- `Fmt.money(v)` **auto-scales**: `â‚±16.52B` for â‰¥1e9, else `â‚±X.XXM` (so billions aren't shown as an ambiguous `â‚±16521.42M`); `Fmt.moneyShort(v)` â†’ `â‚±16.52B`/`â‚±2.40M`/full <1M (KPI headlines); `Fmt.moneyFull(v)` â†’ `â‚±16,521,423,165` (tooltips); `Fmt.date(d)` â†’ `May 29, 2025` (global date format is **Mmm dd, yyyy**; old mm/dd/yyyy formatters switched)`
- **Chart number format**: `charts.js` `_mAbbr(vM)` (datalabels) and `_axM(vM)` (axis ticks) take a value **already in millions** and render B/M (`16.5B` / `350M`). All chart datalabels, axis callbacks, and the per-trade donut centre labels route through these â€” never re-introduce a bare `(.../1e6).toFixed(1)+'M'`. **`_mAbbr` ALWAYS appends `M`/`B`, so only use it for money charts.** `wpAgingBuckets` (Work Package by Aging Bucket) plots **WP COUNTS**, not money — its datalabel uses `String(Math.round(v))` (plain integer). Previously it wrongly used `_mAbbr`, so a count of 3 rendered as `3M`. Any count-based chart's datalabels must stay plain integers.
- **wpStatusDonut omits zero-count categories** — it builds the donut from only the present buckets (Awarded / Due but Not Awarded / Not Due), so a backlog (not-awarded only) set shows just the not-awarded slices, not an empty "Awarded" legend entry.
- **Trade palette**: the Works-tab stacked bar + Budget/Awarded/WP-count donuts use a shared 20-colour distinct palette (`#EE3124,#2D9B6F,#2563EB,#D97706,#7C3AED,#0EA5E9,#DB2777,#65A30D,#EA580C,#0D9488,#9333EA,#CA8A04,#DC2626,#16A34A,#4F46E5,#F59E0B,#BE185D,#0891B2,#84CC16,#92400E`) â€” replaced the old 10-colour set that had multiple near-greys (projects like OPW101 have ~19 trades). Defined as `COLORS` in the three charts.js trade funcs and inline for the index.html WP-count donut (`c-idx-wk-count`).
- **Top 5 Savings/Overbudget** (both pages) count **only `award_status==='Awarded'`** WPs (`withBoth` filter) â€” a Not Yet / Partially Awarded WP would otherwise show phantom savings while still in progress. Top 5 by Contract Value still uses any `total_awarded>0`.
- **Top 5 rows are clickable** â†’ open the WP detail slide-in panel (`openWPDetail`). `buildRankTable` adds `onclick="openWPDetail(id)"` + `cursor:pointer` when the rank item carries an `id`; callers pass `id:w.id` in the mapped items. Lets users jump straight from a Top-5 row to full WP details + Edit/Delete instead of hunting in the WP List / Review tabs.
- **Table header alignment**: numeric table headers must match their cells' alignment (right for â‚± columns, center for counts/%) â€” left-aligned headers over right-aligned values read as "different columns". Fixed on the Budget Summary by Trade `<thead>` (`#idx-bud-table`).
- Charts: Chart.js v4.4.1 via cdnjs + `chartjs-plugin-datalabels@2.2.0` via jsdelivr; functions in `assets/js/charts.js`
- **PDF export** (`exportPDF` in `db.js`): jsPDF landscape A4, margin 14mm, usable width 269mm. Column widths sum to ~255mm (multi-project) / ~247mm (single). `tableWidth: avail` prevents overflow. Font 6.5pt. Use plain ASCII `'-'` for nulls and plain `M` suffix for monetary values â€” jsPDF Helvetica does not render `â‚±` or `â€”` (em-dash) correctly. Multi-project adds `Project` col (16mm); single-project widens `Description` to 48mm.
- **Planned-vs-Actual line styling + Forecast line**: across the cumulative Planned-vs-Actual WP-count charts (`wpCountByPeriodMonthly`, `wpCountByPeriod`, `wpByPeriodQuarterly`) and the `sCurve`, **only the Forecast line is dashed** â€” Cumulative Planned and Cumulative Actual are now **solid** (removed their old `borderDash`). Each adds a **`Forecast`** dataset (same red `#EE3124`, `borderDash:[6,4]`) continuing the Actual line by projecting the **not-yet-awarded** WPs toward 100%. **Forecast award/completion month per WP** (`_wpForecastLine` for count charts; inline `fdate` in `sCurve`): already-Awarded â†’ excluded (Actual); not-awarded with **planned `awarding_date` still in the future** â†’ its **planned award month** (on-schedule); not-awarded **overdue** (planned date < today) or no planned date â†’ the **next period** after today (backlog assumed cleared next period). Anchored to the current Actual total (null before today's period) so the dashed line joins the solid Actual line and climbs to total WPs. **`_wpForecastLine(keys,keyOf,wps,cumActual,valFn,awardedFn)`** takes an optional `valFn` â€” default `()=>1` (counts) for the WP-count charts; the **₱ `budgetAwardedByPeriod(Monthly)` charts pass `w=>(w.approved_budget_bcb||0)/1e6`** so the Forecast = actual Cumulative Awarded (cost) so far + the **budget** of the remaining not-awarded WPs. **`awardedFn` (6th arg) is the predicate for "already counted in the Actual/Awarded cumulative line" and MUST match the chart's actual series, else the WP is double-counted (its cost in the anchor + its budget added again) and the dashed Forecast renders ABOVE the Cumulative Budget instead of below it by the savings.** Budget charts pass `w=>(w.total_awarded||0)>0` (their awarded series is `isAwd=total_awarded>0`); count charts pass `w=>!!_actAwDate(w)` (their actual series counts by actual award date); default is `award_status==='Awarded'`. This was the "forecast over budget despite ₱X savings" bug — caused by cost-bearing WPs flagged "Not yet Awarded" (`total_awarded>0` but `award_status!=='Awarded'`, common in the imports per #17) being both in the anchor and re-added at full budget. **The two forecast modes behave DIFFERENTLY on purpose (per user):** the **# WPs** forecast is a *normal S-curve* converging to the planned total (every WP = 1, no savings); the **₱ budget** forecast intentionally **ends at projected spend** â€” below the total Cumulative Budget by the savings already realised on awarded WPs (it does NOT force-converge to total budget). Do NOT re-add the `_fcBudgetValFn` scaling that made budget meet total BCB â€” that was explicitly reverted. The $ charts add the Forecast dataset only when **not** `hideAwarded` (so the Backlog instances â€” which have no Awarded series â€” skip it). **`_extendForecastAxis(set,wps,mode,hideAwd)`** adds the **current + next period** to the axis when a backlog exists, so projects whose WP dates are all in the past still give the dashed Forecast (and the awarded tail) somewhere to land â€” without it the forecast collapsed to a single invisible anchor point (the per-project Overview `c-dash-period` bug). **Cumulative Actual / Cumulative Awarded both stop at today** (`cumADisp`, `spanGaps:false`) on the count charts AND the $ charts â€” the solid red line ends at the current month/quarter and the dashed Forecast continues from there (no flat run into future budget periods).
- **Legend line keys**: `_lineLegendStyle(cfg)` runs inside `make()` for every chart â€” if the config has any line dataset it sets `legend.labels.usePointStyle=true` and gives line datasets `pointStyle:'line'` (renders a line key, not the default hollow box) while bar datasets get `pointStyle:'rect'` (stays a box). It also overrides `legend.labels.generateLabels` to copy each dataset's `borderDash` onto the legend item's `lineDash`, so the **Forecast key renders as a DASHED line** (not solid) in the legend. Pure bar/donut charts are untouched. Applies to the S-curve and all combo (bar+line) period charts.
- Data labels: plugin registered globally with `display:false` default; each chart opts in via `plugins.datalabels`. Helpers: `_dlBar(fmtFn, axis)` (outside-end), `_dlStacked(fmtFn)` (center, white), `_dlDonut(fmtFn, minPct)` (center, white, skip <5%), **`_dlTidy(fmtFn, [labels], frac)`** (declutters dense period charts: labels only the named series e.g. `['Budget (BCB)']`, **horizontal `rotation:0`** (was vertical `-90` — switched to horizontal for readability per user request), skips bars below `frac`Ã—series-max, default 6%). `budgetAwardedByPeriod`/`budgetAwardedByPeriodMonthly` take `opts.tidyLabels` â†’ use `_dlTidy`; the index.html **WP-List Filtered Analysis**, **Dashboard**, **Budget** (`_idxBudRenderPeriod`), and **Schedule** (`_idxSchRenderPeriod`) "Procurement Budget (BCB) and Awarded by Period" budget-mode call sites all pass `{tidyLabels:true}`. `_dlTidy(fmtFn, seriesColors, frac)` now takes a **`seriesColors` map** (`{'Budget (BCB)':'#231F20','Awarded':'#EE3124'}`) so **both** the Budget AND Awarded bars are labelled in **distinct colours** (Budget dark, Awarded red) â€” each series skips values below `frac`Ã—its-OWN-max; labels are now **horizontal** (`rotation:0`) for easier reading. Dark mode brightens via `darkMap` (`#231F20/#282C28â†’#DCDBDB`, `#EE3124â†’#FF7A6E`, `#2D9B6Fâ†’#5FD3A3`) (both had clashing overlapping labels with two series Ã— many months). Mobile already hides datalabels (`_mob()` â†’ `display:false`), so tidy only affects desktop. Dense charts (awardingLeadTime, budgetVsContract, varianceTrend, budgetByPeriodPerTrade, scheduleTimeline) keep labels off. Mobile: font 7px (vs 9px desktop) via `_mob()` check.
- **Dark mode**: Toggle button in topbar (`renderUserBar` in `db.js`). `AppTheme` IIFE in `ui.js` â€” `init(userId)`, `toggle(userId)`, `apply(dark)`. Preference stored in `localStorage`: `wpm_theme_{userId}` (per-user) + `wpm_theme_last` (fast anti-flash). Anti-flash IIFE at top of `ui.js` applies `dark-mode` class to `body` and `html` before render. `auth.js` calls `AppTheme.init(userId)` after profile load. Charts updated via `Charts.updateTheme(dark)` in `charts.js`.
  - **CSS pitfall â€” class rules vs attribute selectors**: inline `<style>` blocks in `project.html`/`index.html`/`admin.html` define `.budget-table`, `.ov-donut-card`, `.ov-stats-card`, `.works-kpi`, `.sched-wp`, `.kpi-card`, `.section-card`, `.user-table`, `.perf-table`, `.tab-btn` etc. with hardcoded light colors â€” these are CSS **class rules**, so they override the cascade and are NOT caught by inline-style attribute selectors (`[style*="color:#231F20"]`). Each needs an explicit `body.dark-mode .classname` override in `dashboard.css` (Tables + admin sections).
  - **Inline backgrounds covered by attribute selectors**: `#fff`â†’surface; `#f5f5f5/#f9f9f9/#f0f0f0/#fafafa/#f8f8f8/#e0e0e0/#ddd`â†’surface-2. `#fafafa`=total rows/trade headers, `#f8f8f8`=sticky WP headers/sub-tab container, `#e0e0e0`/`#ddd`=collapse/expand +/âˆ’ toggle badges (Works/Schedule/WP-List).
  - **Reserialised-style gotcha**: when JS sets ANY `element.style.*`, the browser reserialises the whole inline style, turning authored `#fff` into `rgb(255, 255, 255)` â€” which **escapes** the `[style*="background:#fff"]` selectors (e.g. `#proj-filter-btn` after `toggleProjFilter()` touches its style â†’ stayed bright white in dark mode). Fix: added `[style*="background: rgb(255, 255, 255)"]` variants + an explicit `body.dark-mode #proj-filter-btn` rule. For JS-mutated elements prefer an ID/class dark rule over relying on inline-color attribute selectors. **Schedule Summary by Project (`index.html`)**: `toggleSchProj`/`toggleSchTrade` mutate `style.display` on `#f0f0f0`/`#fafafa` rows â†’ reserialised to `rgb(240,240,240)`/`rgb(250,250,250)`, so they reverted to light after collapse+expand. Fixed by adding `rgb(240/250/248/245/249/224, â€¦)` variants to the surface-2 selector list in `dashboard.css`.
  - **`color-scheme: dark`**: set on `body.dark-mode` in `dashboard.css` so native form controls (`<select>` option popups, date pickers, scrollbars) render dark across all dashboard pages.
  - **`wp-form.html` dark mode**: form fields already use `var(--surface-2)`/`var(--text-primary)`; added an inline `body.dark-mode` block fixing the `:focus{background:#fff}` flash, the readonly `#f-type` field, `.form-section-title`, the `.ms-*` multiselect dropdown/pills, `.status-info`/`.alert-*`/`.rejection-box`, the `.bulk-import-card` banner, and the two `.modal-surface` modals (Template Picker, CSV Import).
  - **Buttons**: `body.dark-mode button:not([style*="color"])` gives a light default to buttons relying on the UA black `ButtonText` (e.g. Collapse/Expand toggles whose bg was darkened). Buttons with inline color or a 2-class rule still win.
  - **Charts (`charts.js`)**: `_themeConfig(cfg,dark)` remaps near-black brand hues (`#282C28/#231F20/#2B2C2B` â†’ `#9B9999`, a visible MID gray kept 65 levels below the `#DCDBDB` "Future"/"Not Due" buckets â€” at `#B8B7B7` the two grays were nearly identical in the Status donut; translucent bar variant `rgba(40,44,40,0.55)` â†’ `rgba(155,153,153,0.92)`) on **donut segments, bar fills (Budget(BCB)/Planned/Total WP bars â€” else invisible on dark), and combo-chart cumulative lines**, adds 2px surface arc separators to donuts, and flips `_dlBar` value-label color. Originals cached on the dataset (`_origBg`/`_origBorder`) so light mode restores exactly; idempotent.
    - **CRITICAL Chart.js v4 gotcha**: `_themeConfig` operates on the **config BEFORE `new Chart()`** (in `make()`), NOT on a live chart. Chart.js v4 caches bar element options, so mutating `dataset.backgroundColor` + `update()` on an existing chart re-resolves **line strokes but NOT bar fills** â€” bars stay their original near-black and look "stuck dark" even though `dataset.backgroundColor` reads correct. Therefore `make()` themes the config pre-construction, and `updateTheme()` (toggle) **destroys + re-creates** every chart (`new Chart(canvas, rethemedCfg)`) rather than mutate+update. Never revert to a post-creation `chart.update()` approach for bar colors.
  - **Mobile WP List cards (`.wpc*`)**: built in JS (`#proj-wp-cards`/`#wp-mon-cards`) but styled by `.wpc`/`.wpc-desc`/`.wpc-kv`/`.wpc-actions` etc. class rules (identical in both files). Dark overrides in the "Mobile WP List cards" section of `dashboard.css` (`.wpc` bgâ†’surface, textâ†’primary/secondary/hint, action buttonsâ†’surface-2).
  - **Top 5 rank tables**: do NOT add a blanket `body.dark-mode .rank-side { color }` rule â€” it kills the inline Savings(green `#2D9B6F`)/Overbudget(red `#EE3124`) accent colors. Let the inline-color attribute selectors recolor only neutral cells; accents are left untouched.
  - **Public-page dark mode (self-contained)**: `login.html`, `register.html`, `pending.html`, `forgot-password.html` don't load `ui.js`/`dashboard.css`, so each has its OWN inline dark mode (identical pattern): inline anti-flash `<script>` in `<head>` adds `dark-mode` to `<html>` from `wpm_theme_last` (or system pref if unset); CSS rules prefixed `html.dark-mode` (set early enough to avoid a white flash on `.form-wrap`/`.card`); a fixed top-right `.login-theme-toggle` (sun/moon inline SVG) calls `toggleLoginTheme()` which persists `wpm_theme_last`. Shares the `wpm_theme_last` key with the dashboard so the theme carries across the whole auth flow â†’ dashboard. Gotcha: `forgot-password.html`'s logo has an inline `filter:invert(1) brightness(0)` (black logo for the white card) â€” dark mode overrides it with `html.dark-mode .logo-wrap img{filter:none!important}` so the white logo shows. These are inline (no `?v=` needed; HTML revalidates via ETag).




















