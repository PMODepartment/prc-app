/* ui.js — shared UI helpers */

/* ── Theme: apply saved preference immediately on script load (minimises flash) ── */
(function() {
  try {
    if (localStorage.getItem('wpm_theme_last') === 'dark') {
      document.body.classList.add('dark-mode');
      document.documentElement.classList.add('dark-mode');
    }
  } catch(e) {}
})();

/* ── Prevent pinch-zoom on iOS (Safari ignores viewport user-scalable since iOS 10) ── */
(function() {
  document.addEventListener('touchmove', function(e) {
    if (e.touches.length > 1) e.preventDefault();
  }, { passive: false });
  document.addEventListener('gesturestart', function(e) {
    e.preventDefault();
  });
})();

/* ── Sidebar toggle (desktop collapse + mobile drawer) + topbar logo ──── */
function initMobileMenu() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const btnMenu = document.getElementById('btn-menu');

  // Inject the Megawide mark into the topbar, just after the menu button (idempotent).
  const topbarLeft = document.querySelector('.topbar-left');
  if (topbarLeft && !topbarLeft.querySelector('.topbar-logo')) {
    const img = document.createElement('img');
    img.className = 'topbar-logo';
    img.src = 'assets/img/megawide-mark.png';
    img.alt = 'Megawide';
    if (btnMenu && btnMenu.parentElement === topbarLeft) btnMenu.insertAdjacentElement('afterend', img);
    else topbarLeft.insertBefore(img, topbarLeft.firstChild);
  }

  if (!sidebar || !btnMenu) return;

  const COLLAPSE_KEY = 'wpm_sidebar_collapsed';
  const isDesktop = () => window.innerWidth >= 768;

  // Default to COLLAPSED on desktop — the sidebar starts tucked away and the hamburger
  // expands it (was the reverse: open by default, hamburger to collapse). Only stays
  // expanded if the user has explicitly expanded it before (stored '0').
  if (isDesktop() && localStorage.getItem(COLLAPSE_KEY) !== '0') {
    document.body.classList.add('no-transition', 'sidebar-collapsed');
    requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.remove('no-transition')));
  }

  btnMenu.addEventListener('click', () => {
    if (isDesktop()) {
      // Desktop/tablet: collapse the panel out of the way and reclaim the space (persisted)
      const collapsed = document.body.classList.toggle('sidebar-collapsed');
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } else {
      // Mobile: slide-in drawer with overlay
      sidebar.classList.add('open');
      if (overlay) overlay.classList.add('show');
      document.body.style.overflow = 'hidden';
    }
  });

  function closeMenu() {
    sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('show');
    document.body.style.overflow = '';
  }

  if (overlay) overlay.addEventListener('click', closeMenu);

  sidebar.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', () => {
      if (window.innerWidth < 768) closeMenu();
    });
  });
}

/* ── Pending badge on Review WPs nav item ─────────────────────────── */
async function updatePendingBadge() {
  try {
    const wps = await WPDb.getPendingWPs();
    const badge = document.getElementById('review-badge');
    if (badge) {
      badge.textContent = wps.length;
      badge.style.display = wps.length > 0 ? 'inline-block' : 'none';
    }
  } catch(e) { /* silent */ }
}

/* ── Sidebar Preferences (pin + order) ───────────────────────────── */
const SidebarPrefs = (() => {
  const KEY = 'wpm_sidebar_';

  function load(userId) {
    try { return JSON.parse(localStorage.getItem(KEY + userId) || '{}'); }
    catch(e) { return {}; }
  }
  function save(userId, prefs) {
    try { localStorage.setItem(KEY + userId, JSON.stringify(prefs)); } catch(e){}
  }

  return {
    getPinned(userId)    { return load(userId).pinned || []; },
    getOrder(userId)     { return load(userId).order  || []; },
    isPinned(userId, id) { return this.getPinned(userId).includes(id); },

    togglePin(userId, id) {
      const prefs = load(userId);
      const pinned = prefs.pinned || [];
      const i = pinned.indexOf(id);
      if (i >= 0) pinned.splice(i, 1); else pinned.push(id);
      prefs.pinned = pinned;
      save(userId, prefs);
      return pinned.includes(id);
    },

    setOrder(userId, ids) {
      const prefs = load(userId);
      prefs.order = ids;
      save(userId, prefs);
    },

    /* Sort projects: pinned first (in saved order), then rest alphabetically */
    sortProjects(userId, projects) {
      const pinned  = this.getPinned(userId);
      const order   = this.getOrder(userId);
      const pinnedSet = new Set(pinned);

      const pinnedList = [...projects]
        .filter(p => pinnedSet.has(p.id))
        .sort((a,b) => {
          const ai = order.indexOf(a.id), bi = order.indexOf(b.id);
          if (ai >= 0 && bi >= 0) return ai - bi;
          if (ai >= 0) return -1;
          if (bi >= 0) return  1;
          return a.id.localeCompare(b.id);
        });

      const rest = [...projects]
        .filter(p => !pinnedSet.has(p.id))
        .sort((a,b) => a.id.localeCompare(b.id));

      return { pinned: pinnedList, rest };
    },

    /* Build the HTML for a project nav link with a pin toggle icon.
       href: full URL override; if omitted, defaults to project.html?id={p.id} */
    projectLink(userId, p, extra = '', href = null) {
      const pinned = this.isPinned(userId, p.id);
      const label  = (p.name && p.name !== p.id) ? p.name.split('—')[0].trim().slice(0, 14) : '';
      const linkHref = href || `project.html?id=${p.id}${extra}`;
      return `
        <div class="sidebar-proj-row" style="display:flex;align-items:center;gap:2px">
          <a class="nav-item" style="flex:1;min-width:0" href="${linkHref}">
            <i class="ti ti-building-skyscraper"></i>${p.id}
            ${label ? `<span style="font-size:0.7143rem;color:rgba(255,255,255,0.4);margin-left:auto;font-weight:400;flex-shrink:0">${label}</span>` : ''}
          </a>
          <button onclick="event.stopPropagation();SidebarPrefs.togglePinAndRefresh('${userId}','${p.id}')"
            title="${pinned?'Unpin':'Pin to sidebar'}"
            style="flex-shrink:0;background:none;border:none;cursor:pointer;padding:4px 6px;color:${pinned?'#EE3124':'rgba(255,255,255,0.25)'};font-size:0.9286rem;line-height:1;border-radius:4px"
            onmouseover="this.style.color='${pinned?'#C42127':'rgba(255,255,255,0.6)'}'"
            onmouseout="this.style.color='${pinned?'#EE3124':'rgba(255,255,255,0.25)'}'">
            <i class="ti ti-${pinned?'star-filled':'star'}"></i>
          </button>
        </div>`;
    },

    /* Call after toggling pin — pages register their own refresh fn */
    togglePinAndRefresh(userId, id) {
      this.togglePin(userId, id);
      if (typeof window.__sidebarRefresh === 'function') window.__sidebarRefresh();
    }
  };
})();

