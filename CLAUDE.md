# Megawide EPC Procurement — WPM Dashboard

## Project Overview
Work Package Management (WPM) Dashboard for Megawide Construction Corporation EPC projects. Tracks procurement work packages, award status, budgets, and contractors across multiple projects.

**Live URL:** https://pmodepartment.github.io/prc-app (login: `/login.html`) — migrated from Vercel 2026-06-01
**Stack:** Vanilla HTML/CSS/JS (no build step) + Supabase (PostgreSQL + Auth) + GitHub Pages hosting

---

## Architecture

### No build step — edit files directly, push to GitHub, GitHub Pages auto-deploys (~1–2 min).

### Key Files
| File | Purpose |
|---|---|
| `assets/js/auth.js` | Supabase auth wrapper — `AppAuth.requireLogin()`, `AppAuth.requireAdmin()`, `getSB()`, profile cache |
| `assets/js/db.js` | All DB operations via `WPDb.*` — also `computeStats()`, `Fmt.*`, `renderUserBar()` |
| `assets/js/ui.js` | Shared UI helpers — sidebar init, modals, toast, hamburger menu, iOS pinch-zoom prevention |
| `assets/css/dashboard.css` | Global styles, CSS variables, responsive breakpoints, view-tabs, mobile fixes |
| `supabase-schema.sql` | Full DB schema for reference |

> `assets/js/` files are canonical. Root-level copies (`auth.js`, `db.js`, `ui.js`) exist but are **not referenced by any page** — do not edit them.

### Pages
| File | Auth | Purpose |
|---|---|---|
| `login.html` | public | Sign-in |
| `register.html` | public | Self-registration (creates `pending` user) |
| `pending.html` | public | Shown to unapproved users |
| `forgot-password.html` | public | Password reset |
| `project-selector.html` | user | Project picker — shown after login; admins also see Portfolio Overview card |
| `index.html` | user | Portfolio Overview — consolidated dashboard with 7 tabs (Overview, Dashboard, Backlog, Budget, Schedule, Works, WP List) |
| `project.html` | user | Single project dashboard — tabs: Overview, Dashboard, Backlog, WP List |
| `wp-form.html` | user | Add / edit work package |
| `claim-form.html` | user | Add / edit claim or change order (`?section=change-order` for CO mode) — hidden feature |
| `my-wps.html` | user | Officer's WP list |
| `review.html` | admin | Approve / reject pending WPs |
| `admin.html` | admin | User management + project management |

---

## Database (Supabase)

**URL:** `https://cayjeqeleenizbdzrums.supabase.co`

### Tables
- **`projects`** — `id` (text PK e.g. 'AVR101'), name, location, status, budget_bcb, start_date, end_date
- **`users`** — `id` (UUID FK → auth.users), email, role (`super_admin|admin|user`), status (`pending|approved|rejected`), projects (text[]), last_login (timestamptz)
- **`work_packages`** — all WP fields; `review_status` (`pending_review|approved|rejected`); `claim_tag` (text, nullable) — optional tag: `Extension of Time (EOT)|Material Escalation|Labor Escalation|Change Order`; see schema for full column list
- **`claims`** — `id`, `project_id`, `claim_no`, `claim_type` (`Extension of Time (EOT)|Material Escalation|Labor Escalation|Change Order`), `party` (`Client|Vendor`), `description`, `wp_no`, `contractor`, `date_filed`, `amount_claimed`, `basis`, `status` (`Draft|Filed|Under Review|Approved|Partially Approved|Rejected|Withdrawn`), `approved_amount`, `date_resolved`, `review_status` (`pending_review|approved|rejected`), `review_notes`, `remarks`, `submitted_by` (UUID FK → auth.users), `created_at`, `updated_at`

