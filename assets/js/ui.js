/* ui.js — shared UI helpers */

/* ── Prevent pinch-zoom on iOS (Safari ignores viewport user-scalable since iOS 10) ── */
(function() {
  document.addEventListener('touchmove', function(e) {
    if (e.touches.length > 1) e.preventDefault();
  }, { passive: false });
  document.addEventListener('gesturestart', function(e) {
    e.preventDefault();
  });
})();

/* ── Mobile sidebar toggle ──────────────────────────────────────────── */
function initMobileMenu() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const btnMenu = document.getElementById('btn-menu');
  if (!sidebar || !overlay || !btnMenu) return;

  btnMenu.addEventListener('click', () => {
    sidebar.classList.add('open');
    overlay.classList.add('show');
    document.body.style.overflow = 'hidden';
  });

  function closeMenu() {
    sidebar.classList.remove('open');
    overlay.classList.remove('show');
    document.body.style.overflow = '';
  }

  overlay.addEventListener('click', closeMenu);

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
      wrap.style.height = (expanded ? origH * 2.2 : origH) + 'px';
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