/* ── Expandable chart panels ─────────────────────────────────────────
   Adds a click-to-expand toggle to every .panel that contains a canvas.
   Collapsed (default): chart at original height, data labels hidden.
   Expanded: chart doubles in height, data labels appear.
   Call once after the page DOM is ready. ─────────────────────────── */
function initExpandableCharts() {
  document.querySelectorAll('.panel').forEach(panel => {
    // Find the inline-height wrapper and its canvas
    const wrap = Array.from(panel.children).find(
      el => el.style && el.style.height && el.querySelector('canvas')
    );
    if (!wrap) return;
    const canvas = wrap.querySelector('canvas');
    if (!canvas || !canvas.id) return;
    const titleEl = panel.querySelector('.panel-title');
    if (!titleEl) return;

    // Avoid double-init
    if (panel.dataset.expandInit) return;
    panel.dataset.expandInit = '1';

    const origH = parseInt(wrap.style.height) || 240;
    let expanded = false;

    // Anchor the expand button to the PANEL's own top-right corner instead of appending it into
    // the title's flex row. Some panel titles (the Monthly/Quarterly/WP/Budget/# period-chart
    // toggles) already fill that row edge-to-edge on a phone: appending a flex sibling there either
    // clipped past the panel's edge (nowrap), or — once the row was allowed to wrap — landed alone
    // on an orphaned second line with nothing else around it, reading as randomly placed. A fixed
    // corner position is unambiguous regardless of how crowded the title row gets, on any panel,
    // on any screen size. `.panel` supplies `position:relative` itself (dashboard.css) — do NOT set
    // it here as an inline style: an inline `panel.style.position` would beat
    // `.panel.panel-fake-fullscreen{position:fixed}` regardless of that rule's specificity (inline
    // always wins over a stylesheet rule short of `!important`), silently trapping the "fullscreen"
    // panel in normal document flow — just enormously tall, with no scrollable way out except the
    // shrink button itself (a real regression this caused, caught from a user report).
    // Reserve a little right-padding so the title's OWN text (row 1, which shrinks) never runs
    // under the icon. That alone isn't enough for a `flex-shrink:0` toggle-button group though —
    // it ignores the reduced space and overflows straight into the reserved corner. `flexWrap` lets
    // that group drop to its own row 2 (getting the FULL row width there) instead of fighting the
    // icon for room on row 1 — the two then never occupy the same horizontal band.
    titleEl.style.paddingRight = (parseFloat(getComputedStyle(titleEl).paddingRight) || 0) + 28 + 'px';
    titleEl.style.flexWrap = 'wrap';
    titleEl.style.rowGap = titleEl.style.rowGap || '4px';
    const btn = document.createElement('span');
    btn.className = 'chart-expand-btn';
    btn.style.cssText = 'position:absolute;top:18px;right:18px;z-index:2;cursor:pointer;display:inline-flex;align-items:center;opacity:0.4;transition:opacity .15s,background .15s;padding:2px 4px;border-radius:4px;background:var(--surface)';
    btn.title = 'Fullscreen chart';
    btn.innerHTML = '<i class="ti ti-arrows-maximize" style="font-size:0.8571rem"></i>';
    btn.addEventListener('mouseenter', () => { btn.style.opacity = '1'; btn.style.background = 'rgba(238,49,36,.07)'; });
    btn.addEventListener('mouseleave', () => { btn.style.opacity = expanded ? '1' : '0.4'; btn.style.background = 'var(--surface)'; });
    panel.appendChild(btn);

    // Fullscreen (real Fullscreen API) instead of a taller in-page panel — so the whole
    // graph fills the screen, which the old 2.2× height couldn't on large displays / smart TVs.
    // MOBILE FALLBACK: iOS Safari has no Element.requestFullscreen at all (only <video> supports
    // it), and some Android/PWA-standalone browsers silently reject the request or never fire
    // `fullscreenchange` — on those the button looked like it did nothing. `.panel-fake-fullscreen`
    // (fixed-position CSS, below) is used whenever the native API is missing or doesn't actually
    // take effect shortly after being requested.
    const _fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
    const _fsSupported = !!(panel.requestFullscreen || panel.webkitRequestFullscreen);
    const isExpanded = () => _fsEl() === panel || panel.classList.contains('panel-fake-fullscreen');

    let fakeFallbackTimer = null;
    function setFake(on) {
      panel.classList.toggle('panel-fake-fullscreen', on);
      document.body.style.overflow = on ? 'hidden' : '';
      syncState();
    }
    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (isExpanded()) {
        if (_fsEl() === panel) (document.exitFullscreen || document.webkitExitFullscreen || function(){}).call(document);
        else setFake(false);
        return;
      }
      if (_fsSupported) {
        const req = (panel.requestFullscreen || panel.webkitRequestFullscreen).call(panel);
        if (req && req.catch) req.catch(() => setFake(true));
        // Safety net: some browsers resolve the promise (or have no promise at all) without ever
        // actually entering fullscreen / firing fullscreenchange. If nothing happened shortly
        // after asking, fall back to the CSS simulation instead of leaving the button inert.
        // Cancelled below the moment a real fullscreenchange for this panel does land, so a slow
        // (but eventually successful) native fullscreen can't get stuck double-applying the fake mode.
        fakeFallbackTimer = setTimeout(() => { if (!isExpanded()) setFake(true); }, 350);
      } else {
        setFake(true);
      }
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && panel.classList.contains('panel-fake-fullscreen')) setFake(false);
    });

    // React to entering/leaving fullscreen (also fires on Esc / TV back button) and to the fake mode
    const syncState = () => {
      // Real fullscreen landed (however slowly) — the pending fake-mode fallback must not fire later.
      if (_fsEl() === panel && fakeFallbackTimer) { clearTimeout(fakeFallbackTimer); fakeFallbackTimer = null; }
      expanded = isExpanded();
      panel.classList.toggle('panel-fullscreen', expanded);
      // Fill the screen when fullscreen; restore the default height otherwise. !important beats
      // the mobile `.chart-mob-h{height:300px!important}` rule.
      if (expanded) wrap.style.setProperty('height', 'calc(100vh - 96px)', 'important');
      else wrap.style.height = origH + 'px';
      btn.querySelector('i').className = expanded ? 'ti ti-arrows-minimize' : 'ti ti-arrows-maximize';
      btn.title = expanded ? 'Exit fullscreen' : 'Fullscreen chart';
      btn.style.opacity = expanded ? '1' : '0.4';
      // Resize the canvas to the new box, then toggle data labels, after layout settles.
      requestAnimationFrame(() => {
        if (typeof Charts !== 'undefined') {
          if (Charts.resize) Charts.resize(canvas.id);
          expanded ? Charts.expand(canvas.id) : Charts.collapse(canvas.id);
        }
      });
    };
    document.addEventListener('fullscreenchange', syncState);
    document.addEventListener('webkitfullscreenchange', syncState);
  });
}

