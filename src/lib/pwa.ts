/**
 * Progressive Web App (PWA) & Stream Cache Client Interface
 */

export interface CacheStats {
  shellItems: number;
  streamSegments: number;
  maxSegments: number;
}

export function registerServiceWorker(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  // Register once page loads to avoid competing with critical LCP resources
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((registration) => {
        // Check for updates
        registration.addEventListener('updatefound', () => {
          const installingWorker = registration.installing;
          if (installingWorker) {
            installingWorker.addEventListener('statechange', () => {
              if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                // New update available, activate it immediately
                installingWorker.postMessage({ type: 'SKIP_WAITING' });
              }
            });
          }
        });
      })
      .catch((_err) => {
        // Handled silently
      });
  });
}

export function getStreamCacheStats(): Promise<CacheStats | null> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !navigator.serviceWorker?.controller) {
      return resolve(null);
    }

    const messageChannel = new MessageChannel();
    messageChannel.port1.onmessage = (event) => {
      if (event.data && !event.data.error) {
        resolve(event.data as CacheStats);
      } else {
        resolve(null);
      }
    };

    navigator.serviceWorker.controller.postMessage({ type: 'GET_CACHE_STATS' }, [messageChannel.port2]);

    // Timeout safety
    setTimeout(() => resolve(null), 1500);
  });
}

export function clearStreamCache(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !navigator.serviceWorker?.controller) {
      return resolve(false);
    }

    const messageChannel = new MessageChannel();
    messageChannel.port1.onmessage = (event) => {
      resolve(Boolean(event.data?.ok));
    };

    navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_STREAM_CACHE' }, [messageChannel.port2]);

    setTimeout(() => resolve(false), 1500);
  });
}
