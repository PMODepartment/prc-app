/* Service worker for the Vendor Portal.
   Two jobs: make the portal installable, and receive push notifications.

   ⚠️ IT CACHES NOTHING. Caching this app would be actively harmful: every page
      reads live data through Supabase, and a vendor looking at a stale bid
      deadline or a stale accreditation status is worse off than one seeing
      nothing. The app's own ?v= cache-buster already handles asset versioning.
      A fetch handler exists only because one must, for the install prompt. */
const SHELL = 'mw-vendor-shell-v2';

self.addEventListener('install', function () { self.skipWaiting(); });

self.addEventListener('activate', function (e) {
  // Drop anything an older shell version cached, so a stale one cannot survive.
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

/* Network-only, on purpose. */
self.addEventListener('fetch', function () { return; });

/* ── Push ──────────────────────────────────────────────────────────────────
   ⚠️ THE PUSH CARRIES NO PAYLOAD, BY DESIGN. A payloadless push needs only a
      signed VAPID header, but the real reason is that a message WITH a payload
      travels through Google's or Apple's push infrastructure. "A new bid
      invitation is waiting" tells the vendor to look without putting a package
      name, a deadline or a figure on that wire. So there is nothing to read out
      of `event.data` and nothing here tries to.

   ⚠️ A NOTIFICATION MUST BE SHOWN. The subscription is userVisibleOnly, so a
      push that shows nothing gets the origin's push permission revoked by the
      browser. Every path below ends in showNotification. */
/* ⚠️ MUST MATCH VAPID_PUBLIC_KEY IN vendor-portal.html.
   It is only needed by the pushsubscriptionchange handler at the bottom, as
   the fallback for browsers that do not hand back the old subscription. It is
   not a secret — the browser needs it to subscribe. A service worker cannot
   read the page's constant (separate script, and it is restarted between
   events), so the value genuinely has to be in both files. */
const VAPID_PUBLIC_KEY = 'BHtcZB917UhLQS5xItFmm8Q91i6-0W3ci7VKUMXV2z9CRN4-O28jm5hKIsDoVxhCC-W8w_WYgqA69MGLtOOTakU';

const TITLE = 'Megawide Procurement';
const BODY  = 'Something is waiting on your Bid Board.';

self.addEventListener('push', function (event) {
  event.waitUntil((async function () {
    try { if (self.registration.setAppBadge) await self.registration.setAppBadge(); } catch (e) {}
    await self.registration.showNotification(TITLE, {
      body: BODY,
      icon: 'assets/icons/icon-192.png',
      badge: 'assets/icons/icon-192-maskable.png',
      // One tag, so three events in a row collapse into one notification
      // instead of stacking up three identical banners.
      tag: 'mw-bid',
      renotify: true,
      data: { url: 'vendor-portal.html' },
    });
  })());
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || 'vendor-portal.html';
  event.waitUntil((async function () {
    const url = new URL(target, self.registration.scope).href;
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Focus a tab that already has the portal open rather than opening a second.
    for (const c of all) {
      if (c.url.indexOf('vendor-portal') !== -1 && 'focus' in c) return c.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});

/* ⚠️ A BROWSER CAN ROTATE A SUBSCRIPTION ON ITS OWN. Without this the endpoint
   in the database goes stale, every later push 410s, and the row is deleted —
   the vendor is silently unsubscribed having done nothing. Re-subscribe with
   the same key and tell the page, which stores it. */
function _b64uToU8(v) {
  const pad = (v + '='.repeat((4 - (v.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

self.addEventListener('pushsubscriptionchange', function (event) {
  event.waitUntil((async function () {
    const old = event.oldSubscription || null;
    /* ⚠️ oldSubscription IS OFTEN ABSENT, and its options emptier still —
       support for this event is patchy. Returning here is what would silently
       unsubscribe the vendor, which is the exact thing this handler exists to
       prevent, so fall back to the constant above. */
    let key = (old && old.options && old.options.applicationServerKey) || null;
    if (!key && VAPID_PUBLIC_KEY) key = _b64uToU8(VAPID_PUBLIC_KEY);
    if (!key) return;
    try {
      const sub = await self.registration.pushManager.subscribe({
        userVisibleOnly: true, applicationServerKey: key,
      });
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      all.forEach(function (c) {
        c.postMessage({ type: 'push-resubscribed', subscription: sub.toJSON(),
                        oldEndpoint: old ? old.endpoint : null });
      });
    } catch (e) { /* nothing useful to do from here */ }
  })());
});
