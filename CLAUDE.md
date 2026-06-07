# Megawide EPC Procurement — WPM Dashboard

## Project Overview
Work Package Management (WPM) Dashboard for Megawide Construction Corporation EPC projects. Tracks procurement work packages, award status, budgets, and contractors across multiple projects.

**Live URL:** https://pmodepartment.github.io/prc-app (login: `/login.html`)
**Staging URL:** https://fmlozano-pmo.github.io/prc-app-dev (login: `/login.html`)
**Stack:** Vanilla HTML/CSS/JS (no build step) + Supabase (PostgreSQL + Auth) + GitHub Pages hosting
**GitHub (prod):** https://github.com/PMODepartment/prc-app
**GitHub (staging):** https://github.com/fmlozano-pmo/prc-app-dev — branch `staging`, push via `git push dev staging:main`
**Supabase (prod):** `https://cayjeqeleenizbdzrums.supabase.co`
**Supabase (staging):** `https://duivwgmjcbxtfagkiqyj.supabase.co`

---

## Architecture

No build step — edit files directly, push to GitHub, GitHub Pages auto-deploys (~1–2 min).

### Key Files
| File | Purpose |
|---|---|
| `assets/js/auth.js` | Supabase auth wrapper — `AppAuth.requireLogin()`, `AppAuth.requireAdmin()`, `getSB()`, profile cache |
| `assets/js/db.js` | All DB operations via `WPDb.*` — also `computeStats()`, `Fmt.*`, `renderUserBar()` |
| `assets/js/ui.js` | Shared UI helpers — sidebar init, modals, toast, hamburger menu, iOS pinch-zoom prevention |
| `assets/css/dashboard.css` | Global styles, CSS variables, responsive breakpoints, view-tabs, mobile fixes |
| `supabase-schema.sql` | Full DB schema for reference |

> `assets/js/` files are canonical. Root-level copies (`auth.js`, `db.js`, `ui.js`) are **not referenced by any page** — do not edit them.

### Pages
| File | Auth | Purpose |
|---|---|---|
| `login.html` | public | Sign-in + Step 2 project picker. Shows Portfolio Overview card (admins), project list, Add New Project (admin/super_admin). On create → `project.html?id=<newId>`. |
| `register.html` | public | Self-registration (creates `pending` user) |
| `pending.html` | public | Shown to unapproved users |
| `forgot-password.html` | public | Password reset — `redirectTo` points to `/prc-app/login.html` |
| `index.html` | user | Portfolio Overview — consolidated dashboard, 7 tabs |
| `project.html` | user | Single project dashboard — 4 tabs |
| `wp-form.html` | user | Add / edit work package |
| `review.html` | user+ | View WP submissions for assigned projects; admins can approve/reject |
| `admin.html` | admin + manager | User management + project management (admin/super_admin); Performance tab (all three roles) |
| `claim-form.html` | user | Add / edit claim or CO — **hidden feature, not yet active** |
| `my-wps.html` | user | Officer's WP list |
| `project-selector.html` | user | Standalone picker — **unused, not linked** |

---

## Database (Supabase)

**URL:** `https://cayjeqeleenizbdzrums.supabase.co`

