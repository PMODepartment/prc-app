/* ============================================================================
 * Patch Notice — one-off "What's New" announcement, Aug 11 – Aug 25 2026 update
 * ----------------------------------------------------------------------------
 * TEMPORARY component. Auto-shows once to contributor-tier accounts
 * (specialist / manager / user) AND admin / super_admin — never viewer/
 * viewer_budget, never vendor (vendor logins never load this page at all).
 *
 * This round is deliberately NARROW: co-awarded vendors, No-Cost Awards,
 * per-trade subtotals / Balance to Award, and the buyback exact-amount mode.
 *
 * DELIBERATELY NOT ANNOUNCED YET (2026-08-25, user's call) -- both are built and
 * live, they are just not being put in front of officers in this round:
 *   - Vendor Management (accreditation standing, the at-award guardrail, the
 *     directory itself). That app still needs work.
 *   - The Planners need-by dates (WP-form advisory panel + WP List columns).
 * When either is ready to announce, add it back as an item here.
 *
 * Hard-expires 2026-09-03 00:00 — both maybeAutoOpen() and open() refuse to
 * render past that instant, so no leftover code path (a stale localStorage
 * miss, a manual call, a slow tab) can show this late. Once that date has
 * passed this file and its <script> include on index.html/project.html can
 * simply be deleted — see CLAUDE.md.
 *
 * SEEN_PREFIX is bumped every round, so a user who dismissed the previous
 * notice still sees this one.
 *
 * Self-contained: injects its own styles, no dependencies beyond Tabler
 * icons (already loaded) + the CSS variables in dashboard.css, so it follows
 * light/dark mode automatically, same pattern as onboarding.js/coachmarks.js.
 *
 * Public API (window.PatchNotice):
 *   PatchNotice.maybeAutoOpen(userId, role) — open once per contributor user
 *   PatchNotice.open()                      — on demand (profile menu item)
 * ========================================================================== */