### WPDb API (db.js)
```js
WPDb.getProjects()                          // all projects
WPDb.getProject(id)                         // single project
WPDb.createProject(data)                    // new project
WPDb.updateProject(id, data)
WPDb.archiveProject(id)                     // sets status='archived'
WPDb.unarchiveProject(id)
WPDb.deleteProject(id)                      // also deletes all WPs

WPDb.getApprovedWPs(pid)                    // approved WPs for one project
WPDb.getAllApprovedWPs()                    // all approved WPs across all projects (single query)
WPDb.getApprovedWPsForProjects(ids)         // approved WPs for array of project IDs — single .in() query; used by consolidated dashboard to avoid N+1
WPDb.getAllWPs(pid)                         // all WPs regardless of status
WPDb.getPendingWPs()                        // pending_review WPs (admin)
WPDb.submitWP(data, user)                   // inserts with review_status='pending_review'
WPDb.updateWP(id, data)                     // update (resets to pending_review)
WPDb.updateWPDirect(id, data)               // update without status change
WPDb.approveWP(id)
WPDb.rejectWP(id, _, reason)
WPDb.getAllUsers()
WPDb.updateUser(id, updates)
WPDb.updateLastLogin(userId)                // writes current timestamp to users.last_login
```

### Auth Flow
1. `getSB()` — returns `window.__sb` (Supabase client created synchronously from UMD bundle on page load)
2. `AppAuth.requireLogin(cb)` — checks session → loads profile from **sessionStorage cache** if available, otherwise fetches from `users` table and caches → checks `status === 'approved'` → calls `WPDb.updateLastLogin()` → calls cb(user, profile)
3. `AppAuth.requireAdmin(cb)` — wraps `requireLogin`, additionally requires role in `['admin', 'super_admin']`
4. `AppAuth.logout()` — clears `wpm_prof_*` sessionStorage keys, signs out, redirects to login
5. Role stored in `window.__wpmRole`, profile in `window.__profile`, session in `window.__session`

**Profile cache:** Stored in `sessionStorage` under key `wpm_prof_{userId}`. Avoids a DB round-trip on every page navigation within the same tab session. Cleared on logout. Safe because sessionStorage is per-tab and clears when the tab closes.

### Supabase Email / Auth Settings
- **Email confirmation is disabled** — users register and go straight to `pending` status for admin approval; no email verification step required
- **Free tier cold start:** Supabase free tier pauses projects after 7 days of inactivity, causing 5–30s cold start. Fix: use UptimeRobot to ping the project URL every 3–4 days, or upgrade to Supabase Pro ($25/mo)
- **Email rate limit:** Free tier sends max ~3 auth emails/hour. For password reset reliability, configure a custom SMTP provider (Resend, Brevo, SendGrid) under Project Settings → Auth → SMTP

---

## Role-Based Access Control

| Role | Can Do |
|---|---|
| `user` | View/add WPs on assigned projects; WPs go to `pending_review` |
| `admin` | Approve/reject WPs; manage users; create/archive projects on assigned projects |
| `super_admin` | Full access to all projects + all admin features |

- Admins and super_admins see all projects; users see only projects in their `profile.projects[]` array
- When admin submits a WP via CSV import or form, it auto-approves (`WPDb.approveWP()` called after `WPDb.submitWP()`)
- Project assignment is per-user, stored as `text[]` in `users.projects`

---

## Navigation & Sidebar

### Navigation Context (`sessionStorage`)
- Key: `wpm_nav_ctx` — stores either a project ID (e.g. `'AVR101'`) or `'consolidated'`
- Set by `project.html` (to project ID) and `index.html` (to `'consolidated'`)
- Used by `admin.html` and `review.html` to show context-aware sidebar (back link vs full project list)

### Sidebar Structure per Page

**`project.html`**
```
Current Project
  └─ [project name] (active)

Work Packages
  ├─ Add Work Package
  └─ Review WPs (admin only, with pending badge)

Claims & Change Order Register    ← HIDDEN (style="display:none") — not yet active
  ├─ Add Claim
  ├─ Add Change Order
  └─ View Register

Tools
  └─ Download Template → opens picker modal

Admin (admin only)
  ├─ Portfolio Overview (→ index.html)
  ├─ User Management (→ admin.html)
  ├─ Pinned Projects
  └─ Recent Projects
```

**`admin.html`** — consolidated context (wpm_nav_ctx === 'consolidated')
```
Projects
  ├─ [searchable project list]
  └─ New Project

Admin
  ├─ User Management (active)
  └─ Portfolio Overview (→ index.html)
```

**`admin.html`** — project context (wpm_nav_ctx = project ID)
```
Current Project
  └─ Back to [Project Name]

Admin
  ├─ User Management (active)
  └─ Portfolio Overview (→ index.html)
```