/* ── Top 5 KPI card expander ──────────────────────────────────────────
   The three Top-5 cards sit side-by-side, so a card's table is cramped. Clicking a
   card's title EXPANDS that whole card to (almost) the full row width so the whole
   table reads at a glance; the other two shrink to slim ~128px cards (title only,
   table hidden). Click the expanded card again to return to 3-up. Collapsed titles
   stay HORIZONTAL (an earlier version rotated them vertically — a long title then
   forced a huge row height). Widths set inline (!important) so they beat the cards'
   own inline `flex:`. Desktop only; mobile already stacks the cards full-width. ── */
function initTop5Accordion() {
  const mq = window.matchMedia('(min-width: 768px)');
  document.querySelectorAll('.top5-row').forEach(row => {
    if (row.dataset.t5Init) return;
    row.dataset.t5Init = '1';
    const cards = Array.from(row.children).filter(c => c.classList.contains('panel'));
    if (cards.length < 2) return;
    cards.forEach(c => { c.dataset.t5Flex = c.style.flex || ''; c.dataset.t5MinW = c.style.minWidth || ''; });
    const reset = () => {
      row.classList.remove('t5-active');
      cards.forEach(c => {
        c.classList.remove('t5-expanded', 't5-collapsed');
        c.style.flex = c.dataset.t5Flex;
        c.style.minWidth = c.dataset.t5MinW;
        c.style.width = '';
        c.style.order = '';
        const ic = c.querySelector('.t5-caret');
        if (ic) ic.className = 'ti ti-arrows-diagonal t5-caret';
      });
    };
    cards.forEach(card => {
      const title = card.querySelector('.panel-title');
      if (!title) return;
      title.classList.add('t5-title');
      title.setAttribute('title', 'Click to expand this card and read the full table');
      if (!title.querySelector('.t5-caret')) {
        const ic = document.createElement('i');
        ic.className = 'ti ti-arrows-diagonal t5-caret';
        title.appendChild(ic);
      }
      // The card chrome (title/caret/empty space) toggles expand-collapse; a collapsed chip hides
      // its table so the whole chip toggles. Clicking a WP ROW is a SEPARATE interaction — it always
      // opens that WP's detail panel and never expands/collapses the card (the two were conflated:
      // in the default 3-up state a row click both opened the panel AND enlarged the card).
      card.addEventListener('click', (e) => {
        if (!mq.matches) return;                       // mobile already stacks cards full-width
        if (e.target.closest && e.target.closest('.rank-list')) return;  // rows → detail panel only
        const wasExpanded = card.classList.contains('t5-expanded');
        reset();
        if (!wasExpanded) {
          row.classList.add('t5-active');
          card.classList.add('t5-expanded');
          // Collapsed cards group on TOP (order 1, uniform chips); the expanded card takes its
          // own FULL-WIDTH row below them (basis 100% forces the wrap) so there's no dead space
          // beside it. order 2 keeps it after the collapsed chips.
          card.style.setProperty('flex', '1 1 100%', 'important');
          card.style.setProperty('min-width', '0', 'important');
          card.style.order = '2';
          cards.forEach(c => {
            if (c === card) return;
            c.classList.add('t5-collapsed');
            // Collapsed chips GROW to share the full top row (flex:1 1 0) so they stretch across
            // the width — no dead space on the right. The expanded card (basis 100%) wraps to its
            // own full-width row below them.
            c.style.setProperty('flex', '1 1 0', 'important');
            c.style.setProperty('min-width', '0', 'important');
            c.style.setProperty('width', 'auto', 'important');
            c.style.order = '1';
          });
          const ic = card.querySelector('.t5-caret');
          if (ic) ic.className = 'ti ti-arrows-diagonal-minimize-2 t5-caret';
        }
      });
    });
  });
}

