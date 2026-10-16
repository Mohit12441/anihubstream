/* ============================================================
   Client for the AniKoto bridge (api/bridge.mjs).

   The bridge is the same-origin playback proxy the provider chain
   needs (Referer-gated CDN + per-request token signing), so the
   browser never holds an upstream URL — every playlist, segment
   and caption request goes through the bridge.

   Two bases are possible: the loopback bridge on the operator's
   machine, and the public tunnel (bridge.anihubstream.com) that
   serves visitors. bridgeHealth() probes them in the order that
   fits the page's origin and pins whichever answers; every later
   URL uses the pinned base.

   Nothing here throws into the UI: a dead bridge reads as `false`
   / `{ error }` and the player shows an offline state with retry.
   ============================================================ */

export interface BridgeSubtitle {
  language: string;
  name?: string;
  /** bridge-local path, e.g. /stream/<sid>/sub/1.vtt */
  url: string;
}

export interface BridgeSource {
  session: string;
  title: string;
  episode: { number: number; title: string };
  quality: number | string;
  variants: (number | string)[];
  audio: string;
  skip: { intro?: [number, number]; outro?: [number, number] } | null;
  proof: { container: string; checkedBytes: number };
  master: string;
  subtitles: BridgeSubtitle[];
  reused?: boolean;
}

export interface ResolveFailure {
  error: string;
  message?: string;
}

const ENV_BASE = (
  ((typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_STREAM_BRIDGE) || (globalThis as any).process?.env?.VITE_STREAM_BRIDGE) as string | undefined ?? ''
).replace(/\/+$/, '');
const LOCAL_BASE = 'http://127.0.0.1:8795';
const PUBLIC_BASE = 'https://bridge.anihubstream.com';

/* Explicit env wins outright. The operator's dev origin tries loopback first
   (fastest, no tunnel hop) and keeps the tunnel as fallback. A public origin
   probes the tunnel only: Chrome's Local Network Access refuses cross-origin
   fetches to loopback from public pages (no prompt in kiosk/headless, a
   confusing "local network" prompt for visitors), and a visitor's own
   127.0.0.1 has no bridge anyway. */
const candidateBases = (): string[] => {
  if (ENV_BASE) return [ENV_BASE];
  const loopback = typeof window !== 'undefined' && window.location ? ['localhost', '127.0.0.1'].includes(window.location.hostname) : false;
  return loopback ? [LOCAL_BASE, PUBLIC_BASE] : [PUBLIC_BASE];
};

let activeBase: string | null = null;

export const bridgeUrl = (path: string) => {
  const base = activeBase ?? (ENV_BASE || candidateBases()[0]);
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
};

let healthProbe: Promise<boolean> | null = null;

/**
 * Probes the candidate bases in order and pins the first that answers.
 * Cached per page load; a failure is not cached so the next attempt
 * re-probes. `fresh` clears the cache *and* the pin — the retry path.
 */
export function bridgeHealth(fresh = false): Promise<boolean> {
  if (fresh) {
    healthProbe = null;
    activeBase = null;
  }
  healthProbe ??= (async () => {
    for (const base of candidateBases()) {
      try {
        /* 8s: a cold tunnel connection (DNS + TLS to the CF edge, then the
           tunnel hop) can take seconds; 3.5s proved too tight and read as
           "bridge offline" while the bridge was healthy. */
        const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) continue;
        const body = (await res.json()) as { ok?: boolean };
        if (body.ok === true) {
          activeBase = base;
          return true;
        }
      } catch {
        /* unreachable — try the next base */
      }
    }
    return false;
  })().then((ok) => {
    if (!ok) healthProbe = null;
    return ok;
  });
  return healthProbe;
}

const RESOLVE_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours (up to 24h)
const memoryCache = new Map<string, { at: number; data: BridgeSource }>();
const activeResolves = new Map<string, Promise<BridgeSource | ResolveFailure>>();

const slugifyKey = (t: string) =>
  t.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'anime';

export function streamCacheKey(title: string, ep: number, audio: 'sub' | 'dub'): string {
  return `stream:${slugifyKey(title)}:${ep}:${audio}`;
}