**Key rules:**
- "Add Work Package" must NOT appear in `admin.html` — belongs only in `project.html`
- `admin.html` uses plain project links (no pin/star buttons)
- `project.html` uses `SidebarPrefs.projectLink()` with pin/star support
- `review.html` uses `SidebarPrefs.projectLink()` with custom href parameter
- The separate "Overview" section was removed from `admin.html` — "Portfolio Overview" now lives under the Admin section in both contexts

### SidebarPrefs (ui.js)
- Pins stored in `localStorage` key `wpm_sidebar_{userId}`
- `SidebarPrefs.projectLink(userId, project, extra, href)` — renders a nav-item with star toggle; optional `href` param overrides default `project.html?id=`
- `window.__sidebarRefresh` — callback registered by each page to re-render sidebar after pin toggle

---

## Favicon

All HTML pages include `<link rel="icon" type="image/png" href="assets/img/favicon.png"/>` in `<head>`. File: `assets/img/favicon.png`.

---

## Consolidated Dashboard (index.html)

Seven-tab layout (Claims tab is **hidden**):

| Tab | Content |
|---|---|
| **Overview** | Two KPI groups side-by-side (Cost Overview: 6 cards; Work Package Status: 6 cards) + project cards (cards/table toggle below) |
| **Dashboard** | Period chart (Monthly/Quarterly toggle) + WP by Trade bar + WP by Status donut + backlog table (not-awarded) + Top 5 panels |
| **Backlog** | Backlog table first (not-awarded, sorted most overdue) + aging chart + status donut + period chart (Quarterly/Monthly toggle) + submittal donut |
| **Budget** | 6 KPI cost cards + budget-by-period chart (Monthly/Quarterly toggle) + budget-by-trade HBar chart + **Budget (BCB) and Awarded by Project** grouped bar chart + budget summary table by trade (IDX_TRADE_ORDER sorted) |
| **Schedule** | Period chart (Monthly/Quarterly toggle) + WP by Trade bar + WP by Status donut + **collapsible** schedule summary table (project header row → click to expand trade sub-rows) |
| **Works** | Budget-by-period-per-trade stacked chart + Budget/Awarded/Count donuts by trade + **Procurement Budget (BCB) by Period per Scope** table (collapsible trade→works) + **Procurement Budget (BCB) and Awarded by Period per Scope** table |
| **WP List** | Full WP monitoring table — trade-grouped with collapse/expand headers (▼ chevron), fixed trade order, numeric WP-No sort, frozen Description column, search + pagination. No Trade column (redundant with group headers). |

**KPI label renames (Budget tab):** "Cost to Complete" → "Procurement Cost to Complete", "Est. at Completion" → "Procurement Estimate at Completion"

**Chart axis labels:** All money Y-axes now show `₱ Million` axis title; count X-axes show `Count`. Panel titles no longer include `(₱M)` suffix.

**IDX_TRADE_ORDER constant** (index.html `<script>`): Fixed trade order used for Budget table, Schedule sub-rows, and Works scope tables:
```javascript
const IDX_TRADE_ORDER = ['General Requirements','Site Works','Structural Works',
  'Architectural Works','Mechanical Works','Electrical Works','Auxiliary Works',
  'Plumbing Works','Fire Protection Works','Allied Services','Site Development Works'];
```

**`Charts.budgetAwardedByProject(id, wps, projects)`** — new function in `charts.js`: grouped bar (Budget BCB vs Awarded) per project ID. Called in Budget tab as `Charts.budgetAwardedByProject('c-idx-bud-by-proj', wps, filt)`.

**Data loading:** Single Supabase query using `WPDb.getAllApprovedWPs()` (admin) or `WPDb.getApprovedWPsForProjects(ids)` (user). **Do NOT revert to `Promise.all(permitted.map(p => WPDb.getApprovedWPs(p.id)))` — that causes N separate API calls (one per project), which is the main cause of slow mobile loading.**

**Lazy rendering:** `_rendered` flags per tab — charts only render when a tab is first opened. Filter changes reset all flags so tabs re-render fresh on next view.

**Read-only:** Consolidated view is read-only (no add/edit). Export button hidden on mobile. READ-ONLY badge hidden on mobile via `.topbar-badge-readonly { display: none }` — do NOT add `display:inline-flex` as inline style or the media query cannot override it.

