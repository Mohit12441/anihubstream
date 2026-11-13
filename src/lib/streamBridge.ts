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

import type { LiveAudioTrack } from './useLiveStream';

export interface BridgeSubtitle {
  language: string;
  name?: string;
  /** bridge-local path, e.g. /stream/<sid>/sub/1.vtt */
  url: string;
}

export interface BridgeSource {
  session: string;
  provider?: string;
  kind?: 'hls' | 'progressive' | 'embed';
  type?: string;
  container?: string;
  title: string;
  episode: { number: number; title: string };
  quality: number | string;
  variants: (number | string)[];
  audio: string;
  audioTracks?: LiveAudioTrack[];
  skip: { intro?: [number, number]; outro?: [number, number] } | null;
  proof: { container: string; checkedBytes: number };
  master: string;
  subtitles: BridgeSubtitle[];
  thumbnails?: { url: string } | null;
  reused?: boolean;
  raceMs?: number;
  winner?: string;
  downloadPage?: string | null;
  downloadUrl?: string | null;
  downloads?: { name: string; quality?: string; url: string; provider?: string; audio?: string }[];
  servers?: { name: string; linkId: string; type?: string }[];
}

export interface ResolveFailure {
  error: string;
  message?: string;
}

const ENV_BASE = (
  ((typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_STREAM_BRIDGE) || (globalThis as any).process?.env?.VITE_STREAM_BRIDGE) as string | undefined ?? ''
).replace(/\/+$/, '');

/* Explicit env wins outright. The operator's dev origin tries loopback first
   (fastest, no tunnel hop) and keeps the tunnel as fallback. A public origin
   probes the tunnel only: Chrome's Local Network Access refuses cross-origin
   fetches to loopback from public pages (no prompt in kiosk/headless, a
   confusing "local network" prompt for visitors), and a visitor's own
   127.0.0.1 has no bridge anyway. */
const candidateBases = (): string[] => {
  if (ENV_BASE) return [ENV_BASE];
  return [''];
};

let activeBase: string | null = null;

export const bridgeUrl = (path: string) => {
  if (!path) return '';
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  const base = activeBase ?? (ENV_BASE || candidateBases()[0]);
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
};

export const bridgeWsUrl = (path: string) => {
  const httpUrl = bridgeUrl(path);
  if (httpUrl.startsWith('http://')) {
    return httpUrl.replace(/^http:\/\//, 'ws://');
  }
  if (httpUrl.startsWith('https://')) {
    return httpUrl.replace(/^https:\/\//, 'wss://');
  }
  if (httpUrl.startsWith('/') && typeof window !== 'undefined' && window.location) {
    const loc = window.location;
    const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${loc.host}${httpUrl}`;
  }
  return httpUrl;
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
        const probeUrl = base === '' ? '/api/health' : `${base}/health`;
        const res = await fetch(probeUrl, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) continue;
        const body = (await res.json()) as { ok?: boolean; status?: string };
        if (body.ok === true || body.status === 'healthy') {
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

export function isMegaplayTokenValid(urlOrToken: string, maxAgeSec = 1800): boolean {
  if (!urlOrToken || typeof urlOrToken !== 'string') return false;
  try {
    let token = urlOrToken;
    if (token.includes('token=')) {
      const match = token.match(/token=([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/);
      token = match ? match[1] : '';
    } else if (token.includes('/') || token.includes(':')) {
      return true;
    }
    if (!token) return true; // not a Megaplay tokenized url
    const part = token.split('.')[0];
    if (!part) return true;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(b64);
    const parts = decoded.split('|');
    const tokenSec = parseInt(parts[0], 10);
    if (!Number.isFinite(tokenSec) || tokenSec <= 0) return true;
    const nowSec = Math.floor(Date.now() / 1000);
    return (nowSec - tokenSec) < maxAgeSec && (tokenSec - nowSec) < 300;
  } catch {
    return true;
  }
}

const RESOLVE_CACHE_TTL_MS = 20 * 60 * 1000; // 20 minutes (aligned with upstream token validity)
const memoryCache = new Map<string, { at: number; data: BridgeSource }>();
const activeResolves = new Map<string, Promise<BridgeSource | ResolveFailure>>();

export function streamCacheKey(
  animeId: string,
  ep: number,
  audio: 'sub' | 'dub' | string,
  provider: string = 'auto',
  server?: string,
): string {
  const normId = (animeId || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const provSuffix = provider && provider !== 'auto' ? `:${provider}` : '';
  const srvSuffix = server ? `:${server}` : '';
  return `stream:${normId}:${ep}:${audio}${provSuffix}${srvSuffix}`;
}

export function getCachedSource(key: string): BridgeSource | null {
  const now = Date.now();
  const mem = memoryCache.get(key);
  if (mem && now - mem.at < RESOLVE_CACHE_TTL_MS) {
    if (mem.data.kind === 'embed' || mem.data.type === 'embed' || mem.data.master?.includes('morencius')) {
      memoryCache.delete(key);
    } else if (isMegaplayTokenValid(mem.data.master)) {
      return { ...mem.data, reused: true };
    } else {
      memoryCache.delete(key);
    }
  }
  try {
    const raw = localStorage.getItem(`res_${key}`) || sessionStorage.getItem(`res_${key}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.data?.kind === 'embed' || parsed?.data?.type === 'embed' || parsed?.data?.master?.includes('morencius')) {
        localStorage.removeItem(`res_${key}`);
        sessionStorage.removeItem(`res_${key}`);
      } else if (parsed && typeof parsed.at === 'number' && now - parsed.at < RESOLVE_CACHE_TTL_MS) {
        if (isMegaplayTokenValid(parsed.data?.master)) {
          memoryCache.set(key, parsed);
          return { ...parsed.data, reused: true };
        }
        localStorage.removeItem(`res_${key}`);
        sessionStorage.removeItem(`res_${key}`);
      }
    }
  } catch {}
  return null;
}

