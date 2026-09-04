/* ============================================================================
 * Vendor Portal guide — self-contained slide deck for vendor-portal.html.
 *
 * ⚠️ FULLY SELF-CONTAINED, and that is not a style choice. This page loads
 *    neither ui.js nor dashboard.css, so there is no AppTheme, no shared modal
 *    and no shared button. Everything here — CSS, DOM, the "?" button — is
 *    injected by this file.
 *
 * ⚠️ Written for the VENDOR, not for Megawide. No internal vocabulary: no
 *    "work package", no "BCB", no role names. What they have to do, in the
 *    order they have to do it.
 *
 * ⚠️ Rules are scoped to html.dark-mode, NOT body.dark-mode — that class is
 *    never set on this page (see the portal's own theme block).
 *
 *   window.PortalGuide.open() / .maybeAutoOpen(vendorId)
 * ========================================================================== */
(function () {
  var SLIDES = [
    { icon: 'ti-hand-wave', title: 'Welcome', body:
      'This is where you keep your company details current and answer Megawide\u2019s requests for quotation.<br><br>Two places: <b>Company Profile</b> and <b>Bid Board</b>.' },
    { icon: 'ti-building', title: 'Company Profile', body:
      'Your contact details, what you supply, your people and your documents.<br><br>Megawide procurement works from what is here \u2014 if it is out of date, so are they.' },
    { icon: 'ti-users', title: 'People go in Personnel', body:
      'Add each person once under <b>Personnel</b>, then tick <b>Primary contact</b> or <b>Owner</b>.<br><br>Those boxes on Company Information fill in from there \u2014 that is why they are not typed directly.' },
    { icon: 'ti-package', title: 'Products / Services', body:
      'List what you actually supply, with a category and a photo where you have one.<br><br>This is how buyers find you when they are looking for what you sell.' },
    { icon: 'ti-rosette-discount-check', title: 'Accreditation', body:
      'The <b>Accreditation</b> tab shows exactly what is still missing.<br><br>Upload the four documents, fill the gaps, and the <b>Request accreditation</b> button turns on.' },
    { icon: 'ti-clipboard-list', title: 'Bid Board', body:
      'Packages Megawide has invited you to quote. You only see the ones addressed to you.<br><br>The <b>reference pack</b> on each one is what to price against \u2014 read it before you quote.' },
    { icon: 'ti-file-invoice', title: 'Answering a bid', body:
      'Enter your amount, lead time and how long the price holds, then attach your quotation.<br><br>You can revise it any time before the deadline.' },
    { icon: 'ti-message-2', title: 'Questions', body:
      'If Megawide asks you something about your bid, it appears with your invitation and you answer there.<br><br>Everything stays on the record, so nothing is lost in an inbox.' },
    { icon: 'ti-device-mobile', title: 'Put it on your phone', body:
      'Use <b>Add to home screen</b> in the side panel and the portal opens like an app, with a badge showing bids still waiting on you.<br><br>On iPhone: Share \u2192 Add to Home Screen.' },
    { icon: 'ti-circle-check', title: 'That\u2019s it', body:
      'Reopen this any time from <b>?</b> in the top bar.<br><br>Start by completing your <b>Accreditation</b> checklist.' },
  ];

  var idx = 0, built = false, root = null;

  function injectCss() {
    if (document.getElementById('pg-css')) return;
    var s = document.createElement('style'); s.id = 'pg-css';
    s.textContent = [
      '.pg-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:4000;display:flex;align-items:center;justify-content:center;padding:20px}',
      '.pg-card{background:var(--surface,#fff);color:var(--text-primary,#231F20);width:100%;max-width:520px;border-radius:16px;box-shadow:0 24px 60px rgba(0,0,0,.3);display:flex;flex-direction:column;overflow:hidden}',
      /* Fixed height, not min-height: a taller slide would otherwise push the
         footer down and the Next button would move between clicks. */
      '.pg-body{padding:30px 30px 8px;text-align:center;height:250px;overflow-y:auto}',
      '.pg-ic{width:60px;height:60px;border-radius:15px;background:var(--mw-red-light,#FDECEA);color:var(--mw-red,#EE3124);display:flex;align-items:center;justify-content:center;margin:0 auto 16px}',
      '.pg-ic i{font-size:30px}',
      '.pg-title{font-size:20px;font-weight:800;margin-bottom:10px}',
      '.pg-text{font-size:14px;line-height:1.6;color:var(--text-secondary,#5A5858)}',
      '.pg-foot{display:flex;align-items:center;gap:12px;padding:14px 20px 20px}',
      '.pg-dots{display:flex;gap:6px;flex:1;justify-content:center}',
      '.pg-dot{width:8px;height:8px;border-radius:50%;background:var(--border-md,rgba(0,0,0,.16));cursor:pointer;border:0;padding:0}',
      '.pg-dot.on{background:var(--mw-red,#EE3124)}',
      '.pg-btn{padding:9px 18px;border-radius:9px;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer;border:1px solid var(--border-md,rgba(0,0,0,.16));background:transparent;color:var(--text-primary,#231F20)}',
      '.pg-btn.primary{background:var(--mw-red,#EE3124);border-color:var(--mw-red,#EE3124);color:#fff}',
      '.pg-btn:disabled{opacity:.4;cursor:default}',
      '.pg-x{position:absolute;top:14px;right:16px;background:none;border:0;font-size:22px;line-height:1;cursor:pointer;color:var(--text-hint,#6E6C6C)}',
      '.pg-head{position:relative}',
      '.btn-guide-p{background:transparent;border:1px solid rgba(255,255,255,.35);color:#fff;width:34px;height:34px;border-radius:9px;cursor:pointer;font-size:16px;font-weight:700;line-height:1}',
      '.btn-guide-p:hover{background:rgba(255,255,255,.12)}',
      '.pg-menu{display:none;position:absolute;top:calc(100% + 8px);right:0;z-index:4100;width:262px;background:var(--surface,#fff);border:1px solid var(--border-md,rgba(0,0,0,.16));border-radius:11px;box-shadow:0 14px 40px rgba(0,0,0,.24);overflow:hidden}',
      '.pg-menu.show{display:block}',
      '.pg-mi{display:flex;align-items:flex-start;gap:10px;width:100%;text-align:left;background:none;border:0;padding:11px 13px;font-family:inherit;cursor:pointer;color:var(--text-primary,#231F20)}',
      '.pg-mi+.pg-mi{border-top:1px solid var(--border,rgba(0,0,0,.08))}',
      '.pg-mi:hover{background:var(--mw-red-light,#FDECEA)}',
      '.pg-mi i{font-size:17px;color:var(--mw-red,#EE3124);margin-top:1px}',
      '.pg-mi b{display:block;font-size:13px;font-weight:700}',
      '.pg-mi em{display:block;font-size:11.5px;font-style:normal;color:var(--text-hint,#6E6C6C);line-height:1.4;margin-top:1px}',
      /* ⚠️ A phone gets the deck as a BOTTOM SHEET filling the lower screen,
         not a 250px scrolling box floating in the middle — that box was the
         "just a pop-up with text" complaint. The body grows with the sheet, so
         a slide reads as a page instead of a peephole; the footer is pinned so
         Next still never moves between slides. */
      '@media(max-width:600px){' +
        '.pg-overlay{padding:0;align-items:flex-end}' +
        '.pg-card{max-width:none;border-radius:18px 18px 0 0;height:82vh}' +
        '.pg-body{flex:1;height:auto;padding:26px 22px 8px}' +
        '.pg-ic{width:52px;height:52px;border-radius:14px;margin-bottom:14px}' +
        '.pg-ic i{font-size:26px}' +
        '.pg-title{font-size:19px}' +
        '.pg-text{font-size:14.5px;line-height:1.65}' +
        '.pg-foot{padding:12px 18px calc(18px + env(safe-area-inset-bottom,0px))}' +
        '.pg-btn{padding:11px 18px;min-height:44px}' +
        '.pg-menu{position:fixed;top:auto;bottom:0;left:0;right:0;width:auto;border-radius:16px 16px 0 0;border-left:0;border-right:0;border-bottom:0}' +
        '.pg-mi{padding:15px 18px}' +
      '}',
    ].join('\n');
    document.head.appendChild(s);
  }

  function build() {
    if (built) return;
    injectCss();
    root = document.createElement('div');
    root.className = 'pg-overlay';
    root.style.display = 'none';
    root.innerHTML =
      '<div class="pg-card"><div class="pg-head">'
      + '<button class="pg-x" aria-label="Close">&times;</button>'
      + '<div class="pg-body"><div class="pg-ic"><i></i></div>'
      + '<div class="pg-title"></div><div class="pg-text"></div></div></div>'
      + '<div class="pg-foot">'
      + '<button class="pg-btn" data-act="back">Back</button>'
      + '<div class="pg-dots"></div>'
      + '<button class="pg-btn primary" data-act="next">Next</button>'
      + '</div></div>';
    document.body.appendChild(root);
    root.querySelector('.pg-x').onclick = close;
    root.querySelector('[data-act="back"]').onclick = function () { go(idx - 1); };
    root.querySelector('[data-act="next"]').onclick = function () {
      if (idx >= SLIDES.length - 1) close(); else go(idx + 1);
    };
    root.addEventListener('click', function (e) { if (e.target === root) close(); });
    built = true;
  }

  function go(n) {
    if (n < 0 || n >= SLIDES.length) return;
    idx = n;
    var s = SLIDES[idx];
    root.querySelector('.pg-ic i').className = 'ti ' + s.icon;
    root.querySelector('.pg-title').textContent = s.title;
    root.querySelector('.pg-text').innerHTML = s.body;
    root.querySelector('[data-act="back"]').disabled = idx === 0;
    root.querySelector('[data-act="next"]').textContent =
      idx >= SLIDES.length - 1 ? 'Done' : 'Next';
    var dots = root.querySelector('.pg-dots');
    dots.innerHTML = SLIDES.map(function (_, i) {
      return '<button class="pg-dot' + (i === idx ? ' on' : '') + '" data-i="' + i
        + '" aria-label="Slide ' + (i + 1) + '"></button>';
    }).join('');
    Array.prototype.forEach.call(dots.children, function (d) {
      d.onclick = function () { go(parseInt(d.dataset.i, 10)); };
    });
    root.querySelector('.pg-body').scrollTop = 0;
  }

  function onKey(e) {
    if (!root || root.style.display === 'none') return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') go(idx + 1);
    else if (e.key === 'ArrowLeft') go(idx - 1);
  }

  function open() {
    build();
    root.style.display = 'flex';
    go(0);
    document.addEventListener('keydown', onKey);
  }
  function close() {
    if (!root) return;
    root.style.display = 'none';
    document.removeEventListener('keydown', onKey);
  }

  /* Once per vendor. ⚠️ Every localStorage touch is wrapped: it throws outright
     in an opaque origin, and a guide must never be what breaks the portal. */
  function seenKey(id) { return 'wpm_portalguide_' + (id || 'x'); }
  function maybeAutoOpen(vendorId) {
    var seen = false;
    try { seen = localStorage.getItem(seenKey(vendorId)) === '1'; } catch (e) {}
    if (seen) return;
    try { localStorage.setItem(seenKey(vendorId), '1'); } catch (e) {}
    setTimeout(open, 900);
  }

  /* The "?" button, injected into the topbar before the theme toggle so it sits
     with the other chrome. Idempotent — nothing else on this page adds one. */
  function injectButton() {
    injectCss();
    if (document.getElementById('btn-portal-guide')) return;
    var bar = document.querySelector('.topbar-right') || document.querySelector('.topbar');
    if (!bar) return;
    var b = document.createElement('button');
    b.id = 'btn-portal-guide';
    b.className = 'btn-guide-p';
    b.type = 'button';
    b.title = 'How this portal works';
    b.setAttribute('aria-label', 'How this portal works');
    b.textContent = '?';
    b.onclick = toggleMenu;
    var wrap = document.createElement('div');
    wrap.style.position = 'relative';
    wrap.appendChild(b);
    var before = document.getElementById('portalThemeToggle') || bar.firstChild;
    bar.insertBefore(wrap, before);
    var m = document.createElement('div');
    m.id = 'pg-menu';
    m.className = 'pg-menu';
    wrap.appendChild(m);
  }

  /* ⚠️ BUILT ON EVERY OPEN, not once at inject time. coachmarks.js loads before
     this file but configurePortalTour() runs on a delay after the vendor's data
     lands, so at inject time CoachTour.available() is still false and the tour
     item would be permanently missing. */
  function toggleMenu(e) {
    if (e) e.stopPropagation();
    var m = document.getElementById('pg-menu');
    if (!m) { open(); return; }
    if (m.classList.contains('show')) { closeMenu(); return; }
    var items = '';
    if (window.CoachTour && CoachTour.available()) {
      items += '<button class="pg-mi" data-a="tour"><i class="ti ti-route"></i>'
             + '<span><b>Show me around</b><em>Points at the real thing, one step at a time</em></span></button>';
    }
    items += '<button class="pg-mi" data-a="guide"><i class="ti ti-book"></i>'
           + '<span><b>Read the guide</b><em>The whole portal, start to finish</em></span></button>';
    m.innerHTML = items;
    m.querySelectorAll('.pg-mi').forEach(function (btn) {
      btn.onclick = function () {
        var a = btn.getAttribute('data-a');
        closeMenu();
        if (a === 'tour' && window.CoachTour) CoachTour.start(true);
        else open();
      };
    });
    m.classList.add('show');
    setTimeout(function () { document.addEventListener('click', outside, true); }, 0);
  }
  function closeMenu() {
    var m = document.getElementById('pg-menu');
    if (m) m.classList.remove('show');
    document.removeEventListener('click', outside, true);
  }
  function outside(e) {
    var m = document.getElementById('pg-menu');
    if (m && !m.contains(e.target) && e.target.id !== 'btn-portal-guide') closeMenu();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectButton);
  } else {
    injectButton();
  }

  window.PortalGuide = { open: open, close: close, maybeAutoOpen: maybeAutoOpen };
})();