---

## Per-Project Dashboard (project.html)

Tab order (left to right): **Overview → Dashboard → Backlog → WP List**

- **Overview**: Two KPI groups side-by-side (Cost Overview 6 cards / Work Package Status 6 cards). No charts, no monitoring table.
- **Dashboard**: Period chart (Monthly/Quarterly toggle, `c-dash-period`) + WP by Trade (`c-dash-trade`) + WP by Status donut (`c-dash-status`) + backlog table (not-awarded, overdue-first) + Top 5 panels (`rank-value`, `rank-gains`, `rank-losses`)
- **Backlog**: Backlog table first (8 columns: WP No., Description, Trade, Planned Award, Aging, Budget, Status, Submittal) + aging chart + status donut + period chart (Quarterly/Monthly toggle) + submittal donut. KPI cards removed.
- **WP List**: Trade-grouped with collapse/expand header rows (▼ chevron, `_collapseState` Map), fixed TRADE_ORDER sequence, numeric WP-No sort, frozen Description column. Trade column removed from table (replaced by group headers).
- Claims & Change Orders tab exists in HTML but is hidden (`style="display:none"`)

### Lazy rendering flags (project.html)
`_rendered = { overview, dashboard, backlog, table }` — set to `false` on filter change or data reload. `switchView` checks flag before calling render function.

---

## Template Picker Modal (shared pattern across pages)

A single "Download Template" button in the sidebar Tools section opens a picker modal with three styled cards:
- **Work Packages** — active; downloads `WPM_Import_Template.csv` via `downloadCSVTemplate()`
- **Claims** — **disabled** ("Coming soon"); greyed out, `cursor:not-allowed`, no onclick — pending Claims register completion
- **Change Orders** — **disabled** ("Coming soon"); greyed out, `cursor:not-allowed`, no onclick — pending Claims register completion

Present on: `project.html`, `wp-form.html`, `claim-form.html` (all use `#template-picker-modal`).

`openTemplatePickerModal()` / `closeTemplatePickerModal()` — toggle `display:flex/none`.

---

## WP Form — Identity & Classification Field Order (wp-form.html)

Current field order in the Identity & Classification section:
1. Cost Code No.
2. Trade / Discipline (cascading — triggers Works dropdown)
3. Works (cascading dropdown — updates based on Trade; `id="f-works"`)
4. Type (read-only — auto-fills "Service" or "Materials & Labor" from Works; `id="f-type"`)
5. WP No.
6. Work Package Description
7. Scope of Work (`id="f-scope"`, textarea)
8. Project
9. Zone
10. Detailed Description
11. Type of Service
12. Type of Procurement
13. Type of Contract
14. Proposed Vendors
15. No. of PO/JO
16. PO/JO Numbers

### Trade → Works → Type cascade (wp-form.html)

`TRADE_WORKS` JS object maps each Trade to an array of `[works, type]` pairs. Defined at top of `<script>` block.

Trade options: General Requirements, Site Works, Structural Works, Architectural Works, Mechanical Works, Electrical Works, Auxiliary Works, Plumbing Works, Fire Protection Works, Allied Services, Site Development Works.

- `onTradeChange()` — repopulates `#f-works` dropdown and clears `#f-type`
- `onWorksChange()` — sets `#f-type` to "Service" or "Materials & Labor"

**DB columns needed (run migration):**
```sql
ALTER TABLE work_packages ADD COLUMN IF NOT EXISTS works text DEFAULT NULL;
ALTER TABLE work_packages ADD COLUMN IF NOT EXISTS type_of_works text DEFAULT NULL;
ALTER TABLE work_packages ADD COLUMN IF NOT EXISTS scope text DEFAULT NULL;
ALTER TABLE work_packages ADD COLUMN IF NOT EXISTS actual_delivery date DEFAULT NULL;
```

### Actual Delivery Date (Schedule section)
`id="f-actual-delivery"` — added after Target Delivery Date. Optional; maps to `actual_delivery` DB column.

---

## CSV Import (Work Packages)

CSV import is in `wp-form.html` as a bulk import banner at the top of the content area.

`downloadCSVTemplate()` — generates `WPM_Import_Template.csv` with headers + 2 example rows.

