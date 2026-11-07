// @ts-check
import { curlText, curlOpen } from './tls.mjs';
import { upstreamHeaders } from './providers.mjs';

export const NEG_TTL = 6 * 3_600_000; // 6 hours negative cache
const BETA_PATH_RE = /beta\.cno\.to\/hls\/(\d+-[a-z0-9-]+)/i;

export const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Extracts the numeric AniList ID from a beta path (e.g. '113415-jujutsu-kaisen' -> 113415).
 * @param {string | null | undefined} path
 * @returns {number}
 */
export function pathAnilist(path) {
  const n = Number(String(path || '').split('-')[0]);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Checks if a beta path's numeric prefix matches the canonical anilistId.
 * @param {string | null | undefined} path
 * @param {number | string | null | undefined} anilistId
 * @returns {boolean}
 */
export function pathValid(path, anilistId) {
  const idNum = Number(anilistId);
  return Number.isFinite(idNum) && idNum > 0 && pathAnilist(path) === idNum;
}

/**
 * Score a candidate match based on title similarity, year, and AniList ID match.
 * @param {any} c
 * @param {string} title
 * @param {number} [year]
 * @returns {number}
 */
export function scoreMatch(c, title, year) {
  const a = norm(c.title?.romaji || c.title?.english || c.title?.native || c.title || c.name);
  const b = norm(title);
  if (!a || !b) return 0;

  let s = 0;
  if (a === b) s += 60;
  else if (a.startsWith(b) || b.startsWith(a)) s += 40;
  else if (a.includes(b)) s += 25;

  const t1 = new Set(a.split(' '));
  const t2 = new Set(b.split(' '));
  const inter = [...t1].filter((x) => t2.has(x)).length;
  s += 25 * (inter / Math.max(t1.size, t2.size));

  if (year && c.seasonYear && Math.abs(c.seasonYear - year) <= 1) s += 15;
  if (c.format && ['TV', 'ONA', 'OVA'].includes(c.format)) s += 5;
  return s;
}

/**
 * Probes manifest on beta CDN to check if it returns 200 and begins with #EXTM3U.
 * @param {string} path
 * @param {number} [ep=1]
 * @returns {Promise<boolean>}
 */
export async function probeManifestLiveness(path, ep = 1) {
  if (!path) return false;
  const directUrl = `https://beta.cno.to/hls/${path}/E${String(ep).padStart(4, '0')}/master.m3u8`;
  try {
    const testRes = await curlOpen(directUrl, upstreamHeaders('beta', { Accept: '*/*' }), { timeoutMs: 2500 });
    let h = '';
    for await (const chunk of testRes.stream) {
      h += chunk;
      if (h.length >= 512) break;
    }
    try { testRes.child.kill('SIGKILL'); } catch {}
    return testRes.status === 200 && h.startsWith('#EXTM3U');
  } catch {
    return false;
  }
}

/**
 * Scrapes a page slug and only trusts beta paths matching the exact AniList ID.
 * @param {string} slug
 * @param {number | string} anilistId
 * @returns {Promise<string | null>}
 */
export async function scrapePagePath(slug, anilistId) {
  const page = await curlText(
    `https://ani.pm/anime/${slug}`,
    upstreamHeaders('anipm', { accept: 'text/html' })
  ).catch(() => '');

  // The page must actually be this anime before its markup is trusted
  const canonical = page.match(/<link[^>]+rel=["']canonical["'][^>]+href=["'][^"']*\/anime\/([^"']+)/i)?.[1];
  if (canonical && canonical !== slug) return null;

  const path = page.match(BETA_PATH_RE)?.[1];
  return path && pathValid(path, anilistId) ? path : null;
}

/**
 * Exact-ID discovery with score and identity gates (Fix 3).
 * @param {number | string} anilistId
 * @param {string} title
 * @param {number} [year]
 * @returns {Promise<{ path?: string | null, title?: string, status: 'ok' | 'ambiguous' | 'unresolved' }>}
 */
export async function discoverBetaPath(anilistId, title, year) {
  const idNum = Number(anilistId);

  // 1. exact by ID query if supported upstream
  const byId = await curlText(
    `https://ani.pm/api/partner/v1/titles?id=${idNum}`,
    upstreamHeaders('anipm', { accept: 'application/json' })
  ).catch(() => null);

  if (byId) {
    try {
      const parsed = JSON.parse(byId);
      const hits = parsed.results || parsed.data || (Array.isArray(parsed) ? parsed : []);
      const hit = hits[0];
      if (hit?.betaPath && pathValid(hit.betaPath, idNum)) {
        return { path: hit.betaPath, title: hit.title, status: 'ok' };
      }
      if (hit?.slug) {
        const p = await scrapePagePath(hit.slug, idNum);
        if (p) return { path: p, title: hit.title, status: 'ok' };
      }
    } catch {}
  }

  // 2. title search — must clear BOTH the score gate and the ID gate
  const byTitle = await curlText(
    `https://ani.pm/api/partner/v1/titles?q=${encodeURIComponent(title)}`,
    upstreamHeaders('anipm', { accept: 'application/json' })
  ).catch(() => null);

  let hits = [];
  if (byTitle) {
    try {
      const parsed = JSON.parse(byTitle);
      hits = parsed.results || parsed.data || (Array.isArray(parsed) ? parsed : []);
    } catch {}
  }

  const exactHit = hits.find((h) => Number(h.anilistId) === idNum || Number(h.id) === idNum);
  if (exactHit) {
    const candidate = exactHit.betaPath || (exactHit.slug ? await scrapePagePath(exactHit.slug, idNum) : null);
    if (candidate && pathValid(candidate, idNum)) {
      return { path: candidate, title: exactHit.title || title, status: 'ok' };
    }
    // Check direct slug from exactHit title or URL
    const slugFromUrl = exactHit.url ? exactHit.url.split('/anime/')[1]?.replace(/-\d+-[a-z0-9]+$/, '') : null;
    const directSlug = slugFromUrl || norm(exactHit.title || title).replace(/\s+/g, '-');
    const directPath = `${idNum}-${directSlug}`;
    if (await probeManifestLiveness(directPath, 1)) {
      return { path: directPath, title: exactHit.title || title, status: 'ok' };
    }
  }

  const ranked = hits
    .map((h) => ({ h, s: scoreMatch(h, title, year) }))
    .sort((a, b) => b.s - a.s);

  for (const { h, s } of ranked.slice(0, 3)) {
    if (s < 55) break;
    const candidate = h.betaPath || (h.slug ? await scrapePagePath(h.slug, idNum) : null);
    if (candidate && pathValid(candidate, idNum)) {
      return { path: candidate, title: h.title, status: 'ok' };
    }
  }

  // 3. Direct probe with anilistId and title slug
  if (idNum > 0) {
    const slugName = norm(title).replace(/\s+/g, '-');
    const directPath = `${idNum}-${slugName}`;
    if (await probeManifestLiveness(directPath, 1)) {
      return { path: directPath, title, status: 'ok' };
    }
  }

  return { status: ranked.length > 0 && ranked[0].s >= 55 ? 'ambiguous' : 'unresolved' };
}

/**
 * Discovers the beta route for an anime with strict confidence and identity scoring.
 * @param {string} animeId
 * @param {string} title
 * @param {number} [anilistId]
 * @param {number} [year]
 * @returns {Promise<{ status: 'unresolved' | 'ok' | 'missing' | 'ambiguous', path?: string | null, score?: number, resolvedTitle?: string, resolvedAnilist?: number }>}
 */
export async function discoverRoute(animeId, title, anilistId, year) {
  if (!anilistId) {
    return { status: 'unresolved' };
  }

  const result = await discoverBetaPath(anilistId, title, year);
  return {
    status: result.status,
    path: result.path || null,
    resolvedTitle: result.title || title,
    resolvedAnilist: Number(anilistId),
  };
}

/**
 * Universal query helper that works on both Cloudflare D1 and Node.js DatabaseSync.
 */
async function queryFirst(db, sql, params = []) {
  if (typeof db.prepare === 'function') {
    const stmt = db.prepare(sql);
    if (typeof stmt.bind === 'function') {
      const bound = stmt.bind(...params);
      if (typeof bound.first === 'function') return await bound.first();
      if (typeof bound.get === 'function') return bound.get();
      if (typeof bound.all === 'function') {
        const res = await bound.all();
        return Array.isArray(res) ? res[0] : res?.results?.[0];
      }
    }
    if (typeof stmt.get === 'function') return stmt.get(...params);
    if (typeof stmt.all === 'function') {
      const res = stmt.all(...params);
      return Array.isArray(res) ? res[0] : res?.results?.[0];
    }
  }
  return null;
}

/**
 * Universal execute helper that works on both Cloudflare D1 and Node.js DatabaseSync.
 */
async function executeSql(db, sql, params = []) {
  if (typeof db.prepare === 'function') {
    const stmt = db.prepare(sql);
    if (typeof stmt.bind === 'function') {
      const bound = stmt.bind(...params);
      if (typeof bound.run === 'function') return await bound.run();
    }
    if (typeof stmt.run === 'function') return stmt.run(...params);
  }
}

/**
 * Probes Beta endpoint for readiness with strict 2500ms timeout and negative caching.
 * @param {any} db
 * @param {string} animeId
 * @param {string} path
 * @param {number} ep
 * @param {number} [anilistId]
 * @param {string} [discoveredTitle]
 * @returns {Promise<boolean>}
 */
export async function betaReady(db, animeId, path, ep, anilistId, discoveredTitle) {
  if (!path) return false;

  // Enforce identity invariant: path numeric prefix MUST match anilistId
  if (anilistId && !pathValid(path, anilistId)) {
    await executeSql(
      db,
      `UPDATE provider_route SET status='unresolved', path=NULL, checked_at=NULL WHERE anime_id=? AND server='beta'`,
      [animeId]
    );
    return false;
  }

  const row = await queryFirst(
    db,
    `SELECT status, checked_ep, checked_at FROM provider_route
     WHERE anime_id=? AND provider_id='anipm' AND server='beta'`,
    [animeId]
  );

  if (row?.status === 'missing' && row.checked_ep === ep && Date.now() - (row.checked_at || 0) < NEG_TTL) {
    return false;
  }

  const url = `https://beta.cno.to/hls/${path}/E${String(ep).padStart(4, '0')}/master.m3u8`;

  let r;
  try {
    r = await curlOpen(url, upstreamHeaders('beta', { Accept: '*/*' }), { timeoutMs: 2500 });
  } catch {
    await markMissing(db, animeId, ep);
    return false;
  }

  let head = '';
  for await (const c of r.stream) {
    head += c;
    if (head.length >= 512) break;
  }
  try {
    r.child.kill('SIGKILL');
  } catch {}

  // Transient upstream errors — do NOT poison the route
  if (r.status === 429 || r.status === 502 || r.status === 503) {
    return false;
  }

  if (r.status !== 200 || !head.startsWith('#EXTM3U')) {
    await markMissing(db, animeId, ep);
    return false;
  }

  await executeSql(
    db,
    `INSERT INTO provider_route (anime_id, provider_id, server, path, status, checked_ep, checked_at, resolved_anilist, resolved_title)
     VALUES (?, 'anipm', 'beta', ?, 'ok', ?, ?, ?, ?)
     ON CONFLICT(anime_id, provider_id, server) DO UPDATE SET
       path=excluded.path,
       status='ok',
       checked_ep=excluded.checked_ep,
       checked_at=excluded.checked_at,
       resolved_anilist=coalesce(excluded.resolved_anilist, provider_route.resolved_anilist),
       resolved_title=coalesce(excluded.resolved_title, provider_route.resolved_title)`,
    [animeId, path, ep, Date.now(), anilistId || pathAnilist(path) || null, discoveredTitle || null]
  );

  return true;
}

export async function markMissing(db, animeId, ep) {
  await executeSql(
    db,
    `INSERT INTO provider_route (anime_id, provider_id, server, status, checked_ep, checked_at)
     VALUES (?, 'anipm', 'beta', 'missing', ?, ?)
     ON CONFLICT(anime_id, provider_id, server) DO UPDATE SET
       status='missing',
       checked_ep=excluded.checked_ep,
       checked_at=excluded.checked_at`,
    [animeId, ep, Date.now()]
  );
  return false;
}

export async function upsertRoute(db, animeId, route) {
  if (!route) return;
  await executeSql(
    db,
    `INSERT INTO provider_route (anime_id, provider_id, server, path, status, checked_at, resolved_anilist, resolved_title)
     VALUES (?, 'anipm', 'beta', ?, ?, ?, ?, ?)
     ON CONFLICT(anime_id, provider_id, server) DO UPDATE SET
       path=coalesce(excluded.path, provider_route.path),
       status=excluded.status,
       checked_at=excluded.checked_at,
       resolved_anilist=coalesce(excluded.resolved_anilist, provider_route.resolved_anilist),
       resolved_title=coalesce(excluded.resolved_title, provider_route.resolved_title)`,
    [animeId, route.path || null, route.status || 'unresolved', Date.now(), route.resolvedAnilist || null, route.resolvedTitle || null]
  );
}
