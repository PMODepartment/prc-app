/* ============================================================================
 * Onboarding / Guided Tour  —  Megawide EPC Procurement WPM Dashboard
 * ----------------------------------------------------------------------------
 * A role-aware welcome carousel shown on first login and re-openable any time
 * via the "?" Guide button in the topbar (so users stay guided after training).
 *
 * Self-contained: injects its own styles, builds its own DOM, no dependencies
 * beyond Tabler icons (already loaded) + the CSS variables in dashboard.css
 * (so it follows light / dark mode automatically).
 *
 * Roles are grouped into three capability TIERS:
 *   • admin        → super_admin, admin
 *   • contributor  → specialist, manager, user
 *   • viewer       → viewer
 *
 * Public API (window.Onboarding):
 *   Onboarding.open()                     — open the tour (personalised to role)
 *   Onboarding.maybeAutoOpen(userId,role) — open once per user on first login
 * ========================================================================== */
(function () {
  'use strict';

  var SEEN_PREFIX = 'wpm_onboarded_';        // localStorage flag, per user id
  var _slides = [], _idx = 0, _role = null;

  /* ---- role → capability tier -------------------------------------------- */
  function tierOf(role) {
    if (role === 'super_admin' || role === 'admin') return 'admin';
    if (role === 'viewer') return 'viewer';
    return 'contributor';                    // specialist / manager / user
  }
  var TIER_META = {
    admin:       { icon: 'ti-shield-check', label: 'Administrator', color: '#7C3AED' },
    contributor: { icon: 'ti-edit',         label: 'Contributor',   color: '#2563EB' },
    viewer:      { icon: 'ti-eye',          label: 'Viewer',        color: '#0891B2' }
  };

  /* ---- styles (injected once) -------------------------------------------- */
  function injectCss() {
    if (document.getElementById('ob-css')) return;
    var s = document.createElement('style');
    s.id = 'ob-css';
    s.textContent = [
      '.ob-overlay{position:fixed;inset:0;z-index:9000;background:rgba(20,18,18,.55);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;padding:20px;opacity:0;transition:opacity .18s}',
      '.ob-overlay.show{opacity:1}',
      '.ob-modal{background:var(--surface,#fff);color:var(--text-primary,#231F20);width:100%;max-width:640px;max-height:92vh;border-radius:16px;box-shadow:0 24px 60px rgba(0,0,0,.35);display:flex;flex-direction:column;overflow:hidden;transform:translateY(12px);transition:transform .18s;font-family:Montserrat,system-ui,sans-serif}',
      '.ob-overlay.show .ob-modal{transform:none}',
      '.ob-head{background:linear-gradient(135deg,#EE3124,#C42127);color:#fff;padding:18px 22px;display:flex;align-items:center;gap:12px;flex-shrink:0}',
      '.ob-head .ob-h-ico{font-size:26px;line-height:1}',
      '.ob-head h2{margin:0;font-size:17px;font-weight:800;letter-spacing:.2px}',
      '.ob-head .ob-h-sub{margin:2px 0 0;font-size:11.5px;opacity:.92;font-weight:500}',
      '.ob-badge{margin-left:auto;background:rgba(255,255,255,.22);border:1px solid rgba(255,255,255,.35);padding:5px 11px;border-radius:20px;font-size:11px;font-weight:700;display:inline-flex;align-items:center;gap:5px;white-space:nowrap}',
      '.ob-x{position:absolute;top:12px;right:14px;background:rgba(255,255,255,.18);border:none;color:#fff;width:30px;height:30px;border-radius:50%;font-size:15px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .12s}',
      '.ob-x:hover{background:rgba(255,255,255,.34)}',
      '.ob-body{padding:24px 26px 8px;overflow-y:auto;flex:1;min-height:0}',
      '.ob-s-ico{width:52px;height:52px;border-radius:13px;background:var(--mw-red-light,#FDECEA);color:var(--mw-red,#EE3124);display:flex;align-items:center;justify-content:center;font-size:27px;margin-bottom:14px}',
      '.ob-s-title{font-size:19px;font-weight:800;margin:0 0 8px;line-height:1.25}',
      '.ob-s-lead{font-size:13.5px;line-height:1.6;color:var(--text-secondary,#5A5858);margin:0 0 14px}',
      '.ob-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:9px}',
      '.ob-list li{display:flex;gap:10px;align-items:flex-start;font-size:13px;line-height:1.5}',
      '.ob-list li i{color:var(--mw-red,#EE3124);font-size:16px;flex-shrink:0;margin-top:1px}',
      '.ob-list li b{font-weight:700}',
      '.ob-cardrow{display:grid;grid-template-columns:1fr;gap:11px;margin-top:4px}',
      '.ob-card{border:1px solid var(--border-md,rgba(0,0,0,.14));border-radius:11px;padding:13px 15px;background:var(--surface-2,#f9f9f9)}',
      '.ob-card .ob-c-h{display:flex;align-items:center;gap:8px;font-weight:800;font-size:13.5px;margin-bottom:5px}',
      '.ob-card .ob-c-h i{font-size:18px}',
      '.ob-card p{margin:0;font-size:12px;line-height:1.5;color:var(--text-secondary,#5A5858)}',
      '.ob-card.ob-hl{border-color:var(--mw-red,#EE3124);box-shadow:0 0 0 2px var(--mw-red-light,#FDECEA)}',
      '.ob-tip{background:var(--mw-red-light,#FDECEA);border:1px solid var(--mw-red-mid,#F9C8C5);border-radius:10px;padding:11px 14px;font-size:12.5px;line-height:1.55;color:var(--mw-red-dark,#C42127);display:flex;gap:9px;align-items:flex-start;margin-top:14px}',
      '.ob-tip i{font-size:16px;flex-shrink:0;margin-top:1px}',
      '.ob-foot{display:flex;align-items:center;gap:12px;padding:14px 22px 18px;border-top:1px solid var(--border,rgba(0,0,0,.08));flex-shrink:0}',
      '.ob-dots{display:flex;gap:7px;flex:1}',
      '.ob-dot{width:8px;height:8px;border-radius:50%;background:var(--border-md,#ccc);cursor:pointer;transition:all .15s;border:none;padding:0}',
      '.ob-dot.on{background:var(--mw-red,#EE3124);width:22px;border-radius:5px}',
      '.ob-btn{border:none;border-radius:9px;padding:9px 18px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;transition:filter .12s,background .12s}',
      '.ob-btn:disabled{opacity:.4;cursor:default}',
      '.ob-btn-prev{background:var(--surface-2,#f0f0f0);color:var(--text-primary,#231F20)}',
      '.ob-btn-next{background:var(--mw-red,#EE3124);color:#fff}',
      '.ob-btn-next:hover:not(:disabled){filter:brightness(1.06)}',
      '.ob-chk{display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--text-hint,#9B9999);cursor:pointer;user-select:none;margin-right:4px}',
      '.ob-chk input{cursor:pointer}',
      '.btn-guide{width:34px;height:34px;border-radius:8px;border:1px solid var(--border-md,rgba(0,0,0,.14));background:var(--surface,#fff);color:var(--text-secondary,#5A5858);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;transition:color .12s,border-color .12s}',
      '.btn-guide:hover{color:var(--mw-red,#EE3124);border-color:var(--mw-red,#EE3124)}',
      '.btn-guide i{font-size:17px}',
      '@media(max-width:520px){.ob-head h2{font-size:15px}.ob-badge{display:none}.ob-s-title{font-size:17px}.ob-body{padding:18px 18px 6px}.ob-foot{padding:12px 16px 16px}.ob-btn{padding:8px 13px}}',
      'body.dark-mode .btn-guide{background:var(--surface,#2B2C2B)}'
    ].join('\n');
    document.head.appendChild(s);
  }

  /* ---- slide content (role-aware) ---------------------------------------- */
  function buildSlides(role) {
    var tier = tierOf(role);
    var s = [];

    // 1 — Welcome
    s.push({
      icon: 'ti-layout-dashboard',
      title: 'Welcome to the WPM Dashboard',
      lead: 'The Work Package Management dashboard tracks procurement work packages — their award status, budgets, schedule and contractors — across all Megawide EPC projects.',
      body:
        '<ul class="ob-list">' +
        '<li><i class="ti ti-point-filled"></i><span>Everything updates <b>live from a shared database</b> — what you see is the latest data.</span></li>' +
        '<li><i class="ti ti-point-filled"></i><span>What you can see and do depends on your <b>role</b> — yours is shown top-right.</span></li>' +
        '<li><i class="ti ti-point-filled"></i><span>This quick tour takes about a minute. Reopen it any time with the <b>?</b> button in the top bar.</span></li>' +
        '</ul>'
    });

    // 2 — Two views
    s.push({
      icon: 'ti-binoculars',
      title: 'Two ways to look at the data',
      lead: 'After signing in you pick where to go. You can switch any time from the sidebar.',
      body:
        '<div class="ob-cardrow">' +
        '<div class="ob-card"><div class="ob-c-h"><i class="ti ti-building-community" style="color:#EE3124"></i>Portfolio Overview</div><p>All projects consolidated into one dashboard — 6 tabs (Overview, Backlog, Budget, Schedule, Works, WP List). Toggle projects on/off with the project filter.</p></div>' +
        '<div class="ob-card"><div class="ob-c-h"><i class="ti ti-folder" style="color:#2563EB"></i>Project Dashboard</div><p>A single project in detail — 3 tabs (Overview, Backlog, WP List), including the Procurement S-Curve and per-project status tracker.</p></div>' +
        '</div>' +
        '<div class="ob-tip"><i class="ti ti-menu-2"></i><span>The <b>hamburger (☰)</b> opens or collapses the sidebar. The top bar also has <b>Refresh</b>, <b>Export PDF</b> and a <b>dark-mode</b> toggle.</span></div>'
    });

    // 3 — Reading the dashboard (viewer gets a cost-free version)
    if (tier === 'viewer') {
      s.push({
        icon: 'ti-chart-donut',
        title: 'Reading the dashboard',
        lead: 'Charts and tables summarise progress at a glance. As a Viewer you see counts, status and schedule (budget and award amounts are hidden).',
        body:
          '<ul class="ob-list">' +
          '<li><i class="ti ti-chart-line"></i><span><b>Procurement S-Curve</b> — cumulative planned vs actual awarding over time.</span></li>' +
          '<li><i class="ti ti-chart-donut"></i><span><b>Status donuts</b> — Awarded vs Due-but-not-awarded vs Not-yet-due work packages.</span></li>' +
          '<li><i class="ti ti-calendar-stats"></i><span><b>By-period charts</b> — planned vs actual work-package counts by month or quarter.</span></li>' +
          '<li><i class="ti ti-clock-exclamation"></i><span><b>Backlog</b> — work packages not yet awarded, with aging.</span></li>' +
          '</ul>'
      });
    } else {
      s.push({
        icon: 'ti-chart-donut',
        title: 'Reading the dashboard',
        lead: 'Charts and KPI cards summarise cost and progress at a glance.',
        body:
          '<ul class="ob-list">' +
          '<li><i class="ti ti-cash"></i><span><b>Cost Overview KPIs</b> — Budget (BCB), Actual Award, Balance to Award, and Savings / Loss.</span></li>' +
          '<li><i class="ti ti-chart-line"></i><span><b>Procurement S-Curve</b> — cumulative planned vs actual awarding; the dashed line forecasts the rest.</span></li>' +
          '<li><i class="ti ti-chart-bar"></i><span><b>Budget &amp; Awarded by Period</b> — spend planned vs realised by month / quarter.</span></li>' +
          '<li><i class="ti ti-trophy"></i><span><b>Top 5 panels</b> — highest value, biggest savings, and overbudget work packages.</span></li>' +
          '</ul>'
      });
    }

    // 4 — Work packages & filters
    s.push({
      icon: 'ti-list-search',
      title: 'Finding work packages',
      lead: 'The WP List is grouped by Project → Trade, sortable and paginated. Powerful filters help you zero in.',
      body:
        '<ul class="ob-list">' +
        '<li><i class="ti ti-filter"></i><span><b>Cascading filters</b> — Trade → Works → Vendor narrow each other; plus Status, OSM and free-text search.</span></li>' +
        '<li><i class="ti ti-click"></i><span><b>Click a WP No.</b> to open the slide-in detail panel with every field' + (tier === 'viewer' ? '.' : ' (and Edit / Delete).') + '</span></li>' +
        '<li><i class="ti ti-calendar-search"></i><span><b>Filtered Analysis</b> — a period chart + KPIs you can scope to a month range.</span></li>' +
        '</ul>' +
        (tier === 'viewer'
          ? '<div class="ob-tip"><i class="ti ti-eye"></i><span>Cost, budget and award-amount columns are hidden for your role — you\'ll see status and schedule instead.</span></div>'
          : '')
    });

    // 5 — Your role tier (personalised)
    s.push(roleSlide(tier, role));

    // 6 — The whole team (capability matrix so everyone understands the system)
    s.push({
      icon: 'ti-users-group',
      title: 'Who can do what',
      lead: 'Roles are grouped into three capability tiers. Yours is highlighted.',
      body:
        '<div class="ob-cardrow">' +
        tierCard('admin', tier) +
        tierCard('contributor', tier) +
        tierCard('viewer', tier) +
        '</div>'
    });

    // 7 — Tips & help
    s.push({
      icon: 'ti-bulb',
      title: 'Handy to know',
      lead: 'A few things that make day-to-day use smoother.',
      body:
        '<ul class="ob-list">' +
        '<li><i class="ti ti-refresh"></i><span><b>Refresh</b> (top bar) pulls the latest data without a full reload.</span></li>' +
        '<li><i class="ti ti-moon"></i><span><b>Dark mode</b> — toggle in the top bar; your choice is remembered.</span></li>' +
        (tier === 'viewer' ? '' : '<li><i class="ti ti-file-type-pdf"></i><span><b>Export PDF</b> — a print-ready table of the current view.</span></li>') +
        '<li><i class="ti ti-device-mobile"></i><span>Works on phones — <b>Add to Home Screen</b> to install it like an app.</span></li>' +
        '<li><i class="ti ti-help-circle"></i><span>Reopen this guide any time from the <b>?</b> button in the top bar.</span></li>' +
        '</ul>' +
        '<div class="ob-tip"><i class="ti ti-mail"></i><span>Questions or access issues? Contact the <b>PMO / Procurement</b> team to have your role or project assignments updated.</span></div>'
    });

    return s;
  }

  function roleSlide(tier, role) {
    var meta = TIER_META[tier];
    if (tier === 'admin') {
      return {
        icon: meta.icon,
        title: 'Your access — Administrator',
        lead: 'Administrators have the widest access: the whole portfolio plus user and project administration.',
        body:
          '<ul class="ob-list">' +
          '<li><i class="ti ti-eye-check"></i><span>See <b>every project</b> and all cost / budget data.</span></li>' +
          '<li><i class="ti ti-pencil"></i><span><b>Add, edit and delete</b> any work package; changes save immediately.</span></li>' +
          '<li><i class="ti ti-users"></i><span><b>User Management</b> — approve registrations, set roles, assign projects.</span></li>' +
          '<li><i class="ti ti-folder-plus"></i><span><b>Project Management</b> — create, edit and archive projects.</span></li>' +
          '<li><i class="ti ti-file-import"></i><span><b>Bulk CSV import</b> — de-duplicates by WP No. (existing WPs update in place).</span></li>' +
          '</ul>' +
          (role === 'admin'
            ? '<div class="ob-tip"><i class="ti ti-info-circle"></i><span>Only a <b>Super Admin</b> can grant the Super Admin or Specialist roles.</span></div>'
            : '<div class="ob-tip"><i class="ti ti-crown"></i><span>As <b>Super Admin</b> you can also grant the Super Admin and Specialist roles.</span></div>')
      };
    }
    if (tier === 'viewer') {
      return {
        icon: meta.icon,
        title: 'Your access — Viewer',
        lead: 'Viewers have read-only access to their assigned projects, with financial figures hidden.',
        body:
          '<ul class="ob-list">' +
          '<li><i class="ti ti-eye"></i><span><b>Browse</b> dashboards, charts and work-package details for your projects.</span></li>' +
          '<li><i class="ti ti-lock"></i><span><b>No editing</b> — Add / Edit / Delete and the WP form are unavailable.</span></li>' +
          '<li><i class="ti ti-currency-off"></i><span><b>Cost hidden</b> — budget, awarded amounts and the Budget / Works tabs are not shown.</span></li>' +
          '<li><i class="ti ti-checkbox"></i><span>You still see <b>status, schedule, counts and progress</b> across the board.</span></li>' +
          '</ul>' +
          '<div class="ob-tip"><i class="ti ti-arrow-up-right"></i><span>Need to edit or see costs? Ask the PMO team to upgrade your role.</span></div>'
      };
    }
    // contributor
    return {
      icon: meta.icon,
      title: 'Your access — Contributor',
      lead: 'Contributors manage work packages on their projects, with full cost visibility. No user or project administration.',
      body:
        '<ul class="ob-list">' +
        '<li><i class="ti ti-pencil-plus"></i><span><b>Add, edit and delete</b> work packages on your projects — changes save immediately (auto-approved).</span></li>' +
        '<li><i class="ti ti-file-import"></i><span><b>Import from CSV</b> in bulk — re-importing updates existing WPs by WP No. (no duplicates).</span></li>' +
        '<li><i class="ti ti-adjustments-check"></i><span><b>Status Tracker</b> — update Award / Procurement / Delivery status inline, no form needed.</span></li>' +
        '<li><i class="ti ti-cash"></i><span>Full <b>cost &amp; budget</b> visibility on the dashboards.</span></li>' +
        '</ul>' +
        '<div class="ob-tip"><i class="ti ti-map-pin"></i><span><b>Specialists</b> can view every project (edit their assigned ones); <b>Managers &amp; Users</b> work within their assigned projects.</span></div>'
    };
  }

  function tierCard(tier, active) {
    var m = TIER_META[tier];
    var roles = { admin: 'Super Admin · Admin', contributor: 'Specialist · Manager · User', viewer: 'Viewer' }[tier];
    var desc = {
      admin: 'Full access + user &amp; project management. All cost data.',
      contributor: 'Add / edit / delete work packages + CSV import + status tracker. Cost data visible.',
      viewer: 'Read-only. Cost, budget &amp; award amounts hidden.'
    }[tier];
    var on = tier === active ? ' ob-hl' : '';
    return '<div class="ob-card' + on + '"><div class="ob-c-h"><i class="ti ' + m.icon + '" style="color:' + m.color + '"></i>' +
      m.label + (tier === active ? ' <span style="font-size:10px;font-weight:700;color:var(--mw-red);border:1px solid var(--mw-red);border-radius:10px;padding:1px 7px;margin-left:2px">YOU</span>' : '') +
      '</div><p style="margin-bottom:4px"><b>' + roles + '</b></p><p>' + desc + '</p></div>';
  }

  /* ---- render / navigation ----------------------------------------------- */
  function render() {
    var sl = _slides[_idx];
    var last = _idx === _slides.length - 1;
    document.getElementById('ob-ico').className = 'ob-s-ico';
    document.getElementById('ob-ico').innerHTML = '<i class="ti ' + sl.icon + '"></i>';
    document.getElementById('ob-title').innerHTML = sl.title;
    document.getElementById('ob-lead').innerHTML = sl.lead;
    document.getElementById('ob-content').innerHTML = sl.body;
    document.getElementById('ob-body').scrollTop = 0;
    // dots
    document.getElementById('ob-dots').innerHTML = _slides.map(function (_, i) {
      return '<button class="ob-dot' + (i === _idx ? ' on' : '') + '" data-i="' + i + '" aria-label="Slide ' + (i + 1) + '"></button>';
    }).join('');
    // buttons
    var prev = document.getElementById('ob-prev');
    prev.disabled = _idx === 0;
    var next = document.getElementById('ob-next');
    next.innerHTML = last ? 'Get started <i class="ti ti-check" style="vertical-align:middle"></i>'
                          : 'Next <i class="ti ti-arrow-right" style="vertical-align:middle"></i>';
  }

  function go(i) {
    if (i < 0 || i >= _slides.length) return;
    _idx = i; render();
  }

  /* ---- open / close ------------------------------------------------------ */
  function markSeen() {
    try {
      var uid = (window.__profile && window.__profile.id) || window.__obUserId;
      if (uid) localStorage.setItem(SEEN_PREFIX + uid, '1');
    } catch (_) {}
  }

  function close() {
    var ov = document.getElementById('ob-overlay');
    if (!ov) return;
    ov.classList.remove('show');
    document.removeEventListener('keydown', onKey);
    setTimeout(function () { if (ov.parentNode) ov.parentNode.removeChild(ov); }, 200);
  }

  function onKey(e) {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') go(_idx + 1);
    else if (e.key === 'ArrowLeft') go(_idx - 1);
  }

  function open() {
    injectCss();
    _role = window.__wpmRole || 'user';
    _slides = buildSlides(_role);
    _idx = 0;
    if (document.getElementById('ob-overlay')) close();

    var tier = tierOf(_role), meta = TIER_META[tier];
    var ov = document.createElement('div');
    ov.className = 'ob-overlay';
    ov.id = 'ob-overlay';
    ov.innerHTML =
      '<div class="ob-modal" role="dialog" aria-modal="true" aria-label="Dashboard guide">' +
        '<div class="ob-head" style="position:relative">' +
          '<span class="ob-h-ico"><i class="ti ti-book-2"></i></span>' +
          '<div><h2>Dashboard Guide</h2><div class="ob-h-sub">Getting started with the WPM Dashboard</div></div>' +
          '<span class="ob-badge"><i class="ti ' + meta.icon + '"></i>' + meta.label + '</span>' +
          '<button class="ob-x" id="ob-x" aria-label="Close">&times;</button>' +
        '</div>' +
        '<div class="ob-body" id="ob-body">' +
          '<div class="ob-s-ico" id="ob-ico"></div>' +
          '<h3 class="ob-s-title" id="ob-title"></h3>' +
          '<p class="ob-s-lead" id="ob-lead"></p>' +
          '<div id="ob-content"></div>' +
        '</div>' +
        '<div class="ob-foot">' +
          '<div class="ob-dots" id="ob-dots"></div>' +
          '<label class="ob-chk" title="Don\'t show this automatically next time"><input type="checkbox" id="ob-dontshow" checked>Don\'t show on login</label>' +
          '<button class="ob-btn ob-btn-prev" id="ob-prev">Back</button>' +
          '<button class="ob-btn ob-btn-next" id="ob-next"></button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    requestAnimationFrame(function () { ov.classList.add('show'); });

    // wire events
    document.getElementById('ob-x').onclick = close;
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.getElementById('ob-prev').onclick = function () { go(_idx - 1); };
    document.getElementById('ob-next').onclick = function () {
      if (_idx === _slides.length - 1) { if (document.getElementById('ob-dontshow').checked) markSeen(); close(); }
      else go(_idx + 1);
    };
    document.getElementById('ob-dontshow').onchange = function () { if (this.checked) markSeen(); };
    document.getElementById('ob-dots').addEventListener('click', function (e) {
      var b = e.target.closest('.ob-dot'); if (b) go(+b.dataset.i);
    });
    document.addEventListener('keydown', onKey);
    render();
  }

  function maybeAutoOpen(userId, role) {
    window.__obUserId = userId;
    if (role) window.__wpmRole = window.__wpmRole || role;
    var seen = false;
    try { seen = !!localStorage.getItem(SEEN_PREFIX + userId); } catch (_) {}
    if (!seen) setTimeout(open, 650);   // let the page settle first
  }

  /* ---- topbar Guide button (injected, idempotent) ------------------------ */
  function injectButton() {
    var tr = document.querySelector('.topbar-right');
    if (!tr || document.getElementById('btn-guide')) return;
    var b = document.createElement('button');
    b.className = 'btn-guide';
    b.id = 'btn-guide';
    b.title = 'Dashboard guide';
    b.setAttribute('aria-label', 'Open dashboard guide');
    b.innerHTML = '<i class="ti ti-help"></i>';
    b.onclick = open;
    var ub = document.getElementById('user-bar');
    if (ub) tr.insertBefore(b, ub); else tr.appendChild(b);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectButton);
  else injectButton();

  window.Onboarding = { open: open, maybeAutoOpen: maybeAutoOpen };
})();
