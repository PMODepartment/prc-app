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
| `assets/js/auth.js` | Supabase auth wrapper — `AppAuth.requireLogin()`, `AppAuth.requireAdmin()`, `getSB()` |
| `assets/js/db.js` | All DB operations via `WPDb.*` — also `computeStats()`, `Fmt.*`, `renderUserBar()` |
| `assets/js/ui.js` | Shared UI helpers — sidebar init, modals, toast, hamburger menu, iOS pinch-zoom prevention |
| `assets/css/dashboard.css` | Global styles, CSS variables, responsive breakpoints, view-tabs, mobile fixes |
| `supabase-schema.sql` | Full DB schema for reference |

> `assets/js/db.js`, `assets/js/auth.js`, `assets/js/ui.js` are the canonical files. Some pages also reference root-level copies — if making changes, update `assets/js/` files and sync root copies if needed.

### Pages
| File | Auth | Purpose |
|---|---|---|
| `login.html` | public | Sign-in |
| `register.html` | public | Self-registration (creates `pending` user) |
| `pending.html` | public | Shown to unapproved users |
| `forgot-password.html` | public | Password reset |
| `project-selector.html` | user | Project picker — shown after login; admins also see Portfolio Overview card |
| `index.html` | user | Portfolio Overview — consolidated dashboard with 6 tabs |
| `project.html` | user | Single project dashboard (tabs: Overview, Backlog, Budget, Schedule, Works, WP List, Claims, Change Orders) |
| `wp-form.html` | user | Add / edit work package |
| `claim-form.html` | user | Add / edit claim or change order (`?section=change-order` for CO mode) |
| `my-wps.html` | user | Officer's WP list |
| `review.html` | admin | Approve / reject pending WPs |
| `admin.html` | admin | User management + project management |

---

## Database (Supabase)

**URL:** `https://cayjeqeleenizbdzrums.supabase.co`

### Tables
- **`projects`** — `id` (text PK e.g. 'AVR101'), name, location, status, budget_bcb, start_date, end_date
- **`users`** — `id` (UUID FK → auth.users), email, role (`super_admin|admin|user`), status (`pending|approved|rejected`), projects (text[]), last_login (timestamptz)
- **`work_packages`** — all WP fields; `review_status` (`pending_review|approved|rejected`); see schema for full column list
- **`claims`** — `id`, `project_id`, `claim_no`, `claim_type` (`Extension of Time (EOT)|Material Escalation|Labor Escalation|Change Order`), `party` (`Client|Vendor`), `description`, `wp_no`, `contractor`, `date_filed`, `amount_claimed`, `basis`, `status` (`Draft|Filed|Under Review|Approved|Partially Approved|Rejected|Withdrawn`), `approved_amount`, `date_resolved`, `review_status` (`pending_review|approved|rejected`), `review_notes`, `remarks`, `submitted_by` (UUID FK → auth.users), `created_at`, `updated_at`

### WPDb API (db.js)
```js
WPDb.getProjects()            // all projects
WPDb.getProject(id)           // single project
WPDb.createProject(data)      // new project
WPDb.updateProject(id, data)
WPDb.archiveProject(id)       // sets status='archived'
WPDb.unarchiveProject(id)
WPDb.deleteProject(id)        // also deletes all WPs

WPDb.getApprovedWPs(pid)      // approved WPs for project
WPDb.getAllWPs(pid)            // all WPs regardless of status
WPDb.getPendingWPs()          // pending_review WPs (admin)
WPDb.submitWP(data, user)     // inserts with review_status='pending_review'
WPDb.updateWP(id, data)       // update (resets to pending_review)
WPDb.updateWPDirect(id, data) // update without status change
WPDb.approveWP(id)
WPDb.rejectWP(id, _, reason)
WPDb.getAllUsers()
WPDb.updateUser(id, updates)
WPDb.updateLastLogin(userId)  // writes current timestamp to users.last_login
```

### Auth Flow
1. `getSB()` — lazy-loads Supabase client (CDN ESM import)
2. `AppAuth.requireLogin(cb)` — checks session → checks `users.status === 'approved'` → calls `WPDb.updateLastLogin()` → calls cb(user, profile)
3. `AppAuth.requireAdmin(cb)` — requires role in `['admin', 'super_admin']`
4. Role stored in `window.__wpmRole`, profile in `window.__profile`, session in `window.__session`

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
- When admin submits a Claim or Change Order (form or CSV), `review_status` is set directly to `'approved'`; users get `'pending_review'`
- Admin new claims/COs default to `status: 'Filed'`; user submissions default to `status: 'Draft'`
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
     └─ Switch Project (→ login.html)