(function () {
  'use strict';

  var SEEN_PREFIX = 'wpm_patch_202608c_seen_';
  var EXPIRES = new Date('2026-09-03T00:00:00');   // hard cutoff (exclusive)

  function isContributor(role) {
    return role === 'specialist' || role === 'manager' || role === 'user' ||
      role === 'admin' || role === 'super_admin';
  }

  function injectCss() {
    if (document.getElementById('pn-css')) return;
    var s = document.createElement('style');
    s.id = 'pn-css';
    s.textContent = [
      '.pn-overlay{position:fixed;inset:0;z-index:9000;background:rgba(20,18,18,.55);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;padding:20px;opacity:0;transition:opacity .18s}',
      '.pn-overlay.show{opacity:1}',
      '.pn-modal{position:relative;background:var(--surface,#fff);color:var(--text-primary,#231F20);width:100%;max-width:540px;max-height:88vh;border-radius:16px;box-shadow:0 24px 60px rgba(0,0,0,.35);display:flex;flex-direction:column;overflow:hidden;transform:translateY(12px);transition:transform .18s;font-family:Montserrat,system-ui,sans-serif}',
      '.pn-overlay.show .pn-modal{transform:none}',
      '.pn-top{padding:22px 26px 18px;border-bottom:1px solid var(--border,rgba(0,0,0,.08));display:flex;align-items:flex-start;gap:14px}',
      '.pn-badge{flex:0 0 auto;width:40px;height:40px;border-radius:10px;background:var(--mw-red,#EE3124);color:#fff;display:flex;align-items:center;justify-content:center;font-size:19px}',
      '.pn-top-text{flex:1;min-width:0}',
      '.pn-eyebrow{display:flex;align-items:center;gap:8px;margin-bottom:6px}',
      '.pn-eyebrow span:first-child{font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--mw-red,#EE3124)}',
      '.pn-dot{width:3px;height:3px;border-radius:50%;background:var(--text-hint,#9B9999)}',
      '.pn-range{font-size:11px;color:var(--text-hint,#9B9999);font-weight:600;letter-spacing:.02em}',
      '.pn-modal h2{margin:0;font-size:18px;font-weight:800;letter-spacing:-.2px;line-height:1.3}',
      '.pn-lede{margin:5px 0 0;font-size:13px;color:var(--text-secondary,#5A5858);line-height:1.5}',
      '.pn-x{position:absolute;top:14px;right:14px;background:transparent;border:none;color:var(--text-hint,#9B9999);width:28px;height:28px;border-radius:8px;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .12s,color .12s}',
      '.pn-x:hover{background:var(--surface-2,#f0f0f0);color:var(--text-primary,#231F20)}',
      '.pn-x:focus-visible{outline:2px solid var(--mw-red,#EE3124);outline-offset:1px}',
      '.pn-body{padding:20px 26px 6px;overflow-y:auto;flex:1;min-height:0}',
      '.pn-feature{display:flex;gap:14px;padding:16px 16px 16px 18px;border-radius:10px;background:var(--surface-2,#f7f5f3);border:1px solid var(--border,rgba(0,0,0,.08));border-left:4px solid var(--mw-red,#EE3124);margin-bottom:16px}',
      '.pn-feature-icon{flex:0 0 auto;width:34px;height:34px;border-radius:9px;background:var(--mw-red,#EE3124);color:#fff;display:flex;align-items:center;justify-content:center;font-size:17px}',
      '.pn-feature-title{margin:0 0 3px;font-size:14.5px;font-weight:700;color:var(--text-primary,#231F20);display:flex;align-items:center;gap:7px;flex-wrap:wrap}',
      '.pn-new{font-size:9.5px;font-weight:800;letter-spacing:.06em;color:#fff;background:var(--mw-red,#EE3124);padding:2px 6px;border-radius:5px;text-transform:uppercase}',
      '.pn-feature-copy{margin:0;font-size:13px;color:var(--text-secondary,#5A5858);line-height:1.55}',
      '.pn-feature-copy b{color:var(--text-primary,#231F20);font-weight:600}',
      '.pn-section-label{font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--text-hint,#9B9999);margin:4px 0 10px}',
      '.pn-item{display:flex;gap:12px;padding:11px 2px;border-bottom:1px solid var(--border,rgba(0,0,0,.08))}',
      '.pn-item:last-child{border-bottom:none}',
      '.pn-item-icon{flex:0 0 auto;width:26px;height:26px;border-radius:7px;margin-top:1px;display:flex;align-items:center;justify-content:center;background:var(--surface-2,#f0f0f0);color:var(--text-secondary,#5A5858);font-size:14px}',
      '.pn-item-title{margin:0 0 2px;font-size:13.5px;font-weight:600;color:var(--text-primary,#231F20)}',
      '.pn-item-copy{margin:0;font-size:12.5px;color:var(--text-secondary,#5A5858);line-height:1.5}',
      '.pn-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 26px 22px;flex-shrink:0}',
      '.pn-foot-note{font-size:11.5px;color:var(--text-hint,#9B9999);line-height:1.4;max-width:260px}',
      '.pn-btn{flex:0 0 auto;border:none;cursor:pointer;font-family:inherit;font-size:13.5px;font-weight:700;letter-spacing:.01em;padding:10px 20px;border-radius:9px;background:var(--mw-red,#EE3124);color:#fff;transition:filter .12s}',
      '.pn-btn:hover{filter:brightness(1.06)}',
      '.pn-btn:focus-visible{outline:2px solid var(--mw-red,#EE3124);outline-offset:2px}'
    ].join('');
    document.head.appendChild(s);
  }

  function markSeen() {
    try { if (window.__pnUserId) localStorage.setItem(SEEN_PREFIX + window.__pnUserId, '1'); } catch (_) {}
  }

  function close() {
    var ov = document.getElementById('pn-overlay');
    if (!ov) return;
    ov.classList.remove('show');
    document.removeEventListener('keydown', onKey);
    setTimeout(function () { if (ov.parentNode) ov.parentNode.removeChild(ov); }, 200);
  }

  function dismiss() { markSeen(); close(); }

  function onKey(e) { if (e.key === 'Escape') dismiss(); }

  function open() {
    if (new Date() >= EXPIRES) return;              // hard cutoff — never render past this
    if (document.getElementById('pn-overlay')) return;
    injectCss();

    var ov = document.createElement('div');
    ov.id = 'pn-overlay';
    ov.className = 'pn-overlay';
    ov.innerHTML =
      '<div class="pn-modal" role="dialog" aria-modal="true" aria-labelledby="pn-title">' +
        '<button class="pn-x" aria-label="Close"><i class="ti ti-x" aria-hidden="true"></i></button>' +
        '<div class="pn-top">' +
          '<div class="pn-badge" aria-hidden="true"><i class="ti ti-sparkles"></i></div>' +
          '<div class="pn-top-text">' +
            '<div class="pn-eyebrow"><span>Product update</span><span class="pn-dot"></span><span class="pn-range">Aug 11 &ndash; Aug 25</span></div>' +
            '<h2 id="pn-title">What&#39;s new in your dashboard</h2>' +
            '<p class="pn-lede">Two new ways to record an award, plus a few smaller changes worth knowing.</p>' +
          '</div>' +
        '</div>' +
        '<div class="pn-body">' +
          '<div class="pn-feature">' +
            '<div class="pn-feature-icon" aria-hidden="true"><i class="ti ti-users-group"></i></div>' +
            '<div style="min-width:0">' +
              '<p class="pn-feature-title">Co-awarded vendors <span class="pn-new">New</span></p>' +
              '<p class="pn-feature-copy">A work package can now be awarded to <b>more than one vendor</b>. Add each one as a chip in Awarded Vendor and enter their own negotiated amount &mdash; the <b>Awarded Cost becomes the auto-sum</b> and locks. A single vendor behaves exactly as before.</p>' +
            '</div>' +
          '</div>' +
          '<div class="pn-feature">' +
            '<div class="pn-feature-icon" aria-hidden="true"><i class="ti ti-discount-check"></i></div>' +
            '<div style="min-width:0">' +
              '<p class="pn-feature-title">No-Cost Award <span class="pn-new">New</span></p>' +
              '<p class="pn-feature-copy">For a WP awarded at <b>&#8369;0</b> because the vendor provides it free, tick <b>No-Cost Award</b> instead of leaving the cost blank &mdash; its full budget then counts as savings rather than looking like a cost you still owe. Awarded Vendor is still required.</p>' +
            '</div>' +
          '</div>' +
          '<p class="pn-section-label">Also in this update</p>' +
          '<div class="pn-item">' +
            '<div class="pn-item-icon" aria-hidden="true"><i class="ti ti-sum"></i></div>' +
            '<div>' +
              '<p class="pn-item-title">Per-trade subtotals, and a truer Balance to Award</p>' +
              '<p class="pn-item-copy">Trade group headers in the WP List now show that trade&#39;s Budget and Awarded totals, following whatever filters you have on. <b>Balance to Award</b> on the Overview now also matches the Backlog table exactly.</p>' +
            '</div>' +
          '</div>' +
          '<div class="pn-item">' +
            '<div class="pn-item-icon" aria-hidden="true"><i class="ti ti-rotate-2"></i></div>' +
            '<div>' +
              '<p class="pn-item-title">Buyback: enter an exact amount</p>' +
              '<p class="pn-item-copy">Buyback now takes either a <b>depreciation %</b> or the <b>exact recovered amount</b>, whichever you actually have. The recovery is also called out separately in Savings / Loss instead of being folded in silently.</p>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="pn-foot">' +
          '<span class="pn-foot-note">Shown once &mdash; reopen any time from <b>What&#39;s New</b> in your profile menu.</span>' +
          '<button class="pn-btn">Got it</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    requestAnimationFrame(function () { ov.classList.add('show'); });
    document.addEventListener('keydown', onKey);
    ov.addEventListener('mousedown', function (e) { if (e.target === ov) dismiss(); });
    ov.querySelector('.pn-x').addEventListener('click', dismiss);
    ov.querySelector('.pn-btn').addEventListener('click', dismiss);
  }

  function maybeAutoOpen(userId, role) {
    if (new Date() >= EXPIRES) return;
    if (!isContributor(role)) return;
    window.__pnUserId = userId;
    var seen = false;
    try { seen = !!localStorage.getItem(SEEN_PREFIX + userId); } catch (_) {}
    // Delayed past onboarding.js (~650ms) and coachmarks.js (~800ms) so a
    // brand-new contributor doesn't get this stacked on top of those.
    if (!seen) setTimeout(open, 1500);
  }

  window.PatchNotice = { maybeAutoOpen: maybeAutoOpen, open: open };
})();