### Tables
- **`projects`** — `id` (text PK e.g. 'AVR101'), name, location, status, budget_bcb, start_date, end_date
- **`users`** — `id` (UUID FK → auth.users), name, email, role (`super_admin|admin|user|viewer`), status (`pending|approved|rejected`), projects (text[]), last_login
- **`work_packages`** — all WP fields. **Generated columns (never INSERT into):** `total_awarded` (= `awarded_cost + additionals`), `awarding_lead_time` (= `actual_awarding_date - awarding_date`), `variance` (= `approved_budget_bcb - total_awarded`). Use `awarded_cost` and `lead_time` instead. `unmap()` in `db.js` strips all three automatically.
- **`claims`** — `id`, `project_id`, `claim_no`, `claim_type`, `party` (`Client|Vendor`), `description`, `wp_no`, `contractor`, `date_filed`, `amount_claimed`, `basis`, `status`, `approved_amount`, `date_resolved`, `review_status`, `review_notes`, `remarks`, `submitted_by`

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
WPDb.getApprovedWPsForProjects(ids)        // approved WPs for array of IDs — avoids N+1
WPDb.getAllWPs(pid)                        // all WPs regardless of status
WPDb.getPendingWPs()                       // pending_review WPs (admin)
WPDb.submitWP(data, user)                  // inserts with review_status='pending_review'; throws on error
WPDb.updateWP(id, data)                    // update (resets to pending_review); throws on error
WPDb.updateWPDirect(id, data)             // update without status change; throws on error
WPDb.approveWP(id)
WPDb.rejectWP(id, _, reason)
WPDb.getAllUsers()
WPDb.updateUser(id, updates)
WPDb.updateLastLogin(userId)
```

### Auth Flow
1. `getSB()` — returns `window.__sb` (Supabase client, UMD bundle, created synchronously on page load)
2. `AppAuth.requireLogin(cb)` — checks session → loads profile from `sessionStorage` cache (`wpm_prof_{userId}`) or fetches from DB → checks `status === 'approved'` → calls cb(user, profile)
3. `AppAuth.requireAdmin(cb)` — wraps `requireLogin`, requires role in `['admin', 'super_admin']`
4. `AppAuth.logout()` — clears `wpm_prof_*` sessionStorage keys, signs out, redirects to login
5. Role in `window.__wpmRole`, profile in `window.__profile`

### Supabase Settings
- **Email confirmation disabled** — users go straight to `pending` for admin approval
- **Free tier cold start:** Pauses after 7 days inactivity → 5–30s delay. Use UptimeRobot (ping every 3–4 days) to prevent.
- **Email rate limit:** ~3 auth emails/hour on free tier. Use custom SMTP (Resend/Brevo) for reliability.

---

## DB Migrations — Run in Supabase SQL Editor (all IF NOT EXISTS, safe to re-run)

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
-- Viewer role
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('super_admin','admin','user','viewer'));
```

> The live DB was created from an early schema version. Any "column not found" error means a column needs to be added above — all statements are idempotent.

---

## Role-Based Access Control

| Role | Projects Visible | Edit WPs | Auto-Approve | Admin Rights | Cost Data |
|---|---|---|---|---|---|
| `super_admin` | All | All | ✅ | Full | ✅ |
| `admin` | All | All | ✅ | Users + Projects | ✅ |
| `specialist` | All (read) | Assigned only | ✅ | None | ✅ |
| `manager` | Assigned | Assigned | ✅ | None | ✅ |
| `user` | Assigned | Assigned | ❌ → pending_review | None | ✅ |
| `viewer` | Assigned | None | — | None | ❌ |

**Auto-approve roles** (`AppAuth.isAutoApprove(profile)`): `super_admin`, `admin`, `specialist`, `manager` — WPs save directly as `approved`; no `pending_review` step.

**Specialist** sees all projects in login picker and `index.html` (same as admin) but `canAccessProject()` still limits editing to `profile.projects`. Uses `getAllApprovedWPs()` (single query, no N+1).

**Viewer restrictions** (`body.viewer-mode` + `window.__isViewer`): cost KPIs hidden, Budget tab hidden, Financial WP List tab hidden, cost columns excluded via `_getActiveCols()`/`getActiveCols()`, Add WP + Edit buttons hidden, Tools section hidden, `wp-form.html` redirects immediately.

**Admin role restriction**: admins cannot assign `super_admin` or `specialist` roles to other users (only `super_admin` can).

**User → Manager assignment**: `assigned_admin` DB column stores the manager's UUID. `admin.html` uses `WPDb.getManagerUsers()` to populate the dropdown (role=`manager` only). The "Assign to Manager" section is visible to `super_admin` only. Column header in user table shows "Manager".

**DB constraint** (run in Supabase SQL Editor):
```sql
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('super_admin','admin','specialist','manager','user','viewer'));
```

Both approval modal (`modalRoleSelect`) and Change Role modal (`crm-role-select`) in `admin.html` include all 6 roles.

---

## Navigation & Sidebar

**Nav context** (`sessionStorage` key `wpm_nav_ctx`): stores project ID or `'consolidated'`. Set by `project.html` and `index.html`; read by `admin.html` and `review.html` for context-aware sidebar.

### Sidebar per Page

**`project.html`**
```
Current Project → [project name]
Work Packages → Add Work Package | Review WPs (admin, pending badge)
Claims & Change Order Register → HIDDEN (display:none)
Tools → Download Template
Admin (admin only) → Portfolio Overview | User Management | Pinned/Recent Projects
```

**`wp-form.html`**
```
Current Project → Back to [project]
Work Packages → WP Form | Review WPs (admin)
Navigation → Portfolio Overview
Tools → Download Template
Admin (admin only) → User Management
```