Work Packages
  ├─ Add Work Package
  └─ Review WPs (admin only, with pending badge)

Claims (EOT)
  └─ Add Claim (→ claim-form.html?project=ID)

Change Orders
  └─ Add Change Order (→ claim-form.html?project=ID&section=change-order)

Claims & Change Orders
  └─ Register (→ project.html?tab=claims-register) — combined pending badge

Tools
  └─ Download Template → opens picker modal (WP / Claims / Change Orders)

Admin (admin only)
  ├─ Portfolio Overview (→ index.html?view=consolidated)
  ├─ User Management (→ admin.html)
  ├─ Pinned Projects
  └─ Recent Projects
```

**`admin.html`** — consolidated context (wpm_nav_ctx === 'consolidated')
```
Overview
  └─ Portfolio Overview (→ index.html?view=consolidated)

Projects
  ├─ [searchable project list]
  └─ New Project

Admin
  ├─ User Management (active)
  └─ Select Project (→ project-selector.html)
```

**`admin.html`** — project context (wpm_nav_ctx = project ID)
```
Current Project
  └─ Back to [Project Name]

Admin
  ├─ User Management (active)
  └─ Select Project (→ project-selector.html)
```

**Key rules:**
- "Add Work Package" must NOT appear in `admin.html` — belongs only in `project.html`
- `admin.html` uses plain project links (no pin/star buttons)
- `project.html` uses `SidebarPrefs.projectLink()` with pin/star support
- `review.html` uses `SidebarPrefs.projectLink()` with custom href parameter

### SidebarPrefs (ui.js)
- Pins stored in `localStorage` key `wpm_sidebar_{userId}`
- `SidebarPrefs.projectLink(userId, project, extra, href)` — renders a nav-item with star toggle; optional `href` param overrides default `project.html?id=`
- `window.__sidebarRefresh` — callback registered by each page to re-render sidebar after pin toggle

---

## Consolidated Dashboard (index.html)

Six-tab layout matching Power BI format:

| Tab | Content |
|---|---|
| **Overview** | 12 KPI metrics + project cards + 4 charts (budget by period, WP status donut, WP by trade, budget by trade) |
| **Backlog** | 2 KPI panels + aging chart + status donut + backlog table + period chart + submittal donut |
| **Budget** | 6 KPI panels + budget by period chart + budget by trade chart |
| **Schedule** | Period chart + trade chart + status donut + schedule summary table |
| **Works** | Stacked period chart + 3 donuts + summary table |
| **WP List** | Full WP monitoring table with search + pagination |

**Lazy rendering:** `_rendered` flags per tab — charts only render when a tab is first opened. Filter changes reset all flags so tabs re-render fresh on next view.

**Read-only:** Consolidated view is read-only (no add/edit). Export button hidden on mobile. READ-ONLY badge hidden on mobile via `.topbar-badge-readonly { display: none }` — do NOT add `display:inline-flex` as inline style or the media query cannot override it.

---

## Template Picker Modal (shared pattern across pages)

A single "Download Template" button in the sidebar Tools section opens a picker modal with three styled cards:
- **Work Packages** — downloads `WPM_Import_Template.csv` via `downloadCSVTemplate()`
- **Claims (EOT)** — downloads `Claims_Import_Template.csv` via `downloadClaimsCSVTemplate()`
- **Change Orders** — downloads `ChangeOrders_Import_Template.csv` via `downloadCOsCSVTemplate()`

Present on: `project.html` (`#template-picker-modal`), `wp-form.html` (`#template-picker-modal`), `claim-form.html` (`#template-picker-modal`). All three download functions must be defined on each page that hosts the modal.

`openTemplatePickerModal()` / `closeTemplatePickerModal()` — toggle `display:flex/none`.

## CSV Import — moved into forms

CSV import is no longer in the sidebar. Each form has a **bulk import banner** at the top of the content area:

