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
| `auth.js` | Supabase auth wrapper — `AppAuth.requireLogin()`, `AppAuth.requireAdmin()`, `getSB()` |
| `db.js` | All DB operations via `WPDb.*` — also `computeStats()`, `Fmt.*` |
| `ui.js` | Shared UI helpers — sidebar init, modals, toast, hamburger menu |
| `dashboard.css` | Global styles, CSS variables, responsive breakpoints |
| `supabase-schema.sql` | Full DB schema for reference |

> `assets/js/db.js`, `assets/js/auth.js`, `assets/js/ui.js` are copies — edit root-level files and sync to `assets/js/` if both paths are referenced.

### Pages
| File | Auth | Purpose |
|---|---|---|
| `login.html` | public | Sign-in |
| `register.html` | public | Self-registration (creates `pending` user) |
| `pending.html` | public | Shown to unapproved users |
| `forgot-password.html` | public | Password reset |
| `index.html` | user | All-projects overview + consolidated dashboard |
| `project.html` | user | Single project dashboard (tabs: Overview, WP Table, Analysis, Schedule, Budget) |
| `wp-form.html` | user | Add / edit work package |
| `my-wps.html` | user | Officer's WP list |
| `review.html` | admin | Approve / reject pending WPs |
| `admin.html` | admin | User management + project management |

---

## Database (Supabase)

**URL:** `https://cayjeqeleenizbdzrums.supabase.co`

### Tables
- **`projects`** — `id` (text PK e.g. 'AVR101'), name, location, status, budget_bcb, start_date, end_date
- **`users`** — `id` (UUID FK → auth.users), email, role (`super_admin|admin|user`), status (`pending|approved|rejected`), projects (text[])
- **`work_packages`** — all WP fields; `review_status` (`pending_review|approved|rejected`); see schema for full column list

### WPDb API (db.js)
```js
WPDb.getProjects()          // all projects
WPDb.getProject(id)         // single project
WPDb.createProject(data)    // new project
WPDb.updateProject(id, data)
WPDb.archiveProject(id)     // sets status='archived'
WPDb.unarchiveProject(id)
WPDb.deleteProject(id)      // also deletes all WPs

WPDb.getApprovedWPs(pid)    // approved WPs for project
WPDb.getAllWPs(pid)          // all WPs regardless of status
WPDb.getPendingWPs()        // pending_review WPs (admin)
WPDb.submitWP(data, user)   // inserts with review_status='pending_review'
WPDb.updateWP(id, data)     // update (resets to pending_review)
WPDb.updateWPDirect(id, data) // update without status change
WPDb.approveWP(id)
WPDb.rejectWP(id, _, reason)
WPDb.getAllUsers()
WPDb.updateUser(id, updates)
```

### Auth Flow
1. `getSB()` — lazy-loads Supabase client (CDN ESM import)
2. `AppAuth.requireLogin(cb)` — checks session → checks `users.status === 'approved'` → calls cb(user, profile)
3. `AppAuth.requireAdmin(cb)` — requires role in `['admin', 'super_admin']`
4. Role stored in `window.__wpmRole`, profile in `window.__profile`, session in `window.__session`

---

## Role-Based Access Control

| Role | Can Do |
|---|---|
| `user` | View/add WPs on assigned projects; WPs go to `pending_review` |
| `admin` | Approve/reject WPs; manage users; create/archive projects on assigned projects |
| `super_admin` | Full access to all projects + all admin features |

- Admins see all projects; users see only projects in their `profile.projects[]` array
- When admin submits a WP via CSV import or form, it auto-approves (`WPDb.approveWP()` called after `WPDb.submitWP()`)
- Project assignment is per-user, stored as `text[]` in `users.projects`

---

## Sidebar Navigation Hierarchy (Final)

All pages follow this sidebar structure. Not all sections appear on every page — they're shown/hidden based on role and context.

```
Overview
  └─ All Projects (index.html)

Current Project
  └─ [project name] (active)

Work Packages  (visible when in project context)
  ├─ Add Work Package (wp-form.html)
  ├─ All WPs (my-wps.html)
  ├─ CSV Template (download button)
  └─ Import from CSV (modal button)

Projects  (admin only — admin.html)
  ├─ [project list]
  └─ New Project (button)

Admin  (admin only)
  └─ User Management (admin.html)
  └─ Review WPs (review.html) — with pending count badge

[Switch Project link — bottom of sidebar on project.html]
```

**Important:** "Add Work Package" must NOT appear in admin.html outside of project context. It belongs only in the Work Packages section of `project.html`.

---

## CSV Import Feature (project.html)

### Template Download
`downloadCSVTemplate()` — generates a CSV blob with headers + 2 example rows and triggers download.

**Headers:** Cost Code, WP No., Description, Zone, Trade, Planned Award Date, Target Completion, Budget BCB, Award Status, Contractor, Remarks

### Import Modal
`openCSVImportModal()` / `closeCSVImportModal()` — opens a fixed overlay modal (`#csv-import-modal`) with drag-drop file upload.

`handleCSVFile(file)` — reads via FileReader, validates CSV, shows row count preview.

`importWPsFromCSV()` — parses rows, calls `WPDb.submitWP()` per row, then `WPDb.approveWP()` if user is admin/super_admin.

**Date parsing:** Uses `new Date(value).toISOString().split('T')[0]` — accepts MM/DD/YYYY or YYYY-MM-DD.

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

### Mobile Hamburger Menu
- Button `.btn-menu` shown at `≤767px` (hidden on desktop via `display:none`)
- Sidebar gets class `.open` when toggled; `.sidebar-overlay` covers background
- Handled in `ui.js`

### Logo Styling (Global)
Logo is styled globally in `dashboard.css`:
```css
.sidebar-logo img { width: 140px; height: auto; display: block; }
```
**Do NOT add inline `.sidebar-logo img` CSS to individual HTML files.** All pages use the global rule.

---

## Known Issues / Gotchas

1. **Date validation:** `new Date(dateString)` can silently accept invalid dates. Always validate on input — the `wp-form.html` validates that Target Completion ≥ Planned Award Date.
2. **Role caching:** `window.__wpmRole` is set once at login. If role changes mid-session, user must log out and back in.
3. **WP count refresh:** After adding/editing WPs, call `loadData()` to refresh counts in the sidebar badge.
4. **Chart.js memory leaks:** Destroy existing chart instances before re-rendering: `if (chartInstance) { chartInstance.destroy(); chartInstance = null; }`
5. **Duplicate `saveProject` in db.js:** Lines 24 and 36 both define `saveProject`. The second one (line 36) shadows the first — this is harmless but should be cleaned up eventually.
6. **`assets/js/` sync:** Some pages load scripts from `assets/js/db.js` while others use root `db.js`. If making changes, update root files and sync to `assets/js/`.

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
