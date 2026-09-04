/* Service worker for the Vendor Portal.
   ⚠️ ITS ONLY JOB IS TO MAKE THE PORTAL INSTALLABLE. It deliberately caches
      NOTHING but the offline shell.

      Caching this app would be actively harmful: every page reads live data
      through Supabase, and a vendor looking at a stale cached bid deadline or a
      stale accreditation status would be worse off than seeing nothing. The
      app's own ?v= cache-buster already handles asset versioning.

   ⚠️ AND IT CANNOT DELIVER PUSH NOTIFICATIONS. Real push — a badge appearing
      while the app is CLOSED — needs a push service and a server to trigger it.
      This stack is static GitHub Pages plus Supabase with no Edge Functions,
      and there is no subscription to add one. What IS possible, and is what
      vendor-portal.html does, is set the app badge from the page while it is
      open. See the note there. Do not add a 'push' handler here and imply
      otherwise. */
const SHELL = 'mw-vendor-shell-v1';

self.addEventListener('install', function (e) {
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  // Drop any cache from an older shell version so a stale one cannot survive.
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== SHELL; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

/* Network-only, on purpose. A fetch handler has to exist for the install
   prompt to be offered at all, but it must not serve anything from a cache. */
self.addEventListener('fetch', function (e) {
  return;
});