**`review.html`**
```
Overview → Portfolio Overview
Current Project → Back to [project] (project context only)
Projects → [list]
Work Packages → Add Work Package | Review WPs (active)
Admin → User Management
```

**`admin.html`** — consolidated context
```
Projects → [searchable list] | New Project
Admin → User Management (active) | Portfolio Overview
```

**`admin.html`** — project context
```
Current Project → Back to [project]
Admin → User Management (active) | Portfolio Overview
```

**Key rules:**
- "Add Work Package" must NOT appear in `admin.html`
- `admin.html` uses plain project links (no pin/star)
- `project.html` and `review.html` use `SidebarPrefs.projectLink()`
- `SidebarPrefs`: pins in `localStorage` key `wpm_sidebar_{userId}`; `window.__sidebarRefresh` callback re-renders after pin toggle

---

## Consolidated Dashboard (index.html)

Single Supabase query: `getAllApprovedWPs()` (admin) or `getApprovedWPsForProjects(ids)` (user). **Never revert to per-project N+1 calls.**

Lazy rendering: `_rendered` flags per tab — charts render on first open, reset on filter change.

**Tabs** (Claims tab hidden):

| Tab | Key content |
|---|---|
| Overview | Cost KPIs (6) + WP Status KPIs (6) + project cards/table |
| Dashboard | Period chart + WP by Trade bar + WP by Status donut + backlog table + Top 5 panels |
| Backlog | Backlog table + aging chart + status donut + period chart + submittal donut |
| Budget | Cost KPIs + budget-by-period + budget-by-trade HBar + Budget vs Awarded by Project grouped bar + budget table by trade |
| Schedule | Period chart + WP by Trade + WP by Status + collapsible schedule summary table |
| Works | Stacked period chart + donuts by trade + collapsible BCB by Period per Scope table + BCB & Awarded by Period per Scope table |
| WP List | Trade-grouped, 5 view tabs (Overview/Award/Schedule/Submittals/All), sortable headers, virtual pagination, slide-in detail panel |

**IDX_TRADE_ORDER** (used for Budget, Schedule, Works tables):
```js
['General Requirements','Site Works','Structural Works','Architectural Works',
 'Mechanical Works','Electrical Works','Auxiliary Works','Plumbing Works',
 'Fire Protection Works','Allied Services','Site Development Works']
```

**WP List** (`index.html`): `_WPC` column defs + `_WP_VIEWS` + `_getActiveCols()`. `renderWPMonTable()` rebuilds colgroup/thead per view and also populates `#wp-mon-cards` (mobile card view). `setWPListView(view)` switches + resets sort. `openWPDetail(w)` / `closeWPDetailModal()` — slide-in panel. All tab hidden for viewers.

**Mobile WP List (both pages)**: On ≤767px the `.wp-table-wrap` is hidden and `.wp-card-list` shown instead. Cards render from the same paged `items[]` — trade group header + one card per WP. Each card: WP No (red, tappable → detail panel) + status badge, description, trade › works, budget/awarded/variance (non-viewer), target award + delivery dates, vendors, View Details + Edit. CSS classes: `.wp-card-list`, `.wp-card`, `.wp-card-*`, `.wp-table-wrap` — defined in each page's inline `<style>` block.

**Collapse pattern**: items[] built from trade groups (header always + rows only if expanded). `toggleTradeGroup` / `collapseAllTrades` / `expandAllTrades`. Works tab uses DOM-only toggle (`toggleWkTrade`, `toggleWkBudget`). Schedule tab uses `toggleSchRow`.

**Project filter**: `_activeIds` Set; `toggleProjectPill` calls `renderAll()` immediately. Empty Set = "No projects selected" state (red label, empty charts).

**READ-ONLY badge**: never add `display:inline-flex` as inline style — media query sets `display:none` and inline overrides it.

---

## Per-Project Dashboard (project.html)

Tabs: Overview → Dashboard → Backlog → WP List

- **Overview**: Cost KPIs (6) + WP Status KPIs (6). No charts.
- **Dashboard**: Period chart + WP by Trade + WP by Status donut + backlog table + Top 5 panels
- **Backlog**: Filter bar (Trade, Sort, Search, Budget min/max) + backlog table + aging/status/period/submittal charts. `renderBacklog()` applies filters. Collapsible trade groups.
- **WP List**: 5 view tabs (Overview/Award/Schedule/Submittals/All). `WP_TABLE_VIEWS` + `getActiveCols()`. `setWPTableView(view)`. `buildTable()` renders colgroup + thead + tbody via `innerHTML` exactly like `renderWPMonTable()` in `index.html` — uses `_stickyLeft` dict (never mutates col objects), `renderCell` switch, `white-space:normal` on `<th>`. Trade group header splits into sticky + non-sticky cells. Also populates `#proj-wp-cards` (mobile card view — same paged items, CSS toggles visibility). `openWPDetail(w)` slide-in panel.
- Claims tab exists in HTML but hidden (`display:none`)

