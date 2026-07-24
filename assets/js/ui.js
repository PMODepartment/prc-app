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

  // Restore the collapsed state on desktop without animating the slide on first paint.
  if (isDesktop() && localStorage.getItem(COLLAPSE_KEY) === '1') {
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
            ${label ? `<span style="font-size:10px;color:rgba(255,255,255,0.4);margin-left:auto;font-weight:400;flex-shrink:0">${label}</span>` : ''}
          </a>
          <button onclick="event.stopPropagation();SidebarPrefs.togglePinAndRefresh('${userId}','${p.id}')"
            title="${pinned?'Unpin':'Pin to sidebar'}"
            style="flex-shrink:0;background:none;border:none;cursor:pointer;padding:4px 6px;color:${pinned?'#EE3124':'rgba(255,255,255,0.25)'};font-size:13px;line-height:1;border-radius:4px"
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

    // Build expand button — append to panel-title flex row
    const hasAutoMarginChild = Array.from(titleEl.children).some(
      c => c.style && c.style.marginLeft === 'auto'
    );
    const btn = document.createElement('span');
    btn.className = 'chart-expand-btn';
    if (!hasAutoMarginChild) btn.style.marginLeft = 'auto';
    btn.style.cssText += ';cursor:pointer;display:inline-flex;align-items:center;opacity:0.4;transition:opacity .15s;flex-shrink:0;padding:2px 4px;border-radius:4px';
    btn.title = 'Expand chart';
    btn.innerHTML = '<i class="ti ti-arrows-diagonal" style="font-size:12px"></i>';
    btn.addEventListener('mouseenter', () => { btn.style.opacity = '1'; btn.style.background = 'rgba(238,49,36,.07)'; });
    btn.addEventListener('mouseleave', () => { btn.style.opacity = expanded ? '1' : '0.4'; btn.style.background = ''; });
    titleEl.appendChild(btn);

    btn.addEventListener('click', e => {
      e.stopPropagation();
      expanded = !expanded;
      // Expanded height is set inline-!important so it beats the mobile `.chart-mob-h{height:300px!important}`
      // rule; on collapse a plain inline height restores the default (mobile rule re-applies its 300px).
      if (expanded) wrap.style.setProperty('height', (origH * 2.2) + 'px', 'important');
      else wrap.style.height = origH + 'px';
      btn.querySelector('i').className = expanded ? 'ti ti-arrows-diagonal-minimize-2' : 'ti ti-arrows-diagonal';
      btn.style.opacity = '1';
      btn.title = expanded ? 'Collapse chart' : 'Expand chart';
      if (!expanded) btn.style.opacity = '0.4';

      // Toggle data labels after Chart.js resizes (next animation frame)
      requestAnimationFrame(() => {
        if (typeof Charts !== 'undefined') {
          expanded ? Charts.expand(canvas.id) : Charts.collapse(canvas.id);
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
      ? '<i class="ti ti-sun"    style="font-size:17px;line-height:1"></i>'
      : '<i class="ti ti-moon-stars" style="font-size:17px;line-height:1"></i>';
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
    host().appendChild(n);
    if (k.ttl) setTimeout(() => close(n), k.ttl);
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