**Headers:** Cost Code, WP No., Description, Zone, Trade, Planned Award Date, Actual Award Date, Target Delivery Date, Target Completion Date, Target Installation Date, Lead Time (Days), Budget BCB (PHP), Total Awarded (PHP), Procurement Status, Award Status, Contractor, PO/JO Count, PO/JO Numbers, Remarks

`importWPsFromCSV()` — parses rows, calls `WPDb.submitWP()` per row, then `WPDb.approveWP()` if admin/super_admin.

**Date parsing:** Uses `new Date(value).toISOString().split('T')[0]` — accepts MM/DD/YYYY or YYYY-MM-DD.

---

## WP Claim / Change Order Tag (wp-form.html + project.html WP List)

Optional field on each Work Package (`claim_tag` column in `work_packages`). Set via dropdown in `wp-form.html` after Remarks.

**Values:** `Extension of Time (EOT)` | `Material Escalation` | `Labor Escalation` | `Change Order` | null (none)

- Displayed as a color-coded badge in the WP List tab (`claimTagBadge()` helper in `project.html`)
- EOT → blue, Material Escalation → orange, Labor Escalation → amber, Change Order → green
- **DB migration required:** `ALTER TABLE work_packages ADD COLUMN IF NOT EXISTS claim_tag text DEFAULT NULL;`

---

## Claims & Change Orders Register (HIDDEN — independent feature, not yet active)

The full Claims & Change Orders register is built but hidden everywhere. To re-enable when ready:
- `project.html`: remove `style="display:none"` from the sidebar section and tab button (`data-view="claims-register"`)
- `index.html`: remove `style="display:none"` from the Claims tab button
- `template-picker-modal` in all three pages: restore active onclick and styling for Claims and Change Orders cards

### Data Model
Claims and Change Orders share the `claims` Supabase table, distinguished by `claim_type`:
- `claim_type = 'Extension of Time (EOT)'`, `'Material Escalation'`, `'Labor Escalation'` → Claims
- `claim_type = 'Change Order'` → Change Orders

### claim-form.html
- URL param `?section=change-order` switches to Change Order mode (`isCO = true`)
- `?project=ID` pre-selects project; `?id=UUID` enters edit mode
- Admin/super_admin: `review_status = 'approved'`, default `status = 'Filed'`
- User: `review_status = 'pending_review'`, default `status = 'Draft'`
- Sidebar shows Claims & Change Order Register section with Add Claim, Add Change Order, View Register

### project.html — Claims & Change Orders tab (`view-claims-register`)
- Single combined tab for both Claims and Change Orders
- Admin actions per row: Edit, Approve (✓), Reject (✗), Delete
- Users see Edit link only — edits re-queue as `pending_review`
- `approveClaim(id)` / `rejectClaim(id, reason)` / `deleteClaim(id)` — shared helpers

---

## CSS / Styling

### Design System (dashboard.css)
- Brand: `--mw-red: #EE3124`, `--mw-black: #231F20`, `--mw-dark: #282C28`
- Font: Montserrat — loaded via `<link>` in each HTML page (NOT `@import` in CSS)
- Icons: Tabler Icons v2.44 webfont (`ti ti-*`)

### Responsive Breakpoints
| Breakpoint | Behavior |
|---|---|
| `≥1024px` | Desktop — sidebar always visible (`240px`) |
| `≤1024px` | Tablet — sidebar shrinks to `220px` |
| `≤767px` | Mobile — sidebar becomes slide-in drawer (`transform: translateX(-100%)`) |
| `≤399px` | Small mobile — single column grid |

### View Tabs (Global — dashboard.css)
`.view-tabs` / `.view-tab` styles are defined globally in `dashboard.css`. **Do NOT redefine them inline in individual HTML files** — the global rule includes the sticky mobile behavior.

On mobile (`≤767px`) the tab bar is:
- `position: sticky; top: 52px` (52px = mobile topbar height)
- Horizontally scrollable (`overflow-x: auto; flex-wrap: nowrap`)
- Tabs do not wrap — they scroll off-screen

### Mobile Topbar (52px height)
- `.topbar-left`: `flex: 1; min-width: 0; overflow: hidden`
- `.topbar`: `overflow: visible` on mobile — **do NOT set to `hidden`**, it clips the user profile dropdown
- `.page-title`: `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`
- `.page-sub`: `display: none` on mobile
- `.hide-mobile`: hides export button text (or entire button on consolidated view)

