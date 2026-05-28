/* ui.js — shared UI helpers */

/* ── Mobile sidebar toggle ─────────────────────────────────────────── */
function initMobileMenu() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const btnMenu = document.getElementById('btn-menu');
  if (!sidebar || !overlay || !btnMenu) return;

  function openMenu() {
    sidebar.classList.add('open');
    overlay.classList.add('show');
    document.body.style.overflow = 'hidden';
  }
  function closeMenu() {
    sidebar.classList.remove('open');
    overlay.classList.remove('show');
    document.body.style.overflow = '';
  }

  btnMenu.addEventListener('click', openMenu);
  overlay.addEventListener('click', closeMenu);
  sidebar.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', () => { if (window.innerWidth < 768) closeMenu(); });
  });
}

/* ── Pending WP badge ──────────────────────────────────────────────── */
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
