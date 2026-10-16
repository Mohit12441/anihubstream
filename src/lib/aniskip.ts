/* ============================================================
   AniSkip v2 Client & Timestamp Integration.

   Connects to the official AniSkip v2 API (https://api.aniskip.com/v2)
   to retrieve opening, ending, and recap timestamps for anime episodes.

   Features:
   - Resilient query client with 5s timeout & AbortSignal support.
   - Relation rules handling (/relation-rules/{malId}) for franchise episode remapping.
   - Layered caching (in-memory + sessionStorage) with 24-hour TTL for both positive
     and negative (404/not found) responses.
   - Rate limiting (429) & Retry-After backoff.
   - Safe fallbacks so anime playback is never blocked or disrupted.
   ============================================================ */

import type { Marker, MarkerKind } from '../data/model';

export const DEFAULT_ANISKIP_BASE = 'https://api.aniskip.com/v2';
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const DEFAULT_TIMEOUT_MS = 5000;

export type AniSkipType = 'op' | 'ed' | 'mixed-op' | 'mixed-ed' | 'recap';

export interface AniSkipInterval {
  startTime: number;
  endTime: number;
}

export interface AniSkipResult {
  interval: AniSkipInterval;
  skipType: AniSkipType;
  skipId: string;
  episodeLength: number;
}

export interface GetSkipTimesResponse {
  statusCode: number;
  message: string;
  found: boolean;
  results: AniSkipResult[];
}

export interface RelationRuleFrom {
  start: number;
  end?: number;
}

export interface RelationRuleTo {
  malId: number;
  start: number;
  end?: number;
}

export interface RelationRule {
  from: RelationRuleFrom;
  to: RelationRuleTo;
}

export interface GetRelationRulesResponse {
  statusCode: number;
  message: string;
  found: boolean;
  rules: RelationRule[];
}

export interface AniSkipOptions {
  signal?: AbortSignal;
  baseUrl?: string;
  skipCache?: boolean;
  timeoutMs?: number;
}

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

let customBaseUrl: string | null = null;
let rateLimitedUntilMs = 0;

/** In-memory cache for the current session. */
const memoryCache = new Map<string, CacheEntry<unknown>>();

export function setAniSkipBaseUrl(url: string | null): void {
  customBaseUrl = url ? url.replace(/\/+$/, '') : null;
}

export function getAniSkipBaseUrl(): string {
  return customBaseUrl || DEFAULT_ANISKIP_BASE;
}

export function getRateLimitCooldown(): number {
  return Math.max(0, rateLimitedUntilMs - Date.now());
}

export function setRateLimitCooldown(ms: number): void {
  rateLimitedUntilMs = Date.now() + Math.max(0, ms);
}

export function clearAniSkipCache(): void {
  memoryCache.clear();
  try {
    if (typeof sessionStorage !== 'undefined') {
      const toRemove: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith('aniskip:')) toRemove.push(k);
      }
      for (const k of toRemove) sessionStorage.removeItem(k);
    }
  } catch {
    // sessionStorage might be restricted or unavailable
  }
  rateLimitedUntilMs = 0;
}

function readCache<T>(key: string): T | null {
  const now = Date.now();
  const mem = memoryCache.get(key);
  if (mem) {
    if (mem.expiresAt > now) return mem.data as T;
    memoryCache.delete(key);
  }

  try {
    if (typeof sessionStorage !== 'undefined') {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw) as CacheEntry<T>;
        if (parsed && typeof parsed.expiresAt === 'number' && parsed.expiresAt > now) {
          memoryCache.set(key, parsed);
          return parsed.data;
        }
        sessionStorage.removeItem(key);
      }
    }
  } catch {
    // ignore sessionStorage errors
  }

  return null;
}

function writeCache<T>(key: string, data: T, ttlMs: number = CACHE_TTL_MS): void {
  const entry: CacheEntry<T> = {
    data,
    expiresAt: Date.now() + ttlMs,
  };
  memoryCache.set(key, entry);

  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(key, JSON.stringify(entry));
    }
  } catch {
    // ignore storage quota / disabled storage
  }
}

/**
 * Maps an AniSkip API segment result to AniHubStream's Marker model.
 */
export function mapAniSkipResultToMarker(r: AniSkipResult): Marker | null {
  if (!r || !r.interval) return null;
  const start = Math.max(0, Number(r.interval.startTime) || 0);
  const end = Math.max(0, Number(r.interval.endTime) || 0);
  if (end <= start) return null;

  let kind: MarkerKind;
  let label: string;

  switch (r.skipType) {
    case 'op':
      kind = 'intro';
      label = 'Opening';
      break;
    case 'mixed-op':
      kind = 'intro';
      label = 'Mixed Opening';
      break;
    case 'ed':
      kind = 'outro';
      label = 'Ending';
      break;
    case 'mixed-ed':
      kind = 'outro';
      label = 'Mixed Ending';
      break;
    case 'recap':
      kind = 'recap';
      label = 'Recap';
      break;
    default:
      return null;
  }

  return {
    kind,
    label,
    start,
    end,
  };
}

/**
 * Checks if the given episode number matches any relation rule,
 * and if so returns the remapped MAL ID and episode number.
 */
export function applyRelationRules(
  rules: RelationRule[],
  episodeNumber: number,
): { malId?: number; episodeNumber: number } {
  if (!Array.isArray(rules) || rules.length === 0) {
    return { episodeNumber };
  }

  for (const rule of rules) {
    if (!rule || !rule.from || !rule.to) continue;
    const fromStart = Number(rule.from.start);
    const fromEnd = rule.from.end !== undefined && rule.from.end !== null ? Number(rule.from.end) : Infinity;

    if (episodeNumber >= fromStart && episodeNumber <= fromEnd) {
      const toMalId = Number(rule.to.malId);
      const toStart = Number(rule.to.start) || 1;
      const offset = episodeNumber - fromStart;
      const targetEpisode = toStart + offset;

      if (Number.isInteger(toMalId) && toMalId > 0 && targetEpisode > 0) {
        return {
          malId: toMalId,
          episodeNumber: targetEpisode,
        };
      }
    }
  }

  return { episodeNumber };
}

