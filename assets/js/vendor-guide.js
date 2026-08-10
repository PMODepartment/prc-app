/* ============================================================================
 * Vendor Management guide — self-contained slide-deck modal for vendors.html.
 * Mirrors the onboarding.js/patch-notice.js pattern: injects its own CSS
 * (theme-aware via the --surface / --text / --mw-red CSS vars), builds its DOM,
 * keyboard nav (←/→/Esc), progress dots, injects the topbar "?" button, and
 * auto-opens once per user. Staff-facing (vendors.html is internal-only).
 *   window.VendorGuide.open()  /  .maybeAutoOpen(userId)
 * ========================================================================== */
(function () {
  var SLIDES = [
    { icon: 'ti-building-store', title: 'Vendor Management', body:
      'A central directory of every vendor, subcontractor and supplier — their <b>trades</b>, <b>products &amp; services</b>, <b>certifications</b>, <b>personnel</b>, <b>bid history</b> and <b>reference rates</b>. It plugs into Work Packages: the Awarded Vendor and Proposed Vendors on a WP link here.' },
    { icon: 'ti-layout-grid', title: 'Finding vendors', body:
      '<ul><li><b>Cards / Table</b> toggle — cards for browsing, table for a dense view.</li><li><b>Search</b> matches company name, trade, <i>and</i> product/service.</li><li><b>Status</b> filter + <b>pagination</b> (60 per page) keep large lists fast.</li><li>Click any vendor to open its full profile.</li></ul>' },
    { icon: 'ti-checkbox', title: 'Approving vendors', body:
      'Vendors are <b>Pending review</b>, <b>Approved</b>, <b>Rejected</b> or <b>Inactive</b>. Only <b>Approved</b> vendors are selectable on Work Packages. Approve/Reject right on a pending card, or open the profile to review first.' },
    { icon: 'ti-user-plus', title: 'Adding vendors', body:
      '<ul><li><b>Add Vendor</b> — create a vendor you’ve vetted (goes live approved immediately).</li><li>Give any vendor an <b>invite link</b> (in their profile’s Overview) so they can log in and maintain their own products, certs and personnel via the vendor portal.</li></ul>' },
    { icon: 'ti-tool', title: 'Data Tools', body:
      '<ul><li><b>Import from WPs</b> — pull vendor names out of existing work packages.</li><li><b>Backfill Trade/Bid Data</b> — fill trades, products, bids &amp; rates from awarded WPs.</li><li><b>Merge</b> — combine duplicate records (typos / different names for one company).</li><li><b>Needs Splitting</b> — break apart garbled multi-name imports.</li></ul>' },
    { icon: 'ti-list-check', title: 'Bulk actions', body:
      'Tick the checkbox on cards or rows to select vendors — the selection survives paging and filtering. Use <b>Select all matching</b> to grab a whole filtered set, then <b>Approve</b>, <b>Reject</b> or <b>Delete</b> in one go. Ideal for triaging a big imported list. (Delete is admin-only.)' },
    { icon: 'ti-id-badge-2', title: 'Inside a vendor profile', body:
      'One scrolling page with a jump-nav: <b>Overview</b> (contact + trades + invite link), <b>Products &amp; Services</b> (each tagged Materials / Labor / Service), <b>Certifications</b> (with file uploads), <b>Personnel</b>, <b>Rates</b>, and <b>Bid History</b>. Staff can edit every section on the vendor’s behalf.' },
    { icon: 'ti-circle-check', title: 'You’re set', body:
      'That’s the tour. Reopen it any time from the <b>?</b> button in the top bar. Start by searching a vendor or reviewing the pending list.' },
  ];

  var idx = 0, built = false, root = null;

  function injectCss() {
    if (document.getElementById('vg-css')) return;
    var s = document.createElement('style'); s.id = 'vg-css';
    s.textContent = [
      '.vg-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:4000;display:flex;align-items:center;justify-content:center;padding:20px}',
      '.vg-card{background:var(--surface,#fff);color:var(--text-primary,#231F20);width:100%;max-width:520px;border-radius:16px;box-shadow:0 24px 60px rgba(0,0,0,.3);display:flex;flex-direction:column;overflow:hidden}',
      '.vg-body{padding:30px 30px 8px;text-align:center;min-height:230px}',
      '.vg-ic{width:60px;height:60px;border-radius:15px;background:var(--mw-red-light,#FDECEA);color:var(--mw-red,#EE3124);display:flex;align-items:center;justify-content:center;margin:0 auto 16px}',
      '.vg-ic i{font-size:30px}',
      '.vg-title{font-size:20px;font-weight:800;margin-bottom:10px}',
      '.vg-text{font-size:14px;line-height:1.6;color:var(--text-secondary,#5A5858)}',
      '.vg-text ul{text-align:left;margin:6px 0 0;padding-left:20px}.vg-text li{margin-bottom:6px}',
      '.vg-foot{display:flex;align-items:center;gap:12px;padding:14px 20px 20px}',
      '.vg-dots{display:flex;gap:6px;flex:1;justify-content:center}',
      '.vg-dot{width:8px;height:8px;border-radius:50%;background:var(--border-md,rgba(0,0,0,.16));cursor:pointer}',
      '.vg-dot.on{background:var(--mw-red,#EE3124)}',
      '.vg-btn{padding:9px 18px;border-radius:9px;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer;border:1px solid var(--border-md,rgba(0,0,0,.16));background:transparent;color:var(--text-primary,#231F20)}',
      '.vg-btn.primary{background:var(--mw-red,#EE3124);border-color:var(--mw-red,#EE3124);color:#fff}',
      '.vg-x{position:absolute;top:14px;right:16px;background:none;border:none;font-size:22px;line-height:1;color:var(--text-hint,#888);cursor:pointer}',
      '.vg-card{position:relative}',
      '@media(max-width:520px){.vg-foot{flex-wrap:wrap;row-gap:10px}.vg-dots{order:1;flex-basis:100%}.vg-btn{flex:1}}'
    ].join('');
    document.head.appendChild(s);
  }

  function build() {
    injectCss();
    root = document.createElement('div');
    root.className = 'vg-overlay'; root.style.display = 'none';
    root.innerHTML =
      '<div class="vg-card" role="dialog" aria-modal="true" aria-label="Vendor Management guide">' +
        '<button class="vg-x" aria-label="Close" onclick="VendorGuide.close()">&times;</button>' +
        '<div class="vg-body"><div class="vg-ic"><i class="ti"></i></div><div class="vg-title"></div><div class="vg-text"></div></div>' +
        '<div class="vg-foot">' +
          '<button class="vg-btn" id="vg-back">Back</button>' +
          '<div class="vg-dots" id="vg-dots"></div>' +
          '<button class="vg-btn primary" id="vg-next">Next</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(root);
    root.addEventListener('click', function (e) { if (e.target === root) close(); });
    root.querySelector('#vg-back').addEventListener('click', function () { go(idx - 1); });
    root.querySelector('#vg-next').addEventListener('click', function () { idx >= SLIDES.length - 1 ? close() : go(idx + 1); });
    document.addEventListener('keydown', onKey);
    built = true;
  }

  function onKey(e) {
    if (!root || root.style.display === 'none') return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') go(idx + 1);
    else if (e.key === 'ArrowLeft') go(idx - 1);
  }

  function render() {
    var s = SLIDES[idx];
    root.querySelector('.vg-ic i').className = 'ti ' + s.icon;
    root.querySelector('.vg-title').textContent = s.title;
    root.querySelector('.vg-text').innerHTML = s.body;
    root.querySelector('#vg-back').style.visibility = idx === 0 ? 'hidden' : 'visible';
    root.querySelector('#vg-next').textContent = idx >= SLIDES.length - 1 ? 'Done' : 'Next';
    var dots = SLIDES.map(function (_, i) {
      return '<span class="vg-dot' + (i === idx ? ' on' : '') + '" onclick="VendorGuide._go(' + i + ')"></span>';
    }).join('');
    root.querySelector('#vg-dots').innerHTML = dots;
  }

  function go(n) { if (n < 0 || n >= SLIDES.length) return; idx = n; render(); }
  function open(n) { if (!built) build(); idx = n || 0; render(); root.style.display = 'flex'; }
  function close() {
    if (root) root.style.display = 'none';
    try { if (window.__vgUser) localStorage.setItem('wpm_vendorguide_' + window.__vgUser, '1'); } catch (e) {}
  }
  function maybeAutoOpen(userId) {
    window.__vgUser = userId || '';
    try { if (userId && localStorage.getItem('wpm_vendorguide_' + userId)) return; } catch (e) {}
    setTimeout(function () { open(0); }, 800);
  }

  /* Topbar "?" button — injected idempotently, before #user-bar (same slot as
     onboarding.js's). Only vendors.html loads this file, so no clash. */
  function injectButton() {
    var tr = document.querySelector('.topbar-right');
    if (!tr || document.getElementById('btn-guide')) return;
    var b = document.createElement('button');
    b.className = 'btn-guide'; b.id = 'btn-guide';
    b.title = 'Vendor Management guide';
    b.setAttribute('aria-label', 'Open Vendor Management guide');
    b.innerHTML = '<i class="ti ti-help"></i>';
    b.onclick = function () { open(0); };
    var ub = document.getElementById('user-bar');
    if (ub) tr.insertBefore(b, ub); else tr.appendChild(b);
    // Reuse onboarding.js's .btn-guide styling if present; otherwise add a minimal one.
    if (!document.getElementById('ob-css') && !document.getElementById('vg-btnguide-css')) {
      var s = document.createElement('style'); s.id = 'vg-btnguide-css';
      s.textContent = '.btn-guide{width:34px;height:34px;border-radius:8px;border:1px solid var(--border-md,rgba(0,0,0,.14));background:var(--surface,#fff);color:var(--text-secondary,#5A5858);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}.btn-guide:hover{color:var(--mw-red,#EE3124);border-color:var(--mw-red,#EE3124)}.btn-guide i{font-size:17px}';
      document.head.appendChild(s);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectButton);
  else injectButton();

  window.VendorGuide = { open: open, close: close, maybeAutoOpen: maybeAutoOpen, _go: go };
})();
