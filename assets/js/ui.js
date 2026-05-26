/* ui.js — shared UI helpers */

/* ── Mobile sidebar toggle ───────────────────────────────────────── */
function initMobileMenu() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const btnMenu = document.getElementById('btn-menu');
  if (!sidebar || !overlay || !btnMenu) return;

  btnMenu.addEventListener('click', () => {
    sidebar.classList.add('open');
    overlay.classList.add('show');
  });
  overlay.addEventListener('click', () => {
    sidebar.classList.remove('open');
    overlay.classList.remove('show');
  });
  /* Close on nav-item click on mobile */
  sidebar.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('show');
    });
  });
}

/* ── Render user bar ─────────────────────────────────────────────── */
function renderUserBar(containerId, profile) {
  const el = document.getElementById(containerId);
  if (!el || !profile) return;
  const roleLabel = {
    admin: 'Admin',
    procurement_officer: 'Procurement Officer',
  }[profile.role] || profile.role;
  const projLabel = profile.role === 'admin' ? 'All projects' :
    (profile.projects && profile.projects.length ? profile.projects.join(', ') : 'None assigned');

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px">
      <div style="text-align:right;display:none" class="user-info-text">
        <div style="font-size:12px;font-weight:700;color:var(--text-primary)">${profile.name}</div>
        <div style="font-size:10px;color:var(--text-secondary)">${roleLabel} · ${projLabel}</div>
      </div>
      <div class="user-avatar">${profile.name.charAt(0).toUpperCase()}</div>
      <button class="btn-logout" onclick="AppAuth.logout()" title="Sign out">
        <i class="ti ti-logout" style="font-size:14px;vertical-align:middle"></i>
      </button>
    </div>`;

  /* Show name on wider screens */
  const info = el.querySelector('.user-info-text');
  if (window.innerWidth >= 640 && info) info.style.display = 'block';
  window.addEventListener('resize', () => {
    if (info) info.style.display = window.innerWidth >= 640 ? 'block' : 'none';
  });
}

/* ── Pending badge on Review WPs nav item ────────────────────────── */
async function updatePendingBadge() {
  try {
    const wps = await WPDb.getPendingWPs();
    const badge = document.getElementById('review-badge');
    if (badge) {
      badge.textContent = wps.length;
      badge.style.display = wps.length > 0 ? 'flex' : 'none';
    }
  } catch(e) { /* silent */ }
}

/* ── Build rank list ─────────────────────────────────────────────── */
function buildRankList(id, items, cls, fmtFn) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!items.length) {
    el.innerHTML = '<div class="empty-state"><i class="ti ti-circle-off"></i>No data</div>';
    return;
  }
  const max = Math.max(...items.map(i => Math.abs(i.val)), 0.01);
  el.innerHTML = items.map((it, i) => `
    <div class="rank-item">
      <span class="rank-num">${i + 1}</span>
      <div class="rank-body">
        <div class="rank-name" title="${it.name}">${it.name}</div>
        <div class="rank-sub">${it.sub}</div>
        <div class="rank-bar-bg">
          <div class="rank-bar-fill" style="width:${Math.round(Math.abs(it.val) / max * 100)}%;background:${it.color}"></div>
        </div>
      </div>
      <span class="rank-val ${cls}">${fmtFn(it.val)}</span>
    </div>`).join('');
}

/* ── Build metric cards ──────────────────────────────────────────── */
function buildMetrics(containerId, cards) {
  document.getElementById(containerId).innerHTML = cards.map(c => `
    <div class="metric-card accent-${c.accent}">
      <div class="metric-label">${c.lbl}</div>
      <div class="metric-value ${c.cls || ''}">${c.val}</div>
      ${c.sub ? `<div class="metric-sub">${c.sub}</div>` : ''}
    </div>`).join('');
}
