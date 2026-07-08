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
      '.ct-btn.p{background:#EE3124;color:#fff;border-color:#EE3124}' +
      '.ct-skip{position:absolute;top:9px;right:12px;border:none;background:none;font-size:17px;color:#aaa;cursor:pointer;line-height:1;padding:0}';
    document.head.appendChild(s);
  }

  function el(step) { try { return step && step.sel ? document.querySelector(step.sel) : null; } catch (e) { return null; } }
  function visible(e) { return e && e.offsetParent !== null && e.getBoundingClientRect().width > 1; }

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
      if (st.before) { try { st.before(); } catch (e) {} }
      if (visible(el(st))) return i;
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
    try { target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' }); } catch (e) {}
    // total = count of steps that currently resolve, for a stable "x of n"
    _card.innerHTML =
      '<button class="ct-skip" title="Close tour" aria-label="Close">&times;</button>' +
      '<h4>' + esc(st.title || '') + '</h4>' +
      '<p>' + (st.body || '') + '</p>' +
      '<div class="ct-row"><span class="ct-dots">Step ' + (_i + 1) + ' of ' + _steps.length + '</span>' +
      '<span class="ct-btns">' +
      '<button class="ct-btn" data-a="prev"' + (_i === 0 ? ' disabled' : '') + '>Back</button>' +
      '<button class="ct-btn p" data-a="next">' + (_i >= _steps.length - 1 ? 'Done' : 'Next') + '</button>' +
      '</span></div>';
    _card.querySelector('.ct-skip').onclick = finish;
    _card.querySelector('[data-a="prev"]').onclick = function () { go(-1); };
    _card.querySelector('[data-a="next"]').onclick = function () { _i >= _steps.length - 1 ? finish() : go(1); };
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
    // Place the card below the spot if it fits, else above.
    var ch = _card.offsetHeight || 160, cw = _card.offsetWidth || 300, gap = 12;
    var cTop = (top + h + gap + ch < window.innerHeight) ? (top + h + gap)
             : (top - gap - ch > 6 ? top - gap - ch : Math.max(6, window.innerHeight - ch - 6));
    var cLeft = Math.min(Math.max(6, left), window.innerWidth - cw - 6);
    _card.style.top = cTop + 'px'; _card.style.left = cLeft + 'px';
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