/* ── AppTheme — dark / light mode ──────────────────────────────────────
   Stores preference in localStorage:
     wpm_theme_{userId}  — per-user authoritative preference
     wpm_theme_last      — most-recent theme for instant apply on next load
   ─────────────────────────────────────────────────────────────────── */
const AppTheme = (() => {
  const _key  = id => 'wpm_theme_' + (id || 'guest');
  const _last = 'wpm_theme_last';

  function _read(userId) {
    try { return localStorage.getItem(_key(userId)); } catch(e) { return null; }
  }
  function _save(userId, val) {
    try {
      localStorage.setItem(_key(userId), val);
      localStorage.setItem(_last, val);          // fast-path for next load
    } catch(e) {}
  }

  function isDark(userId) { return _read(userId) === 'dark'; }

  function _applyClasses(dark) {
    document.body.classList.toggle('dark-mode', dark);
    document.documentElement.classList.toggle('dark-mode', dark);
  }

  function _syncIcon(dark) {
    const btn = document.getElementById('theme-toggle-btn');
    if (!btn) return;
    // sun = switch to light; moon = switch to dark
    btn.innerHTML = dark
      ? '<i class="ti ti-sun"    style="font-size:1.2143rem;line-height:1"></i>'
      : '<i class="ti ti-moon-stars" style="font-size:1.2143rem;line-height:1"></i>';
    btn.title = dark ? 'Switch to Light Mode' : 'Switch to Dark Mode';
  }

  function apply(dark) {
    _applyClasses(dark);
    _syncIcon(dark);
    if (typeof Charts !== 'undefined' && Charts.updateTheme) Charts.updateTheme(dark);
  }

  /* Called by auth.js once userId is known */
  function init(userId) {
    const saved = _read(userId);
    // First time: default to system preference
    const dark = saved === 'dark' || (saved === null && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (saved === null && dark) _save(userId, 'dark');   // persist system default
    apply(dark);
  }

  function toggle(userId) {
    const next = !isDark(userId);
    _save(userId, next ? 'dark' : 'light');
    apply(next);
  }

  return { init, toggle, isDark, apply };
})();
window.AppTheme = AppTheme;

/* ── Tooltip helper (audit item: title-only affordances) ───────────────────
   The app leaned on the native `title` attribute in ~44 places. That is a poor
   affordance: it never appears on touch devices, is not keyboard reachable, and
   screen readers announce it inconsistently. Any element carrying `data-tip`
   now opens a real popover on click/tap or keyboard focus, and closes on Esc,
   blur or an outside click. The native `title` is left in place as a desktop
   hover fallback. */
(function(){
  let _tipEl = null, _tipFor = null;
  function ensure(){
    if (_tipEl) return _tipEl;
    _tipEl = document.createElement('div');
    _tipEl.className = 'app-tip';
    _tipEl.setAttribute('role','tooltip');
    _tipEl.style.display = 'none';
    document.body.appendChild(_tipEl);
    return _tipEl;
  }
  function hide(){ if(_tipEl){ _tipEl.style.display='none'; } _tipFor=null; }
  function show(target){
    const text = target.getAttribute('data-tip');
    if (!text) return;
    const t = ensure();
    t.textContent = text;
    t.style.display = 'block';
    // Position under the trigger, clamped to the viewport.
    const r = target.getBoundingClientRect();
    const tw = Math.min(280, Math.max(160, t.offsetWidth));
    t.style.width = tw + 'px';
    let left = r.left + window.scrollX;
    left = Math.min(left, window.scrollX + document.documentElement.clientWidth - tw - 10);
    t.style.left = Math.max(window.scrollX + 8, left) + 'px';
    t.style.top  = (r.bottom + window.scrollY + 6) + 'px';
    _tipFor = target;
  }
  function toggle(target){ (_tipFor === target) ? hide() : show(target); }

  document.addEventListener('click', function(e){
    const trg = e.target.closest && e.target.closest('[data-tip]');
    if (trg) { e.preventDefault(); toggle(trg); return; }
    if (_tipFor) hide();
  });
  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape') { hide(); return; }
    const trg = document.activeElement;
    if ((e.key === 'Enter' || e.key === ' ') && trg && trg.hasAttribute && trg.hasAttribute('data-tip')) {
      e.preventDefault(); toggle(trg);
    }
  });
  document.addEventListener('focusout', function(e){
    if (_tipFor && e.target === _tipFor) hide();
  });
  window.addEventListener('resize', hide);
  window.addEventListener('scroll', hide, true);
})();