`_rendered = { overview, dashboard, backlog, table }` — reset on filter change or data reload.

---

## WP Form (wp-form.html)

### Sections & Key Fields
1. **Identity & Classification**: Cost Code, Trade → Works → Type (cascade), WP No., Description, Scope, Project, Zone, Detailed Description, Type of Service, Type of Procurement, Type of Contract, Proposed Vendors, No. of PO/JO, PO/JO Numbers
2. **Approval Matrix**: Responsible (multi-select), Approver (single select, admin/super_admin only), Support (multi-select). All from `WPDb.getAllUsers()`. Uses `u.name` for display. Values stored comma-separated in `responsible_team` / `approver` / `support_team`.
3. **Insurance Bonds**: Surety Bond, Performance Bond, Warranty Bond
4. **Material/Subcon Submittals**: Requires Approval, Type of Submittal, Name of Approver, Date of Approval
5. **Procurement Schedule**: Lead Time (→ `lead_time`), Awarding Date, Actual Awarding Date, Target Delivery, Actual Delivery, Target Installation, Target Completion
6. **Budget & Contract**: Procurement Budget (BCB) (→ `approved_budget_bcb`), Contract Amount (→ `awarded_cost`), Award Status, Vendor/s (→ `contractor`)
7. **Payment Terms**: Terms (Days), Down Payment % (free numeric input — user enters percentage e.g. 20, stored as 0.20), DP Terms, DP Amount, Date of DP Release, Payment Notes, Retention %, Retention Amount, Retention Period
8. **Procurement Status**: Procurement Status, Submittal Status, Delivery Status, Remarks, Charging (required: Main Contract → Contract Package No. | Change Order → CO Description)

### Trade → Works → Type Cascade
`TRADE_WORKS` object maps Trade → array of `[works, type]`. `onTradeChange()` repopulates Works; `onWorksChange()` sets Type ("Service" or "Materials & Labor").

### Approval Matrix Multi-Select
`toggleMs(field)`, `msClearAll(field)`, `getMsValues(field)`, `_setMsFromText(field, text)`, `_msPillRemove(field, uid)`. Mobile: dropdown uses `position:fixed` full-width.

### Budget Input Formatting
`f-budget` uses `type="text" inputmode="numeric"` with comma formatting on blur, stripped on focus. All reads use `.replace(/,/g,'')` before `parseFloat`.

### Unsaved Changes Guard
`formDirty` flag. `markDirty()` on input/change events. `markClean()` called on successful save. `beforeunload` fires only if `formDirty`.

---

## CSV Import (Work Packages)

`downloadCSVTemplate()` generates `WPM_Import_Template.csv`. Both `project.html` and `wp-form.html` share the same 54-column template. `importWPsFromCSV()` parses by column position, calls `WPDb.submitWP()` per row (throws on error), then `WPDb.approveWP()` if auto-approve role. Legacy files (<40 cols) are still accepted via format detection.

**54-column mapping (position-based) — WP No. at col 4 is required (row skipped if blank):**

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
| 41 | Down Payment % | `dp_percent` | enter as e.g. 20 → stored as 0.20 |
| 42 | DP Terms | `dp_terms` | |
| 43 | DP Amount (PHP) | `dp_amount` | |
| 44 | Date of DP Release (MM/DD/YYYY) | `dp_release_date` | |
| 45 | Payment Notes | `dp_notes` | |
| 46 | Retention % | `retention_percent` | enter as e.g. 10 → stored as 0.10 |
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

## Claims & Change Orders (HIDDEN — not yet active)

To re-enable: remove `style="display:none"` from sidebar section + tab button in `project.html`; Claims tab button in `index.html`; restore Claims/CO cards in template picker modals.

`claim-form.html`: `?section=change-order` for CO mode, `?project=ID` pre-selects project, `?id=UUID` for edit. Claims and COs share the `claims` table distinguished by `claim_type`.

---

## CSS / Styling

