/* ui.js â€” shared UI helpers */

/* â”€â”€ Mobile sidebar toggle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function initMobileMenu() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const btnMenu = document.getElementById('btn-menu');
  if (!sidebar || !overlay || !btnMenu) return;

  btnMenu.addEventListener('click', () => {
    sidebar.classList.add('open');
    overlay.classList.add('show');
    document.body.style.overflow = 'hidden'; // prevent background scroll
  });

  function closeMenu() {
    sidebar.classList.remove('open');
    overlay.classList.remove('show');
    document.body.style.overflow = '';
  }

  overlay.addEventListener('click', closeMenu);

  // Close on nav-item click (mobile only)
  sidebar.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', () => {
      if (window.innerWidth < 768) closeMenu();
    });
  });
}

/* â”€â”€ Pending badge on Review WPs nav item â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
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