export function getCachedSource(key: string): BridgeSource | null {
  const now = Date.now();
  const mem = memoryCache.get(key);
  if (mem && now - mem.at < RESOLVE_CACHE_TTL_MS) {
    return { ...mem.data, reused: true };
  }
  try {
    const raw = localStorage.getItem(`res_${key}`) || sessionStorage.getItem(`res_${key}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.at === 'number' && now - parsed.at < RESOLVE_CACHE_TTL_MS) {
        memoryCache.set(key, parsed);
        return { ...parsed.data, reused: true };
      }
    }
  } catch {}
  return null;
}

export function setCachedSource(key: string, data: BridgeSource): void {
  const entry = { at: Date.now(), data };
  memoryCache.set(key, entry);
  try {
    localStorage.setItem(`res_${key}`, JSON.stringify(entry));
    sessionStorage.setItem(`res_${key}`, JSON.stringify(entry));
  } catch {}

  // Asynchronously persist to D1 stream_cache with 6h TTL
  try {
    void fetch('/api/stream/cache', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, data, ttlSeconds: 21600 }),
    }).catch(() => {});
  } catch {}
}

/** Non-blocking prefetch of an upcoming episode */
export async function prefetchEpisode(
  title: string,
  ep: number,
  audio: 'sub' | 'dub',
): Promise<void> {
  if (!title || ep < 1) return;
  const key = streamCacheKey(title, ep, audio);
  if (getCachedSource(key)) return;
  void bridgeResolve(title, ep, audio);
}

export async function bridgeResolve(
  title: string,
  ep: number,
  audio: 'sub' | 'dub',
): Promise<BridgeSource | ResolveFailure> {
  const key = streamCacheKey(title, ep, audio);
  const cached = getCachedSource(key);
  if (cached) return cached;

  if (activeResolves.has(key)) {
    return activeResolves.get(key)!;
  }

  const promise = (async () => {
    // Check D1 remote cache first before hitting bridge (<200ms)
    try {
      const cacheRes = await fetch(`/api/stream/cache?key=${encodeURIComponent(key)}`, {
        signal: AbortSignal.timeout(500),
      });
      if (cacheRes.ok) {
        const cacheJson = (await cacheRes.json()) as { hit?: boolean; data?: BridgeSource };
        if (cacheJson.hit && cacheJson.data) {
          const remoteData = { ...cacheJson.data, reused: true };
          memoryCache.set(key, { at: Date.now(), data: remoteData });
          return remoteData;
        }
      }
    } catch {}

    try {
      const res = await fetch(
        bridgeUrl(`/resolve?title=${encodeURIComponent(title)}&ep=${ep}&audio=${audio}`),
        { signal: AbortSignal.timeout(30_000) },
      );
      const body = (await res.json()) as BridgeSource | ResolveFailure;
      if (!res.ok) {
        const fail = body as ResolveFailure;
        return { error: fail?.error ?? `HTTP ${res.status}`, message: fail?.message };
      }
      setCachedSource(key, body as BridgeSource);
      return body;
    } catch (e) {
      return { error: 'BRIDGE_UNREACHABLE', message: (e as Error).message };
    } finally {
      activeResolves.delete(key);
    }
  })();

  activeResolves.set(key, promise);
  return promise;
}

export const isResolveFailure = <T extends object>(v: T | ResolveFailure): v is ResolveFailure =>
  (v as ResolveFailure).error !== undefined;

/** One audio the episode could be played in. */
export interface AudioOption {
  id: 'sub' | 'dub';
  label: string;
  /** safe to offer as a real, distinct choice */
  available: boolean;
  /** dub only: how availability was decided */
  state?: 'verified' | 'copy' | 'unknown' | 'absent';
  /** honest reason when it is not available */
  reason?: string;
}

export interface AudioList {
  title: string;
  episode: { number: number; title: string };
  audios: AudioOption[];
}

/**
 * Which audio THIS episode really carries. The bridge decides the dub by a byte
 * comparison against the original (it is offered only when that proves a second
 * audio), so this is evidence, not the site's `/dub` label. Cold calls run the
 * probe (~seconds); the bridge caches the verdict per episode for an hour.
 */
export async function bridgeAudios(title: string, ep: number): Promise<AudioList | ResolveFailure> {
  try {
    const res = await fetch(bridgeUrl(`/audios?title=${encodeURIComponent(title)}&ep=${ep}`), {
      signal: AbortSignal.timeout(120_000),
    });
    const body = (await res.json()) as AudioList | ResolveFailure;
    if (!res.ok) {
      const fail = body as ResolveFailure;
      return { error: fail?.error ?? `HTTP ${res.status}`, message: fail?.message };
    }
    return body as AudioList;
  } catch (e) {
    return { error: 'BRIDGE_UNREACHABLE', message: (e as Error).message };
  }
}

export interface Cue {
  start: number;
  end: number;
  text: string;
}

/* WebVTT timestamps come as MM:SS.mmm or HH:MM:SS.mmm; SRT uses a comma for the
   same field.  Providers hand back both, so fold them here rather than silently
   dropping every cue of a track that is fine but differently punctuated. */
const cueTime = (t: string) =>
  t
    .trim()
    .replace(',', '.')
    .split(':')
    .map(Number)
    .reduce((acc, v) => acc * 60 + v, 0);

export function parseVtt(text: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of text.replace(/\r/g, '').split('\n\n')) {
    const lines = block.split('\n').filter(Boolean);
    const idx = lines.findIndex((l) => l.includes('-->'));
    if (idx < 0) continue;
    const [a, b] = lines[idx].split('-->');
    if (!a || !b) continue;
    const start = cueTime(a.trim().split(/\s+/)[0]);
    const end = cueTime(b.trim().split(/\s+/)[0]);
    const body = lines
      .slice(idx + 1)
      .join('\n')
      .replace(/<[^>]+>/g, '')
      .trim();
    if (body && Number.isFinite(start) && Number.isFinite(end)) cues.push({ start, end, text: body });
  }
  return cues.sort((x, y) => x.start - y.start);
}

export interface VttFile {
  cues: Cue[];
  /** characters the provider actually sent — separates "empty track" from "unreadable format" */
  chars: number;
}

export async function fetchVtt(path: string): Promise<VttFile | null> {
  try {
    const res = await fetch(bridgeUrl(path), { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const text = await res.text();
    return { cues: parseVtt(text), chars: text.length };
  } catch {
    return null;
  }
}
