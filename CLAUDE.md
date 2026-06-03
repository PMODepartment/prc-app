# Megawide EPC Procurement — WPM Dashboard

## Project Overview
Work Package Management (WPM) Dashboard for Megawide Construction Corporation EPC projects. Tracks procurement work packages, award status, budgets, and contractors across multiple projects.

**Live URL:** https://pmodepartment.github.io/prc-app (login: `/login.html`)
**Stack:** Vanilla HTML/CSS/JS (no build step) + Supabase (PostgreSQL + Auth) + GitHub Pages hosting
**GitHub:** https://github.com/PMODepartment/prc-app

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

**WP List** (`index.html`): `_WPC` column defs + `_WP_VIEWS` + `_getActiveCols()`. `renderWPMonTable()` rebuilds colgroup/thead per view. `setWPListView(view)` switches + resets sort. `openWPDetail(w)` / `closeWPDetailModal()` — slide-in panel. All tab hidden for viewers.

**Collapse pattern**: items[] built from trade groups (header always + rows only if expanded). `toggleTradeGroup` / `collapseAllTrades` / `expandAllTrades`. Works tab uses DOM-only toggle (`toggleWkTrade`, `toggleWkBudget`). Schedule tab uses `toggleSchRow`.

**Project filter**: `_activeIds` Set; `toggleProjectPill` calls `renderAll()` immediately. Empty Set = "No projects selected" state (red label, empty charts).

**READ-ONLY badge**: never add `display:inline-flex` as inline style — media query sets `display:none` and inline overrides it.

---

## Per-Project Dashboard (project.html)

Tabs: Overview → Dashboard → Backlog → WP List

- **Overview**: Cost KPIs (6) + WP Status KPIs (6). No charts.
- **Dashboard**: Period chart + WP by Trade + WP by Status donut + backlog table + Top 5 panels
- **Backlog**: Filter bar (Trade, Sort, Search, Budget min/max) + backlog table + aging/status/period/submittal charts. `renderBacklog()` applies filters. Collapsible trade groups.
- **WP List**: 4 view tabs (Overview/Award/Schedule/Submittals). `WP_TABLE_VIEWS` + `getActiveCols()`. `setWPTableView(view)`. Collapsible trade groups. `openWPDetail(w)` slide-in panel.
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

`downloadCSVTemplate()` generates `WPM_Import_Template.csv`. `importWPsFromCSV()` parses by column position, calls `WPDb.submitWP()` per row (throws on error), then `WPDb.approveWP()` if admin.

**25-column mapping (position-based):**

| # | Header | DB Column |
|---|---|---|
| 0 | Cost Code No. | `cost_code` |
| 1 | Trade | `trade` |
| 2 | Works | `works` |
| 3 | WP No. | `wp_no` (required — row skipped if blank) |
| 4 | Work Package Description | `description` |
| 5 | Zone | `zone` |
| 6 | Scope of Work | `scope` |
| 7 | Charging Type | `charging_type` |
| 8 | Contract Package No. | `contract_package_no` |
| 9 | CO Description | `co_description` |
| 10 | Proposed Vendors | `proposed_vendors` |
| 11 | No. of PO/JO | `po_jo_count` |
| 12 | PO/JO Numbers | `po_jo_numbers` |
| 13 | Procurement Budget (BCB) (PHP) | `approved_budget_bcb` |
| 14 | Total Awarded (PHP) | `awarded_cost` (NOT `total_awarded` — generated) |
| 15 | Award Status | `award_status` |
| 16 | Procurement Status | `procurement_status` (default: Not Started) |
| 17 | Planned Award Date | `awarding_date` |
| 18 | Actual Award Date | `actual_awarding_date` |
| 19 | Target Delivery Date | `target_delivery` |
| 20 | Actual Delivery Date | `actual_delivery` |
| 21 | Target Completion Date | `target_completion` |
| 22 | Target Installation Date | `target_installation` |
| 23 | Lead Time (Days) | `lead_time` (NOT `awarding_lead_time` — generated) |
| 24 | Remarks | `remarks` |

Dates accept MM/DD/YYYY or YYYY-MM-DD.

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

---

## Workflow Rules

- **After every prompt:** Update relevant sections of this CLAUDE.md, then commit and push all modified files (including CLAUDE.md) to `origin/main`.

---

## Deployment

```bash
git add <files>
git commit -m "description"
git push origin main
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