/**
 * Parses Retry-After header from 429 response.
 * Supports both integer seconds and HTTP Date.
 */
function parseRetryAfter(header: string | null): number {
  if (!header) return 30000; // default 30s backoff
  const sec = Number.parseInt(header, 10);
  if (Number.isFinite(sec) && sec > 0) {
    return Math.min(sec * 1000, 300000); // clamp to max 5 minutes
  }
  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) {
    const diff = dateMs - Date.now();
    return Math.min(Math.max(diff, 1000), 300000);
  }
  return 30000;
}

/**
 * Fetches episode redirection rules for a given anime MAL ID.
 * Returns empty array on 404 or errors.
 */
export async function fetchRelationRules(
  malId: number,
  options?: AniSkipOptions,
): Promise<RelationRule[]> {
  if (!malId || !Number.isInteger(malId) || malId <= 0) return [];

  const cacheKey = `aniskip:v2:rules:${malId}`;
  if (!options?.skipCache) {
    const cached = readCache<RelationRule[]>(cacheKey);
    if (cached !== null) return cached;
  }

  if (Date.now() < rateLimitedUntilMs) {
    return [];
  }

  const base = options?.baseUrl || getAniSkipBaseUrl();
  const url = `${base}/relation-rules/${encodeURIComponent(malId)}`;
  const timeout = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  const onAbort = () => controller.abort();
  if (options?.signal) {
    if (options.signal.aborted) {
      clearTimeout(timer);
      return [];
    }
    options.signal.addEventListener('abort', onAbort);
  }

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    clearTimeout(timer);
    if (options?.signal) options.signal.removeEventListener('abort', onAbort);

    if (res.status === 404) {
      writeCache(cacheKey, []);
      return [];
    }

    if (res.status === 429) {
      const waitMs = parseRetryAfter(res.headers.get('retry-after'));
      setRateLimitCooldown(waitMs);
      return [];
    }

    if (!res.ok) {
      return [];
    }

    const data = (await res.json()) as GetRelationRulesResponse;
    const rules = Array.isArray(data?.rules) ? data.rules : [];
    writeCache(cacheKey, rules);
    return rules;
  } catch {
    clearTimeout(timer);
    if (options?.signal) options.signal.removeEventListener('abort', onAbort);
    return [];
  }
}

/**
 * Fetches skip intervals for an anime episode from AniSkip v2.
 * Automatically checks and applies relation rules if available.
 */
export async function fetchSkipTimes(
  malId: number,
  episodeNumber: number,
  episodeLength?: number,
  options?: AniSkipOptions,
): Promise<Marker[]> {
  if (!malId || !Number.isInteger(malId) || malId <= 0) return [];
  if (!episodeNumber || episodeNumber <= 0) return [];

  // 1. Resolve relation rules
  let targetMalId = malId;
  let targetEp = episodeNumber;

  try {
    const rules = await fetchRelationRules(malId, options);
    const remapped = applyRelationRules(rules, episodeNumber);
    if (remapped.malId) targetMalId = remapped.malId;
    targetEp = remapped.episodeNumber;
  } catch {
    // proceed with original malId and episode
  }

  // 2. Check cache
  const roundedLength = Math.round(episodeLength || 0);
  const cacheKey = `aniskip:v2:skip:${targetMalId}:${targetEp}:${roundedLength}`;
  if (!options?.skipCache) {
    const cached = readCache<Marker[]>(cacheKey);
    if (cached !== null) return cached;
  }

  if (Date.now() < rateLimitedUntilMs) {
    return [];
  }

  // 3. Construct query
  const base = options?.baseUrl || getAniSkipBaseUrl();
  const types = ['op', 'ed', 'mixed-op', 'mixed-ed', 'recap'];
  const params = new URLSearchParams();
  for (const t of types) {
    params.append('types', t);
  }
  params.set('episodeLength', String(roundedLength));

  const url = `${base}/skip-times/${encodeURIComponent(targetMalId)}/${encodeURIComponent(targetEp)}?${params.toString()}`;
  const timeout = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  const onAbort = () => controller.abort();
  if (options?.signal) {
    if (options.signal.aborted) {
      clearTimeout(timer);
      return [];
    }
    options.signal.addEventListener('abort', onAbort);
  }

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    clearTimeout(timer);
    if (options?.signal) options.signal.removeEventListener('abort', onAbort);

    if (res.status === 404) {
      // Episode not found in AniSkip — cache negative result so we don't spam 404s
      writeCache(cacheKey, []);
      return [];
    }

    if (res.status === 429) {
      const waitMs = parseRetryAfter(res.headers.get('retry-after'));
      setRateLimitCooldown(waitMs);
      return [];
    }

    if (!res.ok) {
      return [];
    }

    const data = (await res.json()) as GetSkipTimesResponse;
    if (!data || !data.found || !Array.isArray(data.results)) {
      writeCache(cacheKey, []);
      return [];
    }

    const markers: Marker[] = [];
    for (const item of data.results) {
      const m = mapAniSkipResultToMarker(item);
      if (m) markers.push(m);
    }

    writeCache(cacheKey, markers);
    return markers;
  } catch {
    clearTimeout(timer);
    if (options?.signal) options.signal.removeEventListener('abort', onAbort);
    return [];
  }
}