**Design system**: `--mw-red: #EE3124`, `--mw-black: #231F20`, `--mw-dark: #282C28`. Font: Montserrat via `<link>` (not `@import`). Icons: Tabler Icons v2.44 (`ti ti-*`).

**Breakpoints**: ≥1024px desktop sidebar (240px) | ≤1024px tablet (220px) | ≤767px mobile slide-in drawer | ≤399px single-column.

**View tabs** (`.view-tabs` / `.view-tab`): defined globally in `dashboard.css` — do NOT redefine inline. On mobile: `position:sticky; top:52px`, horizontally scrollable.

**Mobile topbar** (52px): `.topbar` must have `overflow:visible` — `hidden` clips the user profile dropdown.

**Critical — sticky tabs + overflow**: Never set `overflow-x:hidden` or `overflow-x:clip` on `.main`, `.content`, `html`, or `body` on pages with sticky tabs — kills `position:sticky` in Safari iOS. Clamp overflow at element level:
```css
canvas { max-width:100% !important; }
.panel, .grid-2 > *, .grid-3 > * { min-width:0; }
.data-table, .budget-table { display:block; overflow-x:auto; }
```
Standalone pages (login, register, pending, forgot-password) without sticky tabs can use `overflow-x:hidden` safely.

**Logo**: styled globally in `dashboard.css` — do NOT add inline `.sidebar-logo img` CSS to individual HTML files.

**iOS pinch zoom**: handled in `ui.js` via `touchmove` + `gesturestart` listeners. `user-scalable=no` viewport is ignored by Safari iOS 10+.

---

## Script Loading (Dashboard Pages)

Scripts at **bottom of `<body>`** in this order — do NOT move to `<head>` without `defer`:
```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
<script src="assets/js/auth.js"></script>
<script src="assets/js/db.js"></script>
<script src="assets/js/ui.js"></script>
<!-- index.html + project.html also load Chart.js + charts.js -->
<script>/* inline init */</script>
```

Public pages (login, register, pending, forgot-password) load UMD bundle inline and call `window.supabase.createClient()` directly — they do NOT load `auth.js`/`db.js`/`ui.js`.

Resource hints in `<head>`: `preconnect` for fonts.googleapis.com, fonts.gstatic.com, cdn.jsdelivr.net, cdnjs.cloudflare.com; `dns-prefetch` for Supabase URL; `preload as="script"` for all body scripts.

---

## Known Issues / Gotchas