export function setCachedSource(key: string, data: BridgeSource): void {
  if (data.kind === 'embed' || data.type === 'embed' || data.master?.includes('morencius')) {
    return; // Never persist embed fallbacks
  }
  const entry = { at: Date.now(), data };
  memoryCache.set(key, entry);
  try {
    localStorage.setItem(`res_${key}`, JSON.stringify(entry));
    sessionStorage.setItem(`res_${key}`, JSON.stringify(entry));
  } catch {}

  // Asynchronously persist to D1 stream_cache with 20m TTL
  try {
    void fetch('/api/stream/cache', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, data, ttlSeconds: 1200 }),
    }).catch(() => {});
  } catch {}
}

/** Non-blocking prefetch of an upcoming episode */
export async function prefetchEpisode(
  animeId: string,
  ep: number,
  audio: 'sub' | 'dub' | string,
  provider: string = 'auto',
  server?: string,
): Promise<void> {
  if (!animeId || ep < 1) return;
  const key = streamCacheKey(animeId, ep, audio, provider, server);
  if (getCachedSource(key)) return;

  try {
    const cleanId = encodeURIComponent(animeId);
    void fetch(`/api/play?id=${cleanId}&ep=${ep}&audio=${audio}`, {
      priority: 'low' as RequestPriority,
    }).catch(() => {});
  } catch {}

  void bridgeResolve(animeId, ep, audio, provider, server);
}