### Consolidated Dashboard Sticky Tabs (index.html)
On mobile, `#filter-tabs-bar` is made `position: sticky; top: 52px` as a single unit. Its children (`#proj-filter-wrap` and `.view-tabs`) are `position: static` within it — do NOT make them individually sticky inside the bar, as they would overlap each other at the same `top` offset.

### Mobile Overflow / Horizontal Scroll Prevention
**Critical rule:** Do NOT set `overflow-x: hidden` or `overflow-x: clip` on `.main`, `.content`, `html`, or `body` in pages that use `position: sticky` tabs — any overflow value on a parent kills `position: sticky` in Safari iOS.

**Correct approach — clamp at element level:**
```css
canvas { max-width: 100% !important; width: 100% !important; }
.panel { min-width: 0; max-width: 100%; }
.grid-2 > *, .grid-3 > * { min-width: 0; }
.data-table, .budget-table { display: block; max-width: 100%; overflow-x: auto; }
```

Standalone pages without sticky tabs (`login.html`, `register.html`, `pending.html`, `forgot-password.html`, `project-selector.html`) use `overflow-x: hidden` on `html, body` safely.

### iOS Pinch Zoom Prevention
Added to `ui.js` (runs on every page that loads it):
```js
document.addEventListener('touchmove', e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
document.addEventListener('gesturestart', e => e.preventDefault());
```
The viewport `user-scalable=no` meta tag is also on all pages but is ignored by Safari iOS 10+; the JS above is the actual fix.

### Viewport Meta (All Pages)
All `.html` files have:
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"/>
```

### Mobile Hamburger Menu
- Button `.btn-menu` shown at `≤767px` (hidden on desktop via `display:none`)
- Sidebar gets class `.open` when toggled; `.sidebar-overlay` covers background
- Handled in `ui.js`

### Logo Styling (Global)
Logo is styled globally in `dashboard.css`:
```css
.sidebar-logo img { width: 140px; height: auto; display: block; }
```
**Do NOT add inline `.sidebar-logo img` CSS to individual HTML files.**

---

## Performance (Mobile Load Speed)

### Problem summary & fixes applied

| Problem | Fix |
|---|---|
| Scripts in `<head>` blocked HTML rendering (blank white screen on mobile) | Moved `auth.js`, `db.js`, `ui.js` to bottom of `<body>` |
| No early connections to CDN origins | Added `<link rel="preconnect">` for all CDN domains |
| Google Fonts via CSS `@import` (2 extra sequential round-trips) | Moved to `<link rel="stylesheet">` directly in HTML |
| Supabase ESM entry imported 5 sub-packages (6-request waterfall) | Switched to single UMD bundle (`supabase.min.js`) |
| Body scripts only started downloading when parser reached them | Added `<link rel="preload" as="script">` for all body scripts |
| User profile fetched from DB on every page navigation | Cached in `sessionStorage` under `wpm_prof_{userId}` |
| Consolidated dashboard fired one API call per project (N+1) | Replaced with single `getApprovedWPsForProjects(ids)` query |
| Hidden Claims fetch fired on every consolidated dashboard load | Removed — `_allClaims = []` since Claims tab is disabled |

### Script loading order (all pages)
All pages load scripts at the **bottom of `<body>`** in this order:
```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
<script src="assets/js/auth.js"></script>
<script src="assets/js/db.js"></script>
<script src="assets/js/ui.js"></script>
<!-- index.html and project.html also load Chart.js + charts.js here -->
<script>
  /* inline init — calls AppAuth.requireLogin() or AppAuth.requireAdmin() */
