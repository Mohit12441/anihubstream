/**
 * AniHubStream Progressive Web App (PWA) & Offline Stream Segment Service Worker
 * Version: 1.0.0
 * Scope: /
 */

const SHELL_CACHE = 'anihub-shell-v3';
const STREAM_CACHE = 'anihub-stream-v2';
const MAX_STREAM_SEGMENTS = 45;

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/emblem.svg',
  '/manifest.webmanifest',
];

// Helper: Determine if URL represents an HLS media segment (.ts, .m4s, .mp4 chunks)
function isStreamSegment(url) {
  try {
    const u = new URL(url);
    const pathname = u.pathname.toLowerCase();
    if (pathname.endsWith('.ts') || pathname.endsWith('.m4s') || pathname.endsWith('.m4v')) {
      return true;
    }
    // Check proxied stream segments
    if (pathname.startsWith('/api/proxy')) {
      const target = (u.searchParams.get('url') || '').toLowerCase();
      if (target.includes('.ts') || target.includes('.m4s') || target.includes('seg-') || target.includes('fragment')) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

// Helper: Determine if URL represents an HLS manifest / playlist (.m3u8)
function isPlaylist(url) {
  try {
    const u = new URL(url);
    const pathname = u.pathname.toLowerCase();
    if (pathname.endsWith('.m3u8') || pathname.endsWith('.m3u')) {
      return true;
    }
    if (pathname.startsWith('/api/proxy')) {
      const target = (u.searchParams.get('url') || '').toLowerCase();
      if (target.includes('.m3u8')) return true;
    }
    return false;
  } catch {
    return false;
  }
}

// Helper: Determine if URL is a static shell asset (JS, CSS, fonts, SVG)
function isStaticAsset(url) {
  try {
    const u = new URL(url);
    const pathname = u.pathname;
    return (
      pathname.startsWith('/assets/') ||
      pathname.startsWith('/art/') ||
      pathname.endsWith('.svg') ||
      pathname.endsWith('.png') ||
      pathname.endsWith('.css') ||
      pathname.endsWith('.js') ||
      u.hostname.includes('fonts.googleapis.com') ||
      u.hostname.includes('fonts.gstatic.com')
    );
  } catch {
    return false;
  }
}

// LRU Eviction: Keep stream segment cache bounded to prevent storage exhaustion
async function pruneLru(cacheName, maxItems) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length > maxItems) {
      const excess = keys.length - maxItems;
      for (let i = 0; i < excess; i++) {
        await cache.delete(keys[i]);
      }
    }
  } catch {
    // Ignore prune errors silently
  }
}

// Lifecycle: Install
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

// Lifecycle: Activate
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => {
        return Promise.all(
          keys
            .filter((k) => k !== SHELL_CACHE && k !== STREAM_CACHE)
            .map((k) => caches.delete(k))
        );
      })
      .then(() => self.clients.claim())
  );
});

// Lifecycle: Message
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data) return;

  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (data.type === 'CLEAR_STREAM_CACHE') {
    caches.delete(STREAM_CACHE).then(() => {
      if (event.ports && event.ports[0]) {
        event.ports[0].postMessage({ ok: true });
      }
    });
  } else if (data.type === 'GET_CACHE_STATS') {
    Promise.all([caches.open(SHELL_CACHE), caches.open(STREAM_CACHE)])
      .then(async ([shellCache, streamCache]) => {
        const shellKeys = await shellCache.keys();
        const streamKeys = await streamCache.keys();
        if (event.ports && event.ports[0]) {
          event.ports[0].postMessage({
            shellItems: shellKeys.length,
            streamSegments: streamKeys.length,
            maxSegments: MAX_STREAM_SEGMENTS,
          });
        }
      })
      .catch(() => {
        if (event.ports && event.ports[0]) {
          event.ports[0].postMessage({ error: 'Failed to read cache stats' });
        }
      });
  }
});

// Fetch Interception
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Only handle HTTP/HTTPS GET requests
  if (request.method !== 'GET' || !request.url.startsWith('http')) {
    return;
  }

  // Pass range requests directly to network (Safari/iOS compatibility)
  if (request.headers.has('range')) {
    return;
  }

  // 1. Navigation requests (HTML pages): Network-First, fallback to cached index.html
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          return (await caches.match('/index.html')) || (await caches.match('/'));
        })
    );
    return;
  }

  // 2. Stream Media Segments: Cache-First with LRU bounded pruning
  if (isStreamSegment(request.url)) {
    event.respondWith(
      caches.open(STREAM_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) {
          return cached;
        }

        try {
          const netRes = await fetch(request);
          if (netRes.ok || netRes.status === 200) {
            const clone = netRes.clone();
            cache.put(request, clone).then(() => {
              pruneLru(STREAM_CACHE, MAX_STREAM_SEGMENTS);
            });
          }
          return netRes;
        } catch (err) {
          if (cached) return cached;
          throw err;
        }
      })
    );
    return;
  }

  // 3. HLS Playlists / Manifests (.m3u8): Network-First with cache fallback
  if (isPlaylist(request.url)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(STREAM_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          throw new Error('Playlist offline and not cached');
        })
    );
    return;
  }

  // 4. Static Shell Assets: Cache-First with Stale-While-Revalidate
  if (isStaticAsset(request.url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fetchPromise = fetch(request)
          .then((netRes) => {
            if (netRes.ok) {
              const clone = netRes.clone();
              caches.open(SHELL_CACHE).then((cache) => cache.put(request, clone));
            }
            return netRes;
          })
          .catch(() => cached);

        return cached || fetchPromise;
      })
    );
    return;
  }

  // 5. Default: Network with graceful fallback
  event.respondWith(
    fetch(request).catch(async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      throw new Error('Network request failed');
    })
  );
});

// Web Push Handler: Receive remote push notifications from VAPID dispatch worker
self.addEventListener('push', (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = { body: event.data.text() };
    }
  }

  const title = payload.title || 'AniHubStream Airing Alert';
  const options = {
    body: payload.body || 'A new anime episode has aired!',
    icon: payload.icon || '/emblem.svg',
    badge: payload.badge || '/emblem.svg',
    tag: payload.tag || 'airing_notification',
    data: payload.data || { url: payload.url || '/' },
    actions: [
      {
        action: 'watch',
        title: 'Watch Now',
      },
    ],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Notification Click: Focus existing client or open target watch URL
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(urlToOpen) && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(urlToOpen);
      }
    })
  );
});


