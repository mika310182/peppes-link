const ICON = '/assets/peppe_listo.png';
const BADGE = '/assets/peppe_listo.png';

const CACHE = 'peppes-v1';
const STATIC = [
  '/',
  '/admin.html',
  '/index.html',
  '/track.html',
  '/manifest.json',
  '/img/pwa-icon-192.png',
  '/img/pwa-icon-512.png',
  '/img/pwa-icon.svg',
  '/js/notification-utils.js',
  '/js/distanceUtils.js',
  '/assets/peppe_listo.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(STATIC))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
    )).then(() => clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API calls: network-first, fallback to cache (for offline resilience)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // Firebase: network-only
  if (url.hostname.includes('firebaseio.com') || url.hostname.includes('googleapis.com')) {
    return;
  }

  // Google Fonts: cache-first
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('gstatic.com')) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request).then((r) => {
        const copy = r.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copy));
        return r;
      }))
    );
    return;
  }

  // Static assets: cache-first
  if (url.pathname.match(/\.(png|svg|js|css|json|ico)$/)) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request).then((r) => {
        const copy = r.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copy));
        return r;
      }))
    );
    return;
  }

  // HTML navigations: network-first (always show latest content)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/admin.html'))
    );
    return;
  }
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}
  const title = data.title || 'Peppe\'s Pizza';
  const body = data.body || '';
  const url = data.url || '/';
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: ICON,
      badge: BADGE,
      data: { url },
      vibrate: [200, 100, 200],
      requireInteraction: true
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  var targetUrl = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      var targetPath = new URL(targetUrl, self.location.origin).pathname.replace(/\.html$/, '');
      for (var i = 0; i < list.length; i++) {
        var clientPath = new URL(list[i].url).pathname.replace(/\.html$/, '');
        if (clientPath === targetPath && 'focus' in list[i]) return list[i].focus();
      }
      return clients.openWindow(targetUrl);
    })
  );
});
