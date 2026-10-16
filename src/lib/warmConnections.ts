/**
 * Preconnect and dns-prefetch to known stream and CDN origins
 * to reduce initial playback latency.
 */

const STREAM_ORIGINS = [
  'https://bridge.anihubstream.com',
  'https://megaplay.buzz',
  'https://vidwish.live',
  'https://vidtube.site',
  'https://anikototv.to',
];

const warmed = new Set<string>();

export function warmStreamOrigins(): void {
  if (typeof document === 'undefined') return;

  for (const origin of STREAM_ORIGINS) {
    if (warmed.has(origin)) continue;
    warmed.add(origin);

    try {
      const dns = document.createElement('link');
      dns.rel = 'dns-prefetch';
      dns.href = origin;
      document.head.appendChild(dns);

      const conn = document.createElement('link');
      conn.rel = 'preconnect';
      conn.href = origin;
      conn.crossOrigin = 'anonymous';
      document.head.appendChild(conn);
    } catch {}
  }
}
