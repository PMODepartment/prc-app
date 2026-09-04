/* ============================================================================
 * Vendor Management guide — self-contained slide-deck modal for vendors.html.
 * Mirrors the onboarding.js/patch-notice.js pattern: injects its own CSS
 * (theme-aware via the --surface / --text / --mw-red CSS vars), builds its DOM,
 * keyboard nav (←/→/Esc), progress dots, injects the topbar "?" button, and
 * auto-opens once per user. Staff-facing (vendors.html is internal-only).
 *   window.VendorGuide.open()  /  .maybeAutoOpen(userId)
 * ========================================================================== */
(function () {
  /* ⚠️ SHORT ON PURPOSE. These slides used to be paragraphs — six or seven
     lines each, several with nested bullet lists — and nobody reads a tour
     that reads like documentation. One idea per slide, a handful of words,
     bold on the thing you would actually click. The detail lives in the app,
     where it is in front of you when you need it. */
  var SLIDES = [
    { icon: 'ti-building-store', title: 'Vendor Management', body:
      'Every vendor, subcontractor and supplier in one directory \u2014 who they are, what they supply, and whether they are accredited.' },
    { icon: 'ti-layout-grid', title: 'Three ways to look', body:
      '<b>Cards</b> to browse \u00b7 <b>Grid</b> to bulk-edit \u00b7 <b>Analytics</b> for spend.<br><br>Search matches the company, its trades <i>and</i> its products.' },
    { icon: 'ti-filter', title: 'The tiles are the filter', body:
      'Click <b>Accredited</b>, <b>Not accredited</b>, <b>Problematic</b> or <b>Requests to review</b> to narrow the list.' },
    { icon: 'ti-discount-check', title: 'Accreditation', body:
      'Staff-owned \u2014 a vendor can never set it about themselves.<br><br>It lasts <b>12 months</b>. The directory flags <b>Renewal due</b> and <b>Expired</b>.' },
    { icon: 'ti-alert-triangle', title: 'Problematic vendors', body:
      'Red border, reason shown, warning in every vendor picker.<br><br>Awarding to one <b>asks you to confirm first</b>.' },
    { icon: 'ti-clock-hour-4', title: 'Requests to review', body:
      'A vendor uploads their documents and asks to be accredited.<br><br>You see their checklist and files, then <b>Approve</b> or <b>Decline</b>. A decline needs a reason \u2014 they see it.' },
    { icon: 'ti-qrcode', title: 'Getting vendors in', body:
      '<b>Add Vendor</b> for one you have vetted.<br><br>Share the <b>Registration QR</b> \u2014 one link, every vendor. They self-identify; you confirm the match under <b>Vendor Registrations</b>.' },
    { icon: 'ti-category', title: 'Product categories', body:
      'Offerings file under <b>Trade \u2192 Works</b>, the same tree the WP form uses.<br><br>That is what makes <b>Suggest vendors</b> work on a work package.' },
    { icon: 'ti-tool', title: 'Data Tools', body:
      'Build the directory from work packages, <b>Merge</b> duplicates, <b>Split</b> garbled names, and curate the category tree.' },
    { icon: 'ti-list-check', title: 'Bulk actions', body:
      'Tick vendors \u2014 the selection survives paging and filtering.<br><br>Set accreditation, export an invite list, or delete. Delete is admin-only and backs up to CSV first.' },
    { icon: 'ti-id-badge-2', title: 'Inside a profile', body:
      'One page: contact, work packages with a <b>scorecard</b>, products, certifications, personnel, rates, bid history.<br><br><b>Change History</b> shows every edit and can undo it.' },
    { icon: 'ti-circle-check', title: 'That\u2019s it', body:
      'Reopen this any time from <b>?</b> in the top bar.<br><br>Start with <b>Requests to review</b>.' },
  ];

  var idx = 0, built = false, root = null;

  function injectCss() {
    if (document.getElementById('vg-css')) return;
    var s = document.createElement('style'); s.id = 'vg-css';
    s.textContent = [
      '.vg-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:4000;display:flex;align-items:center;justify-content:center;padding:20px}',
      '.vg-card{background:var(--surface,#fff);color:var(--text-primary,#231F20);width:100%;max-width:520px;border-radius:16px;box-shadow:0 24px 60px rgba(0,0,0,.3);display:flex;flex-direction:column;overflow:hidden}',
      /* Fixed height (not min-height) so every slide occupies the same
         vertical space — otherwise a taller (bulleted) slide pushes the
         footer down and the "Next" button jumps between clicks. Taller
         content scrolls inside the body instead. */
      /* height is a FALLBACK only — fitBody() measures the tallest slide and
         sets it. A fixed 260px was reserved so the Next button could not move
         between slides, but the deck was later rewritten to one short idea per
         slide, and the reservation became mostly empty space on every one. */
      '.vg-body{padding:26px 28px 6px;text-align:center;height:260px;overflow-y:auto}',
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

  /* ⚠️ KEEPS THE FOOTER STILL WITHOUT WASTING SPACE. Every slide has to occupy
     the same height or the Next button jumps as you page through — but that
     height should be the tallest slide's, not a number picked in advance.
     Measured by rendering each slide into the real body with height:auto and
     taking the largest scrollHeight, which only works once the card is laid
     out, so it runs from open() rather than build(). Re-run on resize because
     the text reflows at a different width. */
  var _fitW = 0;
  function fitBody() {
    if (!root) return;
    var body = root.querySelector('.vg-body');
    var title = root.querySelector('.vg-title');
    var text = root.querySelector('.vg-text');
    if (!body || !title || !text) return;
    var keepT = title.textContent, keepH = text.innerHTML;
    body.style.height = 'auto';
    var max = 0;
    for (var i = 0; i < SLIDES.length; i++) {
      title.textContent = SLIDES[i].title;
      text.innerHTML = SLIDES[i].body;
      if (body.scrollHeight > max) max = body.scrollHeight;
    }
    title.textContent = keepT;
    text.innerHTML = keepH;
    if (max > 0) body.style.height = max + 'px';
    _fitW = window.innerWidth;
  }
  function go(n) { if (n < 0 || n >= SLIDES.length) return; idx = n; render(); }
  function open(n) {
    if (!built) build();
    idx = n || 0;
    render();
    root.style.display = 'flex';
    fitBody();                       // needs the card laid out, so after display
  }
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

  window.addEventListener('resize', function () {
    if (root && root.style.display !== 'none' && window.innerWidth !== _fitW) fitBody();
  });

  window.VendorGuide = { open: open, close: close, maybeAutoOpen: maybeAutoOpen, _go: go };
})();