- **`wp-form.html`** — banner with Template + Import CSV buttons; `openWPImportModal()` opens `#wp-import-modal`; after import redirects to `project.html?id=<pid>`
- **`claim-form.html`** — banner label updates to "Claims" or "Change Orders" based on `isCO`; Import CSV button calls `openClaimsCSVModal()` or `openCOsCSVModal()` accordingly

## CSV Import Feature (project.html)

### Work Packages CSV
`downloadCSVTemplate()` — generates `WPM_Import_Template.csv` with headers + 2 example rows.

**Headers:** Cost Code, WP No., Description, Zone, Trade, Planned Award Date, Actual Award Date, Target Delivery Date, Target Completion Date, Target Installation Date, Lead Time (Days), Budget BCB (PHP), Total Awarded (PHP), Procurement Status, Award Status, Contractor, PO/JO Count, PO/JO Numbers, Remarks

`openCSVImportModal()` / `closeCSVImportModal()` — modal `#csv-import-modal`.

`handleCSVFile(file)` — reads via FileReader, validates CSV, shows row count preview.

`importWPsFromCSV()` — parses rows, calls `WPDb.submitWP()` per row, then `WPDb.approveWP()` if admin/super_admin.

**Date parsing:** Uses `new Date(value).toISOString().split('T')[0]` — accepts MM/DD/YYYY or YYYY-MM-DD.

### Claims CSV
`downloadClaimsCSVTemplate()` — generates `Claims_Import_Template.csv`.

**Headers:** Claim No., Party, Description, Linked WP No., Contractor / Client Name, Date Filed, Amount Claimed (PHP), Basis / Grounds, Status, Remarks

`openClaimsCSVModal()` / `closeClaimsCSVModal()` — modal `#claims-csv-modal`.

`handleClaimsCSVFile(file)` / `importClaimsFromCSV()` — inserts rows with `claim_type = 'Extension of Time (EOT)'`; admin → `review_status: 'approved'`, user → `'pending_review'`.

### Change Orders CSV
`downloadCOsCSVTemplate()` — generates `ChangeOrders_Import_Template.csv`.

**Headers:** CO No., Party, Description, Linked WP No., Contractor / Client Name, Date Filed, Amount Claimed (PHP), Basis / Grounds, Status, Remarks

`openCOsCSVModal()` / `closeCOsCSVModal()` — modal `#cos-csv-modal`.

`handleCOsCSVFile(file)` / `importCOsFromCSV()` — inserts rows with `claim_type = 'Change Order'`; same admin/user review logic.

---

## Claims & Change Orders (project.html + claim-form.html)

### Data Model
Claims and Change Orders share the `claims` Supabase table, distinguished by `claim_type`:
- `claim_type = 'Extension of Time (EOT)'` → appears in the **Claims** tab
- `claim_type = 'Change Order'` → appears in the **Change Orders** tab

### claim-form.html
- URL param `?section=change-order` switches the form to Change Order mode (`isCO = true`)
- `?project=ID` pre-selects the project; `?id=UUID` enters edit mode
- Admin/super_admin submissions: `review_status = 'approved'`, default `status = 'Filed'`, button = "Add Claim" / "Add Change Order"
- User submissions: `review_status = 'pending_review'`, default `status = 'Draft'`, button = "Submit Claim for Review"
- Claim status options: Draft, Filed, Under Review, Approved, Partially Approved, Rejected, Withdrawn
- `claim_type` dropdown is **visible** for Claims mode (user selects: EOT / Material Escalation / Labor Escalation); **hidden + locked** to 'Change Order' in CO mode
- Section title updates: "Claim Details" for claims, "Change Order Details" for CO
- Sidebar shows Work Packages, Claims (EOT), Change Orders, and Tools sections regardless of mode
- Work Packages section: Add Work Package (→ `wp-form.html?project=ID`) + Review WPs (admin only, → `review.html?project=ID`)
- Active link highlighted based on `isCO`
- `updateSidebarLinks(pid)` wires all sidebar hrefs with project ID — called on both new and edit modes
- CSV Template and Import from CSV buttons in sidebar for both sections; import modals (`#claims-csv-modal`, `#cos-csv-modal`) embedded in the page with inline Download template links
- `downloadClaimsCSVTemplate()`, `downloadCOsCSVTemplate()`, `importClaimsFromCSV()`, `importCOsFromCSV()` all available on this page

