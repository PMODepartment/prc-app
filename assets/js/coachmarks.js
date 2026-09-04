/* ─────────────────────────────────────────────────────────────────────────────
 * Coach-mark spotlight tour — window.CoachTour
 * A lightweight, dependency-free interactive tour that dims the screen and
 * spotlights REAL UI elements on the current page, with a tooltip card that
 * walks the user step-by-step. Self-contained: injects its own CSS, follows
 * dark mode via the app's CSS vars.
 *
 * Public API:
 *   CoachTour.configure({ key, steps })   // steps: [{ sel, title, body, before?, pad? }]
 *   CoachTour.start(force)                 // run now (force ignores the "seen" flag)
 *   CoachTour.maybeAutoStart()            // run once per user (localStorage), ~800ms after load
 *   CoachTour.available()                 // true if steps are configured for this page
 *
 * A step's `sel` is a CSS selector; steps whose element is missing/hidden are
 * skipped. `before()` runs first (e.g. switch tabs to reveal the target).
 * ───────────────────────────────────────────────────────────────────────────── */
(function () {
  var _steps = [], _key = 'coach', _i = 0, _dir = 1, _open = false;
  var _overlay = null, _spot = null, _card = null;

  function uid() { return (window.__profile && window.__profile.id) || 'anon'; }
  function seenKey() { return 'wpm_' + _key + '_' + uid(); }

  function injectCSS() {
    if (document.getElementById('ct-css')) return;
    var s = document.createElement('style');
    s.id = 'ct-css';
    s.textContent =
      '.ct-spot{position:fixed;border-radius:10px;box-shadow:0 0 0 9999px rgba(15,16,22,.60);border:2px solid #EE3124;z-index:100000;pointer-events:none;transition:all .22s ease}' +
      '.ct-card{position:fixed;z-index:100001;width:300px;max-width:calc(100vw - 24px);background:var(--surface,#fff);color:var(--text-primary,#231F20);border-radius:12px;box-shadow:0 14px 44px rgba(0,0,0,.30);padding:16px 18px 14px;font-family:Montserrat,system-ui,sans-serif;transition:top .22s ease,left .22s ease}' +
      '.ct-card h4{margin:0 6px 6px 0;font-size:14px;font-weight:700;color:#EE3124}' +
      '.ct-card p{margin:0;font-size:12.5px;line-height:1.55;color:var(--text-secondary,#555)}' +
      '.ct-row{display:flex;align-items:center;justify-content:space-between;margin-top:14px;gap:8px}' +
      '.ct-dots{font-size:11px;color:#9aa;font-weight:700;letter-spacing:.02em}' +
      '.ct-btns{display:flex;gap:6px}' +
      '.ct-btn{font-size:12px;font-weight:600;font-family:inherit;border-radius:7px;padding:6px 13px;cursor:pointer;border:1.5px solid var(--border-md,#e5e5e5);background:var(--surface-2,#f5f5f5);color:var(--text-primary,#333)}' +
      '.ct-btn:disabled{opacity:.45;cursor:default}' +
      '.ct-btn.p{background:#EE3124;color:#fff;border-color:#EE3124;min-width:74px}' +
      '.ct-skip{position:absolute;top:9px;right:12px;border:none;background:none;font-size:17px;color:#aaa;cursor:pointer;line-height:1;padding:0}' +
      /* ⚠️ ON A PHONE THE CARD IS A BOTTOM SHEET, NOT A CORNER BOX. A 300px
         card pinned bottom-right covers most of a 390px screen, so it would
         sit on top of the very thing it is pointing at, and the flip-to-top
         fallback then covers the target instead. Full width along the bottom
         leaves the whole upper screen free for the spotlight, and render()
         scrolls the target up into it.
         ⚠️ !important because reposition() writes inline top/left for the
         desktop layout, and an inline style beats a class rule. JS skips its
         positioning entirely at this width — the two must not fight. */
      '@media(max-width:600px){' +
        '.ct-card{left:0 !important;right:0 !important;top:auto !important;bottom:0;' +
          'width:auto !important;max-width:none;border-radius:16px 16px 0 0;' +
          'padding:15px 18px calc(15px + env(safe-area-inset-bottom,0px));' +
          'box-shadow:0 -10px 30px rgba(0,0,0,.28)}' +
        '.ct-card p{font-size:13.5px}' +
        '.ct-row{margin-top:12px}' +
        '.ct-btn{padding:10px 18px;font-size:13px;min-height:42px}' +
        '.ct-skip{top:11px;right:13px;font-size:22px;padding:4px}' +
      '}';
    document.head.appendChild(s);
  }

  function mob() { try { return window.matchMedia('(max-width:600px)').matches; }
                   catch (e) { return window.innerWidth <= 600; } }
  function el(step) { try { return step && step.sel ? document.querySelector(step.sel) : null; } catch (e) { return null; } }
  /* ⚠️ offsetParent AND A WIDTH ARE NOT ENOUGH. A phone sidebar is a drawer
     held off-screen with translateX(-100%) — it still reports an offsetParent
     and a full width, so the old test called it visible and the spotlight was
     drawn clamped at the screen edge, ringing whatever happened to be there.
     A target that lies outside the viewport cannot be pointed at. */
  function visible(e) {
    if (!e || e.offsetParent === null) return false;
    var r = e.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return false;
    if (r.right <= 0 || r.left >= window.innerWidth) return false;   // off to the side
    return true;
  }
  /* ⚠️ THE "x of n" SET IS FROZEN AT start(), AND MUST BE.
     Anything measured per render is unstable, because the tour itself hides and
     shows panels as it walks: a layout-based count produced "Step 4 of 5"
     followed by "Step 2 of 4" — a total that moved and a position that went
     BACKWARDS. Existence in the DOM plus when() are the only two facts that
     hold still for the whole run, so those are what it counts. */
  var _live = [];
  function computeLive() {
    _live = [];
    for (var q = 0; q < _steps.length; q++) {
      if (allowed(_steps[q]) && el(_steps[q])) _live.push(q);
    }
  }
  function posOf(i) {
    var at = _live.indexOf(i);
    if (at >= 0) return at;
    var n = 0;                       // not in the set: count what precedes it
    for (var q = 0; q < _live.length; q++) if (_live[q] < i) n++;
    return n;
  }
  /* An optional per-step predicate, evaluated when the tour RUNS rather than
     when it was configured — so a step can depend on the viewport without
     freezing that decision at configure time. */
  function allowed(st) {
    if (!st || !st.when) return true;
    try { return !!st.when(); } catch (e) { return false; }
  }

  function build() {
    injectCSS();
    _spot = document.createElement('div'); _spot.className = 'ct-spot';
    _card = document.createElement('div'); _card.className = 'ct-card';
    document.body.appendChild(_spot); document.body.appendChild(_card);
    window.addEventListener('resize', reposition, true);
    window.addEventListener('scroll', reposition, true);
    document.addEventListener('keydown', onKey, true);
  }
  function teardown() {
    _open = false;
    window.removeEventListener('resize', reposition, true);
    window.removeEventListener('scroll', reposition, true);
    document.removeEventListener('keydown', onKey, true);
    [_spot, _card].forEach(function (n) { if (n && n.parentNode) n.parentNode.removeChild(n); });
    _spot = _card = null;
  }
  function onKey(e) {
    if (!_open) return;
    if (e.key === 'Escape') { e.preventDefault(); finish(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
  }

  // Advance from _i in direction _dir to the next step whose element is visible.
  function nextResolvable(start, dir) {
    var i = start;
    while (i >= 0 && i < _steps.length) {
      var st = _steps[i];
      // when() is checked BEFORE before(), so a step ruled out by the viewport
      // never runs its side effects (switching a tab the user will not see).
      if (allowed(st)) {
        if (st.before) { try { st.before(); } catch (e) {} }
        if (visible(el(st))) return i;
      }
      i += dir;
    }
    return -1;
  }

  var _cur = null;
  function render() {
    if (!_open) return;
    var st = _steps[_i]; _cur = st;
    var target = el(st);
    if (!visible(target)) { finish(); return; }
    /* Centring works on a desktop, where the card is in a corner. With a
       bottom sheet the centre is behind it, so aim for the upper third and let
       the sheet have the rest. Done HERE, once per step — never in
       reposition(), which is wired to scroll and would chase itself. */
    try {
      if (mob()) {
        var want = Math.max(70, Math.round(window.innerHeight * 0.16));
        var dy = target.getBoundingClientRect().top - want;
        if (Math.abs(dy) > 24) window.scrollBy({ top: dy, behavior: 'smooth' });
      } else {
        target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        /* ⚠️ Then lift it clear of the fixed card slot, by scrolling the PAGE.
           Centring alone puts a low target right under the bottom-right card,
           which is what used to make the card flip to the top and the Next
           button jump. Moving the page instead keeps the card perfectly still. */
        var ch2 = _card.offsetHeight || 160, cw2 = _card.offsetWidth || 300, m2 = 16;
        var slotTop = window.innerHeight - ch2 - m2, slotLeft = window.innerWidth - cw2 - m2;
        setTimeout(function () {
          var rr = target.getBoundingClientRect();
          if (rr.bottom > slotTop - 12 && rr.right > slotLeft - 12) {
            var lift = rr.bottom - (slotTop - 12);
            // A target taller than the space above the slot cannot be fully
            // cleared; put its TOP near the top of the screen and show as much
            // of it as there is room for.
            var maxLift = rr.top - 80;
            window.scrollBy({ top: Math.min(lift, Math.max(0, maxLift)), behavior: 'smooth' });
          }
        }, 240);
      }
    } catch (e) {}
    /* "x of n" counted over the steps that CAN show, not _steps.length — which
       was the old behaviour and over-promised whenever a step was skipped.
       Counted WITHOUT running before(), so counting cannot switch tabs. */
    var pos = posOf(_i);
    var total = _live.length || _steps.length;
    var isLast = pos >= total - 1;
    _card.innerHTML =
      '<button class="ct-skip" title="Close tour" aria-label="Close">&times;</button>' +
      '<h4>' + esc(st.title || '') + '</h4>' +
      '<p>' + (st.body || '') + '</p>' +
      '<div class="ct-row"><span class="ct-dots">Step ' + (pos + 1) + ' of ' + total + '</span>' +
      '<span class="ct-btns">' +
      '<button class="ct-btn" data-a="prev"' + (pos === 0 ? ' disabled' : '') + '>Back</button>' +
      '<button class="ct-btn p" data-a="next">' + (isLast ? 'Done' : 'Next') + '</button>' +
      '</span></div>';
    _card.querySelector('.ct-skip').onclick = finish;
    _card.querySelector('[data-a="prev"]').onclick = function () { go(-1); };
    _card.querySelector('[data-a="next"]').onclick = function () { isLast ? finish() : go(1); };
    setTimeout(reposition, 60);
  }

  function reposition() {
    if (!_open || !_cur || !_spot || !_card) return;
    var target = el(_cur); if (!visible(target)) return;
    var r = target.getBoundingClientRect(), pad = (_cur.pad != null ? _cur.pad : 8);
    var top = Math.max(6, r.top - pad), left = Math.max(6, r.left - pad);
    var w = Math.min(r.width + pad * 2, window.innerWidth - left - 6);
    var h = r.height + pad * 2;
    _spot.style.top = top + 'px'; _spot.style.left = left + 'px';
    _spot.style.width = w + 'px'; _spot.style.height = h + 'px';
    // On a phone the sheet is owned by CSS (see the media query above); clear
    // anything the desktop branch wrote so the two cannot fight.
    if (mob()) {
      _card.style.top = ''; _card.style.left = ''; _card.style.width = '';
      return;
    }
    /* ⚠️ THE CARD NEVER MOVES. It is pinned bottom-right and STAYS there for
       every step, because the whole point is that Back/Next sit still — a user
       should not have to hunt for the button they just pressed.
       It used to flip to the top whenever the spotlight reached the bottom-right
       slot, which was reported as exactly that irritation: Next jumping from the
       bottom of the screen to the top between steps. The collision is now solved
       by moving the PAGE (see render()), never the card. */
    var ch = _card.offsetHeight || 160, cw = _card.offsetWidth || 300, m = 16;
    _card.style.top = Math.max(6, window.innerHeight - ch - m) + 'px';
    _card.style.left = Math.max(6, window.innerWidth - cw - m) + 'px';
  }

  function go(dir) {
    _dir = dir;
    var nxt = nextResolvable(_i + dir, dir);
    if (nxt < 0) { finish(); return; }
    _i = nxt; render();
  }
  function finish() {
    if (!_open) return;
    try { localStorage.setItem(seenKey(), '1'); } catch (e) {}
    teardown();
  }

  function start(force) {
    if (_open || !_steps.length) return;
    if (!force) { try { if (localStorage.getItem(seenKey())) return; } catch (e) {} }
    _open = true; _i = 0; _dir = 1; build();
    computeLive();                   // once, before anything is switched about
    var first = nextResolvable(0, 1);
    if (first < 0) { teardown(); return; }   // nothing to show
    _i = first; render();
  }

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  window.CoachTour = {
    configure: function (cfg) { cfg = cfg || {}; _key = cfg.key || 'coach'; _steps = (cfg.steps || []).filter(Boolean); },
    start: function (force) { start(force !== false); },
    maybeAutoStart: function () { setTimeout(function () { start(false); }, 800); },
    available: function () { return _steps.length > 0; }
  };
})();