/* ── AppNotify — consistent, non-blocking feedback ─────────────────────────
   The app raised 32 native alert()s, 7 of which dumped a raw Postgres message
   at the user ("Error: duplicate key value violates unique constraint …").
   alert() blocks the page, can't be styled, is easy to miss on mobile, and
   loses the detail behind an OK button.
   AppNotify renders a toast in the top-right instead:
     AppNotify.error(msg, {detail, title})   red, stays until dismissed
     AppNotify.warn(msg)   .success(msg)   .info(msg)   auto-dismiss
   `detail` (a raw DB message) is tucked behind a "Show details" disclosure so
   the headline stays readable but nothing is lost when reporting a bug. */
window.AppNotify = (function(){
  const KINDS = {
    error:   { icon:'ti-alert-circle',   cls:'ntf-error',   ttl:0     },
    warn:    { icon:'ti-alert-triangle', cls:'ntf-warn',    ttl:8000  },
    success: { icon:'ti-circle-check',   cls:'ntf-success', ttl:4000  },
    info:    { icon:'ti-info-circle',    cls:'ntf-info',    ttl:5000  },
    progress:{ icon:'ti-loader-2',       cls:'ntf-info',    ttl:0     },
  };
  function host(){
    let h = document.getElementById('app-notify');
    if (!h) {
      h = document.createElement('div');
      h.id = 'app-notify';
      // assertive: errors must interrupt; the container itself is the live region
      h.setAttribute('role','status');
      h.setAttribute('aria-live','polite');
      document.body.appendChild(h);
    }
    return h;
  }
  function esc(v){ return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function show(kind, msg, opts){
    opts = opts || {};
    const k = KINDS[kind] || KINDS.info;
    const n = document.createElement('div');
    n.className = 'ntf ' + k.cls;
    if (kind === 'error') n.setAttribute('role','alert');
    n.innerHTML =
      '<i class="ti ' + k.icon + ' ntf-ico" aria-hidden="true"></i>' +
      '<div class="ntf-body">' +
        (opts.title ? '<div class="ntf-title">' + esc(opts.title) + '</div>' : '') +
        '<div class="ntf-msg">' + esc(msg) + '</div>' +
        (opts.detail ? '<details class="ntf-detail"><summary>Show details</summary><code>' + esc(opts.detail) + '</code></details>' : '') +
      '</div>' +
      '<button class="ntf-x" aria-label="Dismiss">&times;</button>';
    n.querySelector('.ntf-x').addEventListener('click', () => close(n));
    if (kind === 'progress') { const ic = n.querySelector('.ntf-ico'); if (ic) ic.classList.add('spin'); }
    host().appendChild(n);
    if (k.ttl && !opts.sticky) setTimeout(() => close(n), k.ttl);
    return n;
  }
  function close(n){
    if (!n || !n.parentNode) return;
    n.style.opacity = '0'; n.style.transform = 'translateX(8px)';
    setTimeout(() => n.remove(), 160);
  }
  return {
    error:   (m,o) => show('error',   m, o),
    warn:    (m,o) => show('warn',    m, o),
    success: (m,o) => show('success', m, o),
    info:    (m,o) => show('info',    m, o),
    /* A sticky "working…" toast (spinner, never auto-dismisses) that you finish
       explicitly. Returns a handle: .update(msg) to change the text mid-run,
       .done(msg,opts) → sticky green success, .fail(msg,opts) → red error,
       .close() to just remove it. Use for long Data-Tools actions so the user
       has an unmistakable running→finished signal. */
    progress: function(msg, opts){
      const n = show('progress', msg, opts);
      return {
        node: n,
        update(m){ const b = n && n.querySelector('.ntf-msg'); if (b) b.textContent = m; },
        done(m, o){ close(n); return show('success', m, Object.assign({ sticky:true }, o||{})); },
        fail(m, o){ close(n); return show('error', m, o); },
        close(){ close(n); }
      };
    },
    /* Turn a thrown error into a readable headline + the raw text behind a
       disclosure. Postgres/PostgREST messages are unreadable to an officer. */
    fromError: function(err, headline){
      const raw = (err && (err.message || err.details)) || String(err || '');
      let msg = headline || 'Something went wrong.';
      if (/duplicate key|unique constraint/i.test(raw))      msg = headline || 'That value already exists — pick a different one.';
      else if (/permission denied|row-level security|42501/i.test(raw)) msg = headline || "You don't have permission to do that.";
      else if (/column .* does not exist|schema cache/i.test(raw))      msg = headline || 'The database is missing a column this app expects — a migration is pending.';
      else if (/network|fetch|timeout/i.test(raw))           msg = headline || 'Network problem — check your connection and try again.';
      return show('error', msg, { detail: raw });
    },
    clear: function(){ const h=document.getElementById('app-notify'); if(h) h.innerHTML=''; }
  };
})();

/* ── BidWidget — vendor bid logging + history (Phase 2b) ──────────────────
   Two entry points sharing one self-contained widget:
   • mount(container,{wpId,projectId,canEdit,onChange})  — per-WP Log Bid UI
     (list + add/edit/delete via VendorDb.upsertBid/deleteBid, with a searchable
     approved-vendor combobox + inline quick-create). Used by the WP detail
     panels in index.html / project.html.
   • mountForVendor(container,{vendorId,canEdit})         — per-vendor Bid
     History (read-only list + delete). Used by vendors.html detail modal.
   Bids carry money, so callers must NOT mount for the plain `viewer` role
   (window.__hideBudget) — vendor_bids RLS also denies that role server-side.
   Only one WP-detail / one vendor-detail is open at a time, so single module
   state is safe. Follows the AppNotify/Tooltip self-contained convention. */
window.BidWidget = (function(){
  const STATUSES = ['participated','shortlisted','awarded','lost','withdrawn'];
  const SC = { participated:'#6E6C6C', shortlisted:'#2563EB', awarded:'#2D9B6F', lost:'#EE3124', withdrawn:'#9B9999' };
  const esc = v => (window.esc ? window.esc(v) : String(v==null?'':v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
  const money = v => { if (v==null||v==='') return '—'; const n=Number(v); return isNaN(n)?'—':'₱'+Math.round(n).toLocaleString(); };
  const fdate = d => { if(!d) return ''; try{ return new Date(d).toLocaleDateString('en-US',{month:'short',day:'2-digit',year:'numeric'});}catch{return d;} };
  const cap = s => (s||'').charAt(0).toUpperCase()+(s||'').slice(1);
  const pill = s => `<span class="bw-pill" style="background:${(SC[s]||'#6E6C6C')}22;color:${SC[s]||'#6E6C6C'}">${esc(s||'participated')}</span>`;
  const offersOf = b => [b.original_offer!=null?`Orig ${money(b.original_offer)}`:null, b.negotiated_offer!=null?`Neg ${money(b.negotiated_offer)}`:null, b.final_amount!=null?`Final ${money(b.final_amount)}`:null].filter(Boolean).join(' → ') || '—';

  let _cssDone=false, _outsideWired=false;
  function injectCss(){
    if (_cssDone) return; _cssDone=true;
    const s=document.createElement('style'); s.id='bidwidget-css';
    s.textContent = `
      .bw-wrap{margin-top:14px}
      .bw-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}
      .bw-title{font-size:0.7143rem;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:.04em}
      .bw-add-btn{border:1px solid #EE3124;color:#EE3124;background:#fff;border-radius:8px;padding:4px 10px;font-size:0.75rem;font-weight:600;font-family:inherit;cursor:pointer}
      .bw-add-btn:hover{background:#FDECEA}
      .bw-row{display:flex;align-items:flex-start;gap:8px;padding:8px 0;border-bottom:1px solid #f5f5f5}
      .bw-row:last-child{border-bottom:none}
      .bw-row-main{flex:1;min-width:0}
      .bw-vname{font-size:0.8571rem;font-weight:600;color:#231F20;word-break:break-word}
      .bw-offers{font-size:0.7857rem;color:#555;margin-top:2px}
      .bw-meta{font-size:0.7143rem;color:#888;margin-top:2px;word-break:break-word}
      .bw-pill{display:inline-block;font-size:0.6875rem;font-weight:700;padding:1px 7px;border-radius:9px;text-transform:capitalize;margin-left:4px}
      .bw-icon{background:none;border:none;cursor:pointer;font-size:0.9286rem;padding:2px 4px}
      .bw-empty{font-size:0.8rem;color:#888;padding:6px 0}
      .bw-form{background:#f7f7f7;border-radius:8px;padding:10px;margin-top:8px;display:grid;grid-template-columns:1fr 1fr;gap:8px}
      .bw-form input,.bw-form select{padding:7px 9px;border:1px solid #e0e0e0;border-radius:7px;font-size:0.8rem;font-family:inherit;width:100%;box-sizing:border-box}
      .bw-form .bw-full{grid-column:1/-1}
      .bw-form-actions{grid-column:1/-1;display:flex;gap:8px;justify-content:flex-end}
      .bw-save{background:#EE3124;color:#fff;border:none;border-radius:7px;padding:8px 14px;font-size:0.8rem;font-weight:600;font-family:inherit;cursor:pointer}
      .bw-cancel{background:transparent;color:#666;border:1px solid #e0e0e0;border-radius:7px;padding:8px 14px;font-size:0.8rem;font-family:inherit;cursor:pointer}
      .bw-vc{position:relative}
      .bw-vc-pop{position:absolute;top:100%;left:0;right:0;z-index:20;background:#fff;border:1px solid #e0e0e0;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.14);max-height:190px;overflow-y:auto;margin-top:2px}
      .bw-vc-opt{padding:7px 10px;font-size:0.8rem;cursor:pointer}
      .bw-vc-opt:hover{background:#FDECEA}
      .bw-vc-new{color:#EE3124;font-weight:600}
      body.dark-mode .bw-title,body.dark-mode .bw-meta,body.dark-mode .bw-empty{color:var(--text-hint)}
      body.dark-mode .bw-vname{color:var(--text-primary)}
      body.dark-mode .bw-offers{color:var(--text-secondary)}
      body.dark-mode .bw-row{border-bottom-color:var(--border)}
      body.dark-mode .bw-add-btn{background:transparent}
      body.dark-mode .bw-form{background:var(--surface-2)}
      body.dark-mode .bw-form input,body.dark-mode .bw-form select,body.dark-mode .bw-vc-pop{background:var(--surface);color:var(--text-primary);border-color:var(--border-md)}
      body.dark-mode .bw-vc-opt:hover{background:rgba(238,49,36,.18)}
      body.dark-mode .bw-cancel{color:var(--text-hint);border-color:var(--border-md)}`;
    document.head.appendChild(s);
    if (!_outsideWired){ _outsideWired=true; document.addEventListener('click', e => { if(!e.target.closest('.bw-vc')){ const p=document.getElementById('bw-vc-pop'); if(p) p.style.display='none'; } }); }
  }

  /* ── per-WP Log Bid ── */
  let cur=null, _vcResults=[], _vcTimer=null;
  async function mount(container, opts){
    injectCss();
    const el = typeof container==='string' ? document.getElementById(container) : container;
    if (!el) return;
    cur = { wpId:opts.wpId, projectId:opts.projectId||null, canEdit:!!opts.canEdit, el, bids:[], editingId:null, vendorId:'', vendorName:'', showForm:false, onChange:opts.onChange||null };
    await refresh();
  }
  async function refresh(){ if(!cur) return; try{ cur.bids = await VendorDb.getBidsForWP(cur.wpId); }catch(e){ cur.bids=[]; } render(); }
  function render(){
    if(!cur) return;
    const rows = cur.bids.length ? cur.bids.map(b=>{
      const meta=[fdate(b.bid_date)?('Bid '+fdate(b.bid_date)):null, b.award_date?('Awarded '+fdate(b.award_date)):null, b.notes?esc(b.notes):null].filter(Boolean).join(' · ');
      const act = cur.canEdit ? `<button class="bw-icon" style="color:#2563EB" title="Edit" onclick="BidWidget._edit('${b.id}')"><i class="ti ti-pencil"></i></button><button class="bw-icon" style="color:#EE3124" title="Delete" onclick="BidWidget._del('${b.id}')"><i class="ti ti-trash"></i></button>` : '';
      return `<div class="bw-row"><div class="bw-row-main"><div class="bw-vname">${esc(b.vendor_name||'(unknown vendor)')}${pill(b.status)}</div><div class="bw-offers">${offersOf(b)}</div>${meta?`<div class="bw-meta">${meta}</div>`:''}</div>${act}</div>`;
    }).join('') : `<div class="bw-empty">No bids logged for this work package yet.</div>`;
    const addBtn = cur.canEdit && !cur.showForm ? `<button class="bw-add-btn" onclick="BidWidget._openForm()"><i class="ti ti-plus"></i> Log Bid</button>` : '';
    let html = `<div class="bw-wrap"><div class="bw-head"><span class="bw-title">Bidding</span>${addBtn}</div>${rows}`;
    if (cur.canEdit && cur.showForm) html += formHtml();
    cur.el.innerHTML = html + `</div>`;
    if (cur.showForm){ const i=document.getElementById('bw-vendor'); if(i && !cur.editingId) i.focus(); }
  }
  function formHtml(){
    const v = cur.editingId ? (cur.bids.find(b=>b.id===cur.editingId)||{}) : {};
    return `<div class="bw-form">
      <div class="bw-full bw-vc">
        <input id="bw-vendor" placeholder="Vendor name" autocomplete="off" value="${esc(cur.vendorName||'')}" ${cur.editingId?'readonly':''} oninput="BidWidget._vc(true)" onfocus="BidWidget._vc(false)">
        <div id="bw-vc-pop" class="bw-vc-pop" style="display:none"></div>
      </div>
      <select id="bw-status">${STATUSES.map(s=>`<option value="${s}"${(v.status||'participated')===s?' selected':''}>${cap(s)}</option>`).join('')}</select>
      <input id="bw-bid-date" type="date" value="${v.bid_date||''}" title="Bid date">
      <input id="bw-orig" type="number" step="any" placeholder="Original offer (₱)" value="${v.original_offer??''}">
      <input id="bw-neg" type="number" step="any" placeholder="Negotiated offer (₱)" value="${v.negotiated_offer??''}">
      <input id="bw-final" type="number" step="any" placeholder="Final amount (₱)" value="${v.final_amount??''}">
      <input id="bw-notes" class="bw-full" placeholder="Notes (optional)" value="${esc(v.notes||'')}">
      <div class="bw-form-actions"><button class="bw-cancel" onclick="BidWidget._cancel()">Cancel</button><button class="bw-save" onclick="BidWidget._save()">${cur.editingId?'Update Bid':'Add Bid'}</button></div>
    </div>`;
  }
  function _openForm(){ if(!cur) return; cur.editingId=null; cur.vendorId=''; cur.vendorName=''; cur.showForm=true; render(); }
  function _cancel(){ if(!cur) return; cur.showForm=false; cur.editingId=null; cur.vendorId=''; cur.vendorName=''; render(); }
  function _edit(id){ if(!cur) return; const b=cur.bids.find(x=>x.id===id); if(!b) return; cur.editingId=id; cur.vendorId=b.vendor_id; cur.vendorName=b.vendor_name||''; cur.showForm=true; render(); }
  async function _del(id){ if(!cur||!confirm('Delete this bid entry?')) return; try{ await VendorDb.deleteBid(id); await refresh(); if(cur.onChange) cur.onChange(); }catch(e){ window.AppNotify?AppNotify.fromError(e,'Could not delete bid'):alert(e.message); } }
  function _vc(clearId){
    if(!cur) return;
    const input=document.getElementById('bw-vendor'), pop=document.getElementById('bw-vc-pop');
    if(!input||!pop) return;
    if(cur.editingId){ pop.style.display='none'; return; }
    if(clearId){ cur.vendorId=''; }
    cur.vendorName=input.value;
    const q=input.value.trim();
    clearTimeout(_vcTimer);
    _vcTimer=setTimeout(async ()=>{
      try{ _vcResults = await VendorDb.searchApprovedVendors(q); }catch(e){ _vcResults=[]; }
      let h = _vcResults.map(v=>`<div class="bw-vc-opt" onclick="BidWidget._vcPick('${v.id}')">${esc(v.name)}</div>`).join('');
      if(q && !_vcResults.some(v=>v.name.toLowerCase()===q.toLowerCase())) h += `<div class="bw-vc-opt bw-vc-new" onclick="BidWidget._vcAddNew()"><i class="ti ti-plus"></i> Add "${esc(q)}" as a new vendor</div>`;
      pop.innerHTML = h || `<div class="bw-vc-opt" style="color:#888;cursor:default">No approved vendors match.</div>`;
      pop.style.display='block';
    }, 250);
  }
  function _vcPick(id){ if(!cur) return; const v=_vcResults.find(x=>x.id===id); if(!v) return; cur.vendorId=v.id; cur.vendorName=v.name; const i=document.getElementById('bw-vendor'); if(i) i.value=v.name; const p=document.getElementById('bw-vc-pop'); if(p) p.style.display='none'; }
  async function _vcAddNew(){
    if(!cur) return;
    const input=document.getElementById('bw-vendor'); const name=(input?input.value:'').trim(); if(!name) return;
    try{ const v=await VendorDb.quickCreateVendor(name, window.__profile||null); cur.vendorId=v.id; cur.vendorName=v.name; if(input) input.value=v.name; const p=document.getElementById('bw-vc-pop'); if(p) p.style.display='none'; if(window.AppNotify) AppNotify.info('Vendor added as pending review — approve it in the Vendors directory.'); }
    catch(e){ window.AppNotify?AppNotify.fromError(e,'Could not create vendor'):alert(e.message); }
  }
  async function _save(){
    if(!cur) return;
    if(!cur.vendorId){ window.AppNotify?AppNotify.warn('Pick a vendor (or add a new one) first.'):alert('Pick a vendor first.'); return; }
    const num=id=>{ const v=document.getElementById(id).value; return v===''?null:parseFloat(v); };
    const fields={ status:document.getElementById('bw-status').value, bid_date:document.getElementById('bw-bid-date').value||null, original_offer:num('bw-orig'), negotiated_offer:num('bw-neg'), final_amount:num('bw-final'), notes:document.getElementById('bw-notes').value.trim()||null };
    try{ await VendorDb.upsertBid(cur.wpId, cur.vendorId, cur.projectId, fields, window.__profile||null); cur.showForm=false; cur.editingId=null; cur.vendorId=''; cur.vendorName=''; await refresh(); if(cur.onChange) cur.onChange(); if(window.AppNotify) AppNotify.success('Bid saved.'); }
    catch(e){ window.AppNotify?AppNotify.fromError(e,'Could not save bid'):alert(e.message); }
  }

  /* ── per-vendor Bid History ── */
  let _vm=null;
  async function mountForVendor(container, opts){
    injectCss();
    const el = typeof container==='string' ? document.getElementById(container) : container;
    if(!el) return;
    _vm={ el, vendorId:opts.vendorId, canEdit:!!opts.canEdit };
    let bids=[]; try{ bids=await VendorDb.getBidsForVendor(opts.vendorId); }catch(e){ bids=[]; }
    const rows = bids.length ? bids.map(b=>{
      const wpLabel = b.wp_no?`WP ${esc(b.wp_no)}`:'(unlinked bid)';
      const meta=[b.wp_description?esc(b.wp_description):null, b.project_id?esc(b.project_id):null, fdate(b.bid_date)?('Bid '+fdate(b.bid_date)):null, b.award_date?('Awarded '+fdate(b.award_date)):null].filter(Boolean).join(' · ');
      const del = _vm.canEdit ? `<button class="bw-icon" style="color:#EE3124" title="Delete" onclick="BidWidget._delVendor('${b.id}')"><i class="ti ti-trash"></i></button>` : '';
      return `<div class="bw-row"><div class="bw-row-main"><div class="bw-vname">${wpLabel}${pill(b.status)}</div><div class="bw-offers">${offersOf(b)}</div>${meta?`<div class="bw-meta">${meta}</div>`:''}</div>${del}</div>`;
    }).join('') : `<div class="bw-empty">No bids recorded for this vendor yet. Bids are logged from a work package's detail panel.</div>`;
    el.innerHTML = `<div class="bw-wrap">${rows}</div>`;
  }
  async function _delVendor(id){
    if(!_vm||!confirm('Delete this bid entry?')) return;
    try{ await VendorDb.deleteBid(id); }catch(e){ window.AppNotify?AppNotify.fromError(e,'Could not delete bid'):alert(e.message); return; }
    mountForVendor(_vm.el, { vendorId:_vm.vendorId, canEdit:_vm.canEdit });
  }

  return { mount, refresh, render, mountForVendor, _openForm, _cancel, _edit, _del, _vc, _vcPick, _vcAddNew, _save, _delVendor };
})();