1. **Generated columns**: `total_awarded`, `awarding_lead_time`, `variance` — never INSERT into them. Use `awarded_cost` and `lead_time`. `unmap()` strips all three automatically.
2. **Sticky tabs + overflow**: `overflow:hidden/clip` on any ancestor of `.view-tabs` breaks `position:sticky` in Safari. See CSS section.
3. **READ-ONLY badge**: never set `display:inline-flex` as inline style on `.topbar-badge-readonly` — mobile media query can't override it.
4. **N+1 query**: never use `Promise.all(projects.map(p => WPDb.getApprovedWPs(p.id)))` — use `getAllApprovedWPs()` or `getApprovedWPsForProjects(ids)`.
5. **Role caching**: `window.__wpmRole` set once at login. Role/project changes require the user to log out and back in.
6. **Chart.js leaks**: always `chartInstance.destroy()` before re-rendering.
7. **Trade name consistency**: use exact strings from the Trade dropdown. `normTrade(t)` in `index.html` and `project.html` maps legacy casing to canonical names — applied at data load time.
8. **Supabase cold start**: free tier pauses after 7 days → 5–30s delay. UptimeRobot ping every 3–4 days prevents this.
9. **Duplicate `saveProject` in db.js**: second definition shadows first — harmless but note when editing.
10. **dp_percent**: stored as decimal (0.20 = 20%). Form input accepts percentage (user types "20"), divided by 100 before storing; edit mode multiplies by 100 to display.
11. **Sticky columns require `table-layout:fixed` + colgroup**: Both `index.html` (`renderWPMonTable`) and `project.html` (`buildTable`) use `<table style="table-layout:fixed">` + a `<colgroup>` rebuilt on every render with explicit pixel widths matching the column defs. Without this, the browser auto-sizes columns narrower than the hardcoded sticky `left` offsets — causing sticky cells to physically overlap adjacent columns. Always keep colgroup in sync: `cg.innerHTML = cols.map(c => \`<col style="width:${c.w}px;min-width:${c.w}px">\`).join('')`.
12. **Sticky column chain must be contiguous**: All sticky columns must be consecutive from the left with no non-sticky column in between. A non-sticky column between two sticky ones causes the right sticky column to get a wrong `left` offset. In `index.html` overview: project(0)→cost_code(90)→wp_no(180); description NOT sticky. In `project.html` overview: cost_code(0)→wp_no(90)→works(180); description NOT sticky. In non-overview tabs (both pages): description is made sticky immediately after wp_no. In the **All tab** only `wp_no` and `description` are frozen — description is placed right after wp_no in the column order (before works) so the chain is unbroken.
13. **Period chart mode/button mismatch**: `_idxSchPeriodMode` (Schedule), `_idxDashPeriodMode` (Dashboard), `_idxBudPeriodMode` (Budget), `_idxBlPeriodMode` (Backlog) in `index.html` must match the button that is styled active in HTML. Mismatch = chart renders wrong period on first load (fixed: Schedule now defaults to `'monthly'`).
14. **Staging credential swap**: `git push origin main` (PMODepartment) and `git push dev staging:main` (fmlozano-pmo) use different GitHub accounts. After pushing to one, Windows Credential Manager caches that account and the next push to the other fails with 403. Fix: run `git credential reject` (protocol=https, host=github.com) before each cross-account push, then re-authenticate when prompted.
15. **Staging schema setup**: New Supabase staging project requires (1) run `supabase-schema.sql` in SQL Editor, (2) run all `ALTER TABLE` migrations from CLAUDE.md, (3) run GRANT statements: `GRANT SELECT,INSERT,UPDATE ON public.users TO authenticated; GRANT INSERT ON public.users TO anon; GRANT ALL ON public.users TO service_role;` (repeat for projects, work_packages, claims). Without GRANTs, all REST API calls return 403 even with valid JWT.
16. **WP List `buildTable`/`renderWPMonTable` rendering pattern**: Use `_stickyLeft = {}` dict (never mutate col objects with `c._left`). Build thead via `innerHTML` with `white-space:normal;overflow:hidden` on `<th>` — NOT `nowrap`, which overflows adjacent cells. Build tbody via `innerHTML` string concat with a `renderCell(key, wp)` switch. Trade group header: split into `<td colspan=nSticky>` (sticky, `left:0`) + `<td colspan=rest>` (non-sticky, WP count right-aligned) — a full-colspan cell has nothing to stick against horizontally.

---

## Workflow Rules

- **After every prompt:** Update relevant sections of this CLAUDE.md, then commit and push all modified files (including CLAUDE.md) to **both** production (`git push origin main`) and staging (`git push dev staging:main`).
- **Cross-account push 403:** Windows Credential Manager caches one GitHub account at a time. Before switching accounts, run `git credential reject` (protocol=https, host=github.com) then re-authenticate when prompted. See Known Issues #14.

---

## Deployment

```bash
git add <files>
git commit -m "description"
# Push to production (PMODepartment/prc-app)
git push origin main
# Push to staging (fmlozano-pmo/prc-app-dev) — clear credentials first if last push was to prod
git push dev staging:main
```

GitHub Pages auto-deploys on push to main (~1–2 min).

---

## Development Notes

- Pure vanilla JS — no npm, no bundler, no TypeScript
- Supabase via UMD bundle (`supabase.min.js`) — `window.supabase.createClient()` called in `auth.js`
- Always use `AppAuth.requireLogin()` / `AppAuth.requireAdmin()` as page entry point
- `WPDb.mapWP()` normalizes aliases: `budget_bcb` ↔ `approved_budget_bcb`, `contract_amount_php` ↔ `total_awarded`
- `Fmt.money(v)` → `₱X.XXM`; `Fmt.moneyFull(v)` → `₱1,234,567`; `Fmt.date(d)` → `May 29, '26`
- Charts: Chart.js v4.4.1 via cdnjs + `chartjs-plugin-datalabels@2.2.0` via jsdelivr; functions in `assets/js/charts.js`
- Data labels: plugin registered globally with `display:false` default; each chart opts in via `plugins.datalabels`. Helpers: `_dlBar(fmtFn, axis)` (outside-end), `_dlStacked(fmtFn)` (center, white), `_dlDonut(fmtFn, minPct)` (center, white, skip <5%). Dense charts (awardingLeadTime, budgetVsContract, varianceTrend, budgetByPeriodPerTrade, scheduleTimeline) keep labels off. Mobile: font 7px (vs 9px desktop) via `_mob()` check.