export async function bridgeResolve(
  animeId: string,
  ep: number,
  audio: 'sub' | 'dub' | string,
  provider: string = 'auto',
  server?: string,
): Promise<BridgeSource | ResolveFailure> {
  const key = streamCacheKey(animeId, ep, audio, provider, server);
  const cached = getCachedSource(key);
  if (cached) return cached;

  if (activeResolves.has(key)) {
    return activeResolves.get(key)!;
  }

  const promise = (async () => {
    try {
      let resolveEndpoint = '';
      const srvParam = server ? `&server=${encodeURIComponent(server)}` : '';
      if (activeBase === '') {
        resolveEndpoint = `/api/play/resolve?anime_id=${encodeURIComponent(animeId)}&ep=${ep}&audio=${audio}&provider=${encodeURIComponent(provider)}${srvParam}`;
      } else {
        resolveEndpoint = bridgeUrl(`/resolve?anime_id=${encodeURIComponent(animeId)}&ep=${ep}&audio=${audio}&provider=${encodeURIComponent(provider)}${srvParam}`);
      }
      const res = await fetch(resolveEndpoint, { signal: AbortSignal.timeout(45_000) });
      const rawBody = (await res.json()) as any;
      if (!res.ok) {
        const fail = rawBody as ResolveFailure;
        return { error: fail?.error ?? `HTTP ${res.status}`, message: fail?.message };
      }
      let body: BridgeSource;
      if (rawBody.server) {
        const s = rawBody.server;
        body = {
          session: s.id,
          provider: s.provider,
          kind: s.type === 'mp4' ? 'progressive' : (s.type === 'embed' ? 'embed' : 'hls'),
          type: s.type || 'hls',
          title: animeId,
          episode: { number: ep, title: `Episode ${ep}` },
          quality: s.quality || '1080p',
          variants: [s.quality || '1080p'],
          audio: s.audio || audio,
          skip: (s.intro || s.outro) ? {
            intro: s.intro ? [s.intro.start, s.intro.end] : undefined,
            outro: s.outro ? [s.outro.start, s.outro.end] : undefined,
          } : null,
          proof: { container: s.type === 'embed' ? 'embed' : 'hls', checkedBytes: 1024 },
          master: s.streamUrl,
          subtitles: (s.subtitles || []).map((sub: any) => ({
            language: sub.language || sub.lang || 'en',
            name: sub.label || sub.name || 'English',
            url: sub.url || sub.proxyUrl || sub.uri || '',
          })),
          downloads: s.downloads || [],
        };
      } else {
        body = rawBody as BridgeSource;
      }
      setCachedSource(key, body);
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
  id: 'sub' | 'dub' | 'hindi' | string;
  label: string;
  /** safe to offer as a real, distinct choice */
  available: boolean;
  /** dub only: how availability was decided */
  state?: 'verified' | 'copy' | 'unknown' | 'absent';
  /** honest reason when it is not available */
  reason?: string;
  provider?: string;
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
export async function bridgeAudios(title: string, ep: number, provider = 'anikoto'): Promise<AudioList | ResolveFailure> {
  const isSubOnly = provider.toLowerCase() === 'torrent';
  const isHindi = provider.toLowerCase().includes('hindi') || title.toLowerCase().includes('hindi');
  const baseAudios: AudioOption[] = [
    { id: 'sub', label: 'Japanese (Sub)', available: true, state: 'verified' },
  ];
  if (!isSubOnly) {
    baseAudios.push({ id: 'dub', label: 'English (Dub)', available: true, state: 'verified' });
  }
  if (isHindi) {
    baseAudios.push({ id: 'hindi', label: 'Hindi (Multi-Audio)', available: true, state: 'verified' });
  }

  if (activeBase === '') {
    return {
      title,
      episode: { number: ep, title: `Episode ${ep}` },
      audios: baseAudios,
    };
  }
  try {
    const res = await fetch(bridgeUrl(`/audios?title=${encodeURIComponent(title)}&ep=${ep}&provider=${encodeURIComponent(provider)}`), {
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
  // Strip UTF-8 BOM if present
  const cleanText = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
  // Strip NOTE and STYLE blocks that break cue parsing
  const strippedText = cleanText
    .replace(/^NOTE(?:\s+[^\r\n]*)?(?:\r?\n[\s\S]*?)?(?=\r?\n\r?\n|\n\n|$)/gm, '')
    .replace(/^STYLE(?:\s+[^\r\n]*)?(?:\r?\n[\s\S]*?)?(?=\r?\n\r?\n|\n\n|$)/gm, '');
  // Robustly split on blank lines, allowing carriage returns, spaces, or tabs between newlines
  const blocks = strippedText.split(/\r?\n[ \t]*\r?\n+/);

  for (const block of blocks) {
    const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
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
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
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
    let target = bridgeUrl(path);
    try {
      const u = new URL(target, typeof window !== 'undefined' ? window.location?.origin : 'http://127.0.0.1');
      if (u.pathname.includes('/api/proxy')) {
        if (u.hostname === '127.0.0.1' || u.hostname === 'localhost' || (typeof window !== 'undefined' && u.host === window.location?.host)) {
          target = `${u.pathname}${u.search}`;
        }
      }
    } catch {}

    if ((target.startsWith('http://') || target.startsWith('https://')) && !target.includes('/api/proxy')) {
      let ref = 'https://megaplay.buzz/';
      try {
        const parsed = new URL(target);
        if (parsed.hostname.includes('zoko') || parsed.hostname.includes('animehot') || parsed.hostname.includes('dramahot')) {
          ref = 'https://zokoanime.video/';
        } else if (parsed.hostname.includes('vidnest')) {
          ref = 'https://vidnest.fun/';
        } else if (parsed.hostname.includes('settlar') || parsed.hostname.includes('cno.to')) {
          ref = 'https://settlar.io/';
        } else if (parsed.hostname.includes('rabbitstream') || parsed.hostname.includes('megacloud')) {
          ref = 'https://megaplay.buzz/';
        }
      } catch {}
      target = `/api/proxy?url=${encodeURIComponent(target)}&referer=${encodeURIComponent(ref)}`;
    }

    const res = await fetch(target, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const text = await res.text();
    return { cues: parseVtt(text), chars: text.length };
  } catch {
    return null;
  }
}

