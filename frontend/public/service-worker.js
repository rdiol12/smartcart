// Bump this manually on any deploy that needs to evict the SHELL cache
// (i.e. `/` and `/index.html` snapshots). You usually don't need to —
// see the "Why no per-deploy version bumps" note at the bottom.
const CACHE_NAME = 'smartcart-v2';

// Only files that actually exist in the production build go in here.
// Previously this list included /src/main.jsx, /src/App.jsx, /src/App.css
// which are Vite dev-server paths that 404 in prod. cache.addAll() is
// atomic, so a single 404 rejected the whole precache and the SW never
// reached the activate phase — the PWA shell-cache silently never worked.
const PRECACHE = ['/', '/index.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch((err) => {
        console.error('[Service Worker] Precache failed:', err);
      }),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((n) => n !== CACHE_NAME)
            .map((n) => caches.delete(n)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip cross-origin — the SW only owns same-origin caching.
  if (url.origin !== self.location.origin) return;

  // Never cache /api/*. Previously this was cache-first for everything
  // except a hand-maintained auth allowlist, which meant /api/lists,
  // /api/lists/:id/items, /api/templates etc. all returned stale snapshots
  // forever — a refresh would silently "lose" items that another user had
  // just added. Real-time collaboration cannot survive that.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Navigation: network-first with cache fallback. Users online always get
  // the freshest index.html; offline they get the last-cached snapshot.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy));
          return res;
        })
        .catch(() => caches.match('/index.html')),
    );
    return;
  }

  // Static assets — cache-first is SAFE here because Vite emits hashed
  // filenames (/assets/index-ABC123.js etc.). A new build produces new
  // URLs; old URLs are unreachable / cycle out of the LRU naturally.
  // That self-invalidation is also why CACHE_NAME doesn't need to bump
  // every deploy.
  if (
    url.pathname.startsWith('/assets/') ||
    /\.(js|css|png|jpg|jpeg|svg|gif|woff2?|ico)$/.test(url.pathname)
  ) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((res) => {
          if (res && res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(event.request, copy));
          }
          return res;
        });
      }),
    );
    return;
  }

  // Anything else: default browser fetch (no SW interception).
});

// (No background-sync handler registered. Nothing in src/ calls
// registration.sync.register(), so a handler here would only ever fire
// from manual DevTools dispatches — pure log noise. Add back when a real
// offline-mutation queue lands.)

// Push notifications.
//
// Currently inert in this codebase: the web app doesn't subscribe to Web
// Push (no PushManager.subscribe() call anywhere in src/). Native push
// goes through Expo (see server/routes/socket.js sendPushNotifications),
// which doesn't trigger this handler. Kept as a placeholder for if/when
// the web app starts subscribing.
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'SmartCart';
  const options = {
    body: data.body || 'יש לך עדכון חדש',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [200, 100, 200],
    data: data.data || {},
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data.url || '/'));
});

// --- Why no per-deploy version bumps ---------------------------------------
// Vite's production build emits hashed filenames for every JS/CSS asset
// (/assets/index-ABC123.js). When the build changes, the URLs change, so
// the cache entries from a prior deploy are no longer reachable — the SW
// will fetch the new URLs fresh and cache them under the new name. Old
// entries fall out via LRU. The only thing CACHE_NAME guards is the shell
// cache (/, /index.html), which the navigation network-first strategy
// already refreshes on every online visit. Bump CACHE_NAME only if you
// need to force-evict every client's offline snapshot.