### project.html — Claims & Change Orders tab (`view-claims-register`)
- Single combined tab replaces the former separate Claims and Change Orders tabs
- `data-view="claims-register"` — `switchView` also handles old `claims` / `change-orders` params for backwards compat
- KPI strip: Total Claims (EOT), Total Change Orders, Total Claimed, Approved Amount, Pending Review
- KPIs re-calculate when the Type filter changes
- Filters: Type (All | Claims EOT | Change Orders), Party, Status, search
- Action buttons: Add Claim + Add Change Order in the toolbar
- Table columns: No., Type, Party, Description, Linked WP, Contractor, Date Filed, Claimed (₱M), Status, Approved (₱M), Actions
- Edit links auto-include `&section=change-order` for Change Order rows
- Admin actions per row: Edit, Approve (✓), Reject (✗), Delete
- `renderClaimsRegisterKPIs()` / `renderClaimsRegister()` — driven by full `allClaims` array with client-side type filter
- `approveClaim(id)` / `rejectClaim(id, reason)` / `deleteClaim(id)` — shared for both types
- Single combined pending badge: `#claims-pending-badge` (sidebar) + `#claims-tab-badge` (tab)

### loadClaims()
Fetches all `claims` for the project from Supabase, populates `allClaims[]`, updates all badges, and calls `renderClaimsKPIs()` + `renderClaimsView()`. Called once on page load and after any approve/reject/delete action.

---

## CSS / Styling

### Design System (dashboard.css)
- Brand: `--mw-red: #EE3124`, `--mw-black: #231F20`, `--mw-dark: #282C28`
- Font: Montserrat (Google Fonts CDN)
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
- `.page-title`: `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`
- `.page-sub`: `display: none` on mobile
- `.hide-mobile`: hides export button text (or entire button on consolidated view)

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

## Known Issues / Gotchas

1. **Date validation:** `new Date(dateString)` can silently accept invalid dates. Always validate on input — `wp-form.html` validates Target Completion ≥ Planned Award Date.
2. **Role caching:** `window.__wpmRole` is set once at login. If role changes mid-session, user must log out and back in.
3. **WP count refresh:** After adding/editing WPs, call `loadData()` to refresh counts in the sidebar badge.
4. **Chart.js memory leaks:** Destroy existing chart instances before re-rendering: `if (chartInstance) { chartInstance.destroy(); chartInstance = null; }`
5. **Duplicate `saveProject` in db.js:** Lines 24 and 36 both define `saveProject`. The second one shadows the first — harmless but should be cleaned up.
6. **`assets/js/` sync:** Some pages load scripts from `assets/js/db.js` while others use root `db.js`. Always update `assets/js/` files; sync root copies if both paths are referenced.
7. **READ-ONLY badge inline style:** Never add `display:inline-flex` as an inline style to `.topbar-badge-readonly` — the mobile media query sets `display:none` and inline styles override it.
8. **Sticky tabs + overflow:** `overflow: hidden/clip` on any ancestor of `.view-tabs` breaks `position: sticky` in Safari. Always clamp overflow at the element level, not the container level.
9. **Supabase free tier pause:** Project pauses after 7 days inactivity → 5–30s cold start on first load. Use UptimeRobot to ping every 3–4 days to prevent this.

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
- Supabase client loaded via CDN ESM: `import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm')`
- All pages use `AppAuth.requireLogin()` or `AppAuth.requireAdmin()` as the entry point — never access DB directly without auth check
- `WPDb.mapWP()` normalizes field aliases (e.g., `budget_bcb` ↔ `approved_budget_bcb`, `contract_amount_php` ↔ `total_awarded`)
- `Fmt.money(v)` formats as `₱X.XXM`; `Fmt.moneyFull(v)` formats as `₱1,234,567`; `Fmt.date(d)` formats as `May 29, '26`
- Charts use Chart.js loaded via CDN; chart functions are in `assets/js/charts.js`
- Power BI chart functions: `budgetAwardedByPeriod`, `wpByTrade`, `wpStatusDonut`, `wpSubmittalDonut`, `wpByPeriodQuarterly`, `wpAgingBuckets`, `budgetByTradeHBar`, `budgetByPeriodPerTrade`, `budgetByTradeDonut`, `awardedByTradeDonut`