</script>
```
**Do NOT move any of these back to `<head>` without `defer`.** Blocking scripts in `<head>` prevent any HTML from rendering until all scripts download and execute.

### Resource hints (all pages `<head>`)
```html
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link rel="preconnect" href="https://cdn.jsdelivr.net"/>
<link rel="preconnect" href="https://cdnjs.cloudflare.com"/>  <!-- index.html + project.html only -->
<link rel="dns-prefetch" href="https://cayjeqeleenizbdzrums.supabase.co"/>
<link rel="preload" as="script" href="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"/>
<link rel="preload" as="script" href="assets/js/auth.js"/>
<link rel="preload" as="script" href="assets/js/db.js"/>
<link rel="preload" as="script" href="assets/js/ui.js"/>
<!-- index.html + project.html also preload Chart.js + charts.js -->
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700;800&display=swap"/>
```

### Remaining variability
The **Supabase free tier cold start** (5–30s on first load after 7 days inactivity) is the one remaining cause of extreme mobile lag. Fix: set up UptimeRobot to ping the project URL every 3–4 days.

---

## Known Issues / Gotchas

1. **Date validation:** `new Date(dateString)` can silently accept invalid dates. Always validate on input — `wp-form.html` validates Target Completion ≥ Planned Award Date.
2. **Role caching:** `window.__wpmRole` is set once at login. If role changes mid-session, user must log out and back in.
3. **Profile cache staleness:** `sessionStorage` profile cache is cleared on logout and when the tab closes. If an admin changes a user's role or project access, the affected user must close and reopen their tab to pick up the change.
4. **WP count refresh:** After adding/editing WPs, call `loadData()` to refresh counts in the sidebar badge.
5. **Chart.js memory leaks:** Destroy existing chart instances before re-rendering: `if (chartInstance) { chartInstance.destroy(); chartInstance = null; }`
6. **Duplicate `saveProject` in db.js:** Two definitions exist. The second shadows the first — harmless but should be cleaned up.
7. **READ-ONLY badge inline style:** Never add `display:inline-flex` as an inline style to `.topbar-badge-readonly` — the mobile media query sets `display:none` and inline styles override it.
8. **Sticky tabs + overflow:** `overflow: hidden/clip` on any ancestor of `.view-tabs` breaks `position: sticky` in Safari. Always clamp overflow at the element level, not the container level.
9. **Supabase free tier pause:** Project pauses after 7 days inactivity → 5–30s cold start on first load. Use UptimeRobot to ping every 3–4 days to prevent this.
10. **N+1 query anti-pattern:** Never use `Promise.all(projects.map(p => WPDb.getApprovedWPs(p.id)))` in the consolidated dashboard — use `getAllApprovedWPs()` or `getApprovedWPsForProjects(ids)` instead.

---

## Workflow Rules

- **After every prompt:** Update the relevant sections of this CLAUDE.md file to reflect what was added, fixed, or changed, then commit and push all modified files (including CLAUDE.md) to `origin/main`.

---

## Deployment

```bash
# Push to GitHub — GitHub Pages auto-deploys on push to main (~1–2 min)
git add <files>
git commit -m "description"
git push origin main
```

**GitHub:** https://github.com/PMODepartment/prc-app
**Live URL:** https://pmodepartment.github.io/prc-app
**Login:** https://pmodepartment.github.io/prc-app/login.html
*(Migrated from Vercel on 2026-06-01)*

---

## Development Notes

- No npm, no bundler, no TypeScript — pure vanilla JS loaded via `<script src="...">` tags
- Supabase client loaded via **UMD single bundle** (`supabase.min.js` from jsDelivr) — avoids the 6-sub-module ESM import waterfall. Loaded as `<script>` before `auth.js` at bottom of body; `window.supabase.createClient()` is called synchronously in `auth.js`
- All pages use `AppAuth.requireLogin()` or `AppAuth.requireAdmin()` as the entry point — never access DB directly without auth check
- `WPDb.mapWP()` normalizes field aliases (e.g., `budget_bcb` ↔ `approved_budget_bcb`, `contract_amount_php` ↔ `total_awarded`)
- `Fmt.money(v)` formats as `₱X.XXM`; `Fmt.moneyFull(v)` formats as `₱1,234,567`; `Fmt.date(d)` formats as `May 29, '26`
- Charts use Chart.js v4.4.1 loaded via CDN (cdnjs); chart functions are in `assets/js/charts.js`
- Power BI chart functions: `budgetAwardedByPeriod`, `wpByTrade`, `wpStatusDonut`, `wpSubmittalDonut`, `wpByPeriodQuarterly`, `wpAgingBuckets`, `budgetByTradeHBar`, `budgetByPeriodPerTrade`, `budgetByTradeDonut`, `awardedByTradeDonut`
