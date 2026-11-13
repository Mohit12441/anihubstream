/* Shared helpers for the AniHubStream Pages Functions.
   Files under functions/ that start with "_" are never routed, so this module
   is private to the /api/* handlers. */

const VIEWER_COOKIE = 'anihub_viewer';
const VIEWER_AGE = 60 * 60 * 24 * 730; // two years — the library is meant to survive

export const json = (data, { status = 200, cache = 'no-store', isPrivate = false, headers = {} } = {}) => {
  const isPublic = !isPrivate && cache.includes('public');
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': cache,
      vary: isPublic ? 'Accept-Encoding' : 'Cookie',
      ...headers,
    },
  });
};

export const ok = (data, opts = {}) => json(data, { cache: 'public, max-age=60', ...opts });
export const fail = (status, code, message) => json({ error: code, message }, { status });

/* --- Zero-Read Edge & In-Memory Shield ----------------------------------- */
const devMemoryCache = new Map();
const inFlightRequests = new Map();

export function clearEdgeMemoryCache() {
  devMemoryCache.clear();
  inFlightRequests.clear();
}

function normalizeCacheKey(requestUrl, allowedParams) {
  const url = new URL(requestUrl);
  const cleanParams = new URLSearchParams();
  if (Array.isArray(allowedParams)) {
    for (const key of allowedParams) {
      if (url.searchParams.has(key)) {
        cleanParams.set(key, url.searchParams.get(key).toLowerCase().trim());
      }
    }
  } else {
    const keys = Array.from(url.searchParams.keys()).sort();
    for (const k of keys) {
      if (!k.startsWith('utm_') && k !== '_' && k !== 'fbclid') {
        cleanParams.set(k, url.searchParams.get(k).trim());
      }
    }
  }
  cleanParams.sort();
  const search = cleanParams.toString();
  return `${url.origin}${url.pathname}${search ? '?' + search : ''}`;
}

export async function withEdgeCache(request, env, ttlSeconds, computeFn, { allowedParams = null, waitUntil = null } = {}) {
  if (!request || request.method !== 'GET') {
    return computeFn();
  }

  const url = new URL(request.url);
  const bypass = url.searchParams.get('bypass') === '1' || request.headers?.get?.('x-bypass-cache') === '1';
  if (bypass) {
    const fresh = await computeFn();
    fresh.headers.set('X-D1-Read', '1-d1-bypassed');
    return fresh;
  }

  const normalizedUrl = normalizeCacheKey(request.url, allowedParams);
  const hasCloudflareCache = typeof caches !== 'undefined' && caches.default;
  const cacheKeyReq = new Request(normalizedUrl, { method: 'GET' });

  // 1. Check Cloudflare Edge Cache (Production)
  if (hasCloudflareCache) {
    try {
      const match = await caches.default.match(cacheKeyReq);
      if (match) {
        const hit = new Response(match.body, match);
        hit.headers.set('X-D1-Read', '0-edge-cache-hit');
        return hit;
      }
    } catch {
      // Ignore cache match errors and fallback
    }
  } else {
    // Local Dev In-Memory Cache
    const devItem = devMemoryCache.get(normalizedUrl);
    if (devItem && Date.now() < devItem.expires) {
      const hit = new Response(devItem.body, {
        status: devItem.status,
        headers: new Headers(devItem.headers),
      });
      hit.headers.set('X-D1-Read', '0-dev-memory-hit');
      return hit;
    }
  }

  // 2. In-Flight Single-Flight (prevents cache stampede / concurrent duplicate D1 queries)
  let computePromise = inFlightRequests.get(normalizedUrl);
  let isPiggyback = false;

  if (computePromise) {
    isPiggyback = true;
  } else {
    computePromise = (async () => {
      try {
        return await computeFn();
      } finally {
        inFlightRequests.delete(normalizedUrl);
      }
    })();
    inFlightRequests.set(normalizedUrl, computePromise);
  }

  const freshRes = await computePromise;
  if (!freshRes) return freshRes;

  const responseToCache = freshRes.clone();

  if (isPiggyback) {
    const piggybackRes = new Response(responseToCache.body, responseToCache);
    piggybackRes.headers.set('X-D1-Read', '0-inflight-piggyback');
    return piggybackRes;
  }

  // 3. Populate Cache if successful (200 OK)
  if (responseToCache.status === 200) {
    let effectiveTtl = ttlSeconds;
    const existingCacheControl = responseToCache.headers.get('Cache-Control');
    if (existingCacheControl) {
      const match = existingCacheControl.match(/s-maxage=(\d+)/i) || existingCacheControl.match(/max-age=(\d+)/i);
      if (match) {
        effectiveTtl = Number(match[1]);
      }
    }

    const publicHeaders = new Headers(responseToCache.headers);
    publicHeaders.set(
      'Cache-Control',
      `public, max-age=${effectiveTtl}, s-maxage=${effectiveTtl}, stale-while-revalidate=300`
    );
    publicHeaders.set('Vary', 'Accept-Encoding');
    publicHeaders.delete('Set-Cookie'); // Crucial: Set-Cookie prevents CDN caching!
    publicHeaders.set('X-D1-Read', '1-d1-fresh');

    const cachedResponse = new Response(responseToCache.body, {
      status: responseToCache.status,
      statusText: responseToCache.statusText,
      headers: publicHeaders,
    });

    if (hasCloudflareCache) {
      const putPromise = caches.default.put(cacheKeyReq, cachedResponse.clone()).catch(() => {});
      if (waitUntil) waitUntil(putPromise);
      else await putPromise;
    } else {
      try {
        const bodyText = await cachedResponse.clone().text();
        devMemoryCache.set(normalizedUrl, {
          body: bodyText,
          status: cachedResponse.status,
          headers: Object.fromEntries(cachedResponse.headers.entries()),
          expires: Date.now() + effectiveTtl * 1000,
        });
      } catch {}
    }

    return cachedResponse;
  }

  return responseToCache;
}


function cookieHeader(request) {
  return request.headers.get('cookie') || request.headers.get('Cookie') || '';
}

export function readViewerId(request) {
  for (const part of cookieHeader(request).split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== VIEWER_COOKIE) continue;
    const value = decodeURIComponent(part.slice(eq + 1).trim());
    // An id we minted is always a UUID; anything else is a forged or stale cookie.
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : null;
  }
  return null;
}

/* The home page fires its library and positions reads in parallel, so a GET must not
   mint an id — two racing GETs would create two viewers and orphan one. Reads look up
   the existing id only; writes are where a viewer is created. */
export async function existingViewer(env, request) {
  const id = readViewerId(request);
  if (!id) return null;
  const row = await env.ANIHUB.prepare('SELECT id FROM viewer WHERE id = ?1').bind(id).first();
  return row ? row.id : null;
}

/* A viewer is an anonymous row keyed by an HttpOnly cookie — no account, no
   localStorage, nothing personally identifying. */

/* The site answers on more than one hostname (anihubstream.com and the tunnel's
   app.anihubstream.com). A host-only cookie mints a different viewer per hostname, so the
   same person gets two My Lists and two resume histories. Domain=<apex> makes it one
   viewer across the zone; on any other host (localhost in dev) a Domain attribute would be
   rejected by the browser, so it is left off there. */
const SHARED_COOKIE_DOMAINS = ['anihubstream.com'];

const cookieDomain = (request) => {
  const host = new URL(request.url).hostname;
  return SHARED_COOKIE_DOMAINS.find((d) => host === d || host.endsWith(`.${d}`)) ?? null;
};

export async function getViewer(env, request) {
  const existing = readViewerId(request);
  if (existing) {
    const row = await env.ANIHUB.prepare('SELECT id FROM viewer WHERE id = ?1').bind(existing).first();
    if (row) return { id: row.id, setCookie: null };
  }
  const id = crypto.randomUUID();
  await env.ANIHUB.prepare('INSERT INTO viewer (id) VALUES (?1)').bind(id).run();
  const domain = cookieDomain(request);
  const attributes = [
    `${VIEWER_COOKIE}=${id}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${VIEWER_AGE}`,
    'Secure',
    ...(domain ? [`Domain=${domain}`] : []),
  ];
  return { id, setCookie: attributes.join('; ') };
}

export const withViewer = (response, setCookie) => {
  if (setCookie) response.headers.append('set-cookie', setCookie);
  return response;
};

/* --- row -> model ------------------------------------------------------- */

const splitGenres = (ids) => (ids ? ids.split(',') : []);

const safeJsonParse = (str, fallback) => {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
};

export const resolveMalId = (sourceIdsRaw, skipKeyId, skipKeySpace) => {
  if (sourceIdsRaw) {
    try {
      const parsed = typeof sourceIdsRaw === 'string' ? JSON.parse(sourceIdsRaw) : sourceIdsRaw;
      if (parsed && typeof parsed.mal === 'number' && Number.isInteger(parsed.mal) && parsed.mal > 0) {
        return parsed.mal;
      }
    } catch {}
  }
  if (skipKeySpace === 'mal') {
    const keyId = typeof skipKeyId === 'number' ? skipKeyId : Number.parseInt(skipKeyId, 10);
    if (Number.isInteger(keyId) && keyId > 0) {
      return keyId;
    }
  }
  return null;
};

const RESERVED_TITLE_WORDS = /^(season|part|cour|act|episode|vol|volume|movie|ova|ona|special|final|first|second|third|fourth|order|zero|live|climax|deluxe|edition)$/i;
const COMMON_6_LETTER = /^(action|attack|heroes|dragon|naruto|hunter|clover|haikyu|magica|kamui|sailor|online|future|school|prince|summer|winter|spring|autumn|master|legend|island|family|sister|puzzle|spiral|knight|border|heaven|secret|shadow|spirit|silver|golden|yellow|orange|purple|violet|cinema|circus|studio|reborn|border|planet|galaxy|origin|battle|castle|flight|zombie|vampire)$/i;

const isHashToken = (token) => {
  const clean = token.trim();
  if (RESERVED_TITLE_WORDS.test(clean)) return false;
  if (clean.length < 4 || clean.length > 8) return false;
  if (/\d/.test(clean)) return true;
  if (/^[b-df-hj-np-tv-z]{4,8}$/i.test(clean)) return true;
  return false;
};

export const cleanDisplayTitle = (t) => {
  if (!t || typeof t !== 'string') return '';
  return t
    .replace(/\s+([a-z0-9]{4,8})\s*([-–—]\s*(?:episode|ep|part|season|vol|volume)\b.*)$/i, (match, code, rest) => {
      if (isHashToken(code)) return ' ' + rest;
      return match;
    })
    .replace(/\s*[-–—]?\s*([a-z0-9]{4,8})$/i, (match, code) => {
      if (isHashToken(code)) return '';
      return match;
    })
    .trim();
};

export const cardFromRow = (r) => ({
  id: r.id,
  title: cleanDisplayTitle(r.title),
  native: r.native,
  year: r.year,
  rating: r.rating != null && r.rating > 0 ? Number((r.rating > 10 ? r.rating / 10 : r.rating).toFixed(1)) : 0,
  season: r.season,
  kind: r.kind,
  status: r.status,
  genres: splitGenres(r.genre_ids),
  art: r.art,
  keyArt: r.key_art,
  accent: r.accent,
  synopsis: r.synopsis,
  rank: r.rank ?? null,
  trendRank: r.trend_rank ?? null,
  altSeasons: r.alt_seasons ? safeJsonParse(r.alt_seasons, []) : [],
  seasons: r.seasons ? (typeof r.seasons === 'string' ? safeJsonParse(r.seasons, []) : r.seasons) : [],
  sched_sub_at: r.sched_sub_at ?? null,
  sched_dub_at: r.sched_dub_at ?? null,
  schedule:
    r.sched_day === null || r.sched_day === undefined
      ? null
      : {
          day: r.sched_day,
          dayLabel: r.sched_day_label,
          date: r.sched_date,
          time: r.sched_time,
          season: r.sched_season,
          episode: r.sched_episode ?? null,
          subAt: r.sched_sub_at ?? null,
          dubAt: r.sched_dub_at ?? null,
        },
  episodeCount: r.episode_count,
  episodeTotal: r.episode_total ?? null,
  malId: resolveMalId(r.source_ids, r.skip_key_id, r.skip_key_space),
  sourceIds: r.source_ids ? (typeof r.source_ids === 'string' ? safeJsonParse(r.source_ids, null) : r.source_ids) : null,
  skipKeyId: r.skip_key_id ?? null,
  skipKeySpace: r.skip_key_space ?? null,
});

export const episodeFromRow = (r, fallbackArt = '') => {
  const thumb = r.thumb || fallbackArt || '';
  return {
    id: r.id,
    n: r.n,
    title: r.title,
    runtime: r.runtime,
    runtimeSeconds: r.runtime_seconds,
    art: thumb,
    thumb: thumb,
    synopsis: r.synopsis || '',
    markers: safeJsonParse(r.markers, []),
    airdate: r.airdate ?? null,
    external_id: r.external_id ?? null,
  };
};



export async function resolveFranchiseSeasons(db, card) {
  if (!db || !card) return [];

  const seasonsMap = new Map();
  const currentTitle = cleanDisplayTitle(card.title);

  seasonsMap.set(card.id, {
    id: card.id,
    title: currentTitle,
    season: card.season || '',
    year: card.year || null,
    kind: card.kind || 'TV',
    poster: card.art || card.key_art || null,
    rating: card.rating || null,
    relationType: 'current',
    chronologyOrder: card.chronology_order ?? card.year ?? 0,
    isCurrent: true,
  });

  // 0. Primary indexed query: Check pre-indexed anime_franchise_relation in D1
  try {
    const { results: dbRelations } = await db.prepare(
      `SELECT r.related_id, a.id, a.title, a.season, a.year, a.kind, a.art, a.key_art, a.rating,
              r.relation_type, r.chronology_order
       FROM anime_franchise_relation r
       JOIN anime a ON a.id = r.related_id
       WHERE r.anime_id = ?1
       ORDER BY r.chronology_order ASC, a.year ASC`
    ).bind(card.id).all().catch(() => ({ results: [] }));

    if (Array.isArray(dbRelations) && dbRelations.length > 0) {
      for (const rel of dbRelations) {
        if (!seasonsMap.has(rel.id)) {
          seasonsMap.set(rel.id, {
            id: rel.id,
            title: cleanDisplayTitle(rel.title),
            season: rel.season || '',
            year: rel.year || null,
            kind: rel.kind || 'TV',
            poster: rel.art || rel.key_art || null,
            rating: rel.rating || null,
            relationType: rel.relation_type || 'sequel',
            chronologyOrder: rel.chronology_order || rel.year || 0,
            isCurrent: false,
          });
        }
      }
    }
  } catch {}

  // 1. Direct alt_seasons parsing
  let altList = [];
  if (card.alt_seasons) {
    try {
      altList = typeof card.alt_seasons === 'string' ? safeJsonParse(card.alt_seasons, []) : card.alt_seasons;
    } catch {}
  }
  if (!Array.isArray(altList)) altList = [];

  for (const altTitle of altList) {
    if (!altTitle || typeof altTitle !== 'string') continue;
    const cleanedTitle = cleanDisplayTitle(altTitle.replace(/\s*\(\d{4}\)$/, '').trim());
    if (!cleanedTitle) continue;

    try {
      const match = await db.prepare(
        'SELECT id, title, season, year, kind, art, key_art, rating FROM anime WHERE lower(title) = lower(?1) LIMIT 1'
      ).bind(cleanedTitle).first().catch(() => null);
      if (match && !seasonsMap.has(match.id)) {
        const isMovie = (match.kind || '').toLowerCase() === 'movie';
        const relType = isMovie ? 'movie' : ((match.year || 0) >= (card.year || 0) ? 'sequel' : 'prequel');
        seasonsMap.set(match.id, {
          id: match.id,
          title: cleanDisplayTitle(match.title),
          season: match.season || '',
          year: match.year || null,
          kind: match.kind || 'TV',
          poster: match.art || match.key_art || null,
          rating: match.rating || null,
          relationType: relType,
          chronologyOrder: match.year || 0,
          isCurrent: false,
        });
      } else if (!match) {
        const fallbackSlug = cleanedTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        if (fallbackSlug && !seasonsMap.has(fallbackSlug)) {
          const yearMatch = altTitle.match(/\((\d{4})\)/);
          const matchedYear = yearMatch ? Number.parseInt(yearMatch[1], 10) : null;
          seasonsMap.set(fallbackSlug, {
            id: fallbackSlug,
            title: cleanedTitle,
            season: yearMatch ? ('Year ' + yearMatch[1]) : '',
            year: matchedYear,
            kind: 'TV',
            poster: null,
            rating: null,
            relationType: (matchedYear || 0) >= (card.year || 0) ? 'sequel' : 'prequel',
            chronologyOrder: matchedYear || 0,
            isCurrent: false,
          });
        }
      }
    } catch {}
  }

  // 2. Inverse check: find anime records whose alt_seasons contains this title
  try {
    if (currentTitle && currentTitle.length >= 4) {
      const { results: inverseMatches } = await db.prepare(
        'SELECT id, title, season, year, kind, art, key_art, rating FROM anime WHERE alt_seasons LIKE ?1 LIMIT 6'
      ).bind('%' + currentTitle + '%').all().catch(() => ({ results: [] }));
      for (const m of inverseMatches || []) {
        if (!seasonsMap.has(m.id)) {
          const isMovie = (m.kind || '').toLowerCase() === 'movie';
          const relType = isMovie ? 'movie' : ((m.year || 0) >= (card.year || 0) ? 'sequel' : 'prequel');
          seasonsMap.set(m.id, {
            id: m.id,
            title: cleanDisplayTitle(m.title),
            season: m.season || '',
            year: m.year || null,
            kind: m.kind || 'TV',
            poster: m.art || m.key_art || null,
            rating: m.rating || null,
            relationType: relType,
            chronologyOrder: m.year || 0,
            isCurrent: false,
          });
        }
      }
    }
  } catch {}

  // 3. Hierarchical slug prefix lookup (e.g. "jujutsu-kaisen", "my-hero-academia", "demon-slayer", "fullmetal-alchemist", "naruto")
  try {
    const baseSlug = card.id
      .replace(/-(?:season|part|cour|act|vol|volume)-\d+.*$/i, '')
      .replace(/-(?:final-season|2nd-season|3rd-season|4th-season|the-movie|movie|arc|brotherhood|shippuden|z|super|re|root-a|specials?|ova-collection|ovas?|picture-drama|4-koma-theater|reflections|the-sacred-star-of-milos|slaying-the-blood-progenitor).*$/i, '')
      .replace(/-[a-z0-9]{4}$/i, '')
      .replace(/-0$/, '');

    if (baseSlug && baseSlug.length >= 4) {
      const { results: slugSiblings } = await db.prepare(
        'SELECT id, title, season, year, kind, art, key_art, rating FROM anime WHERE (id = ?1 OR id LIKE ?2) AND kind IN (\'TV\', \'Movie\', \'ONA\', \'OVA\', \'Special\') LIMIT 15'
      ).bind(baseSlug, baseSlug + '-%').all().catch(() => ({ results: [] }));
      for (const s of slugSiblings || []) {
        if (!seasonsMap.has(s.id)) {
          const isMovie = (s.kind || '').toLowerCase() === 'movie';
          const relType = isMovie ? 'movie' : ((s.year || 0) >= (card.year || 0) ? 'sequel' : 'prequel');
          seasonsMap.set(s.id, {
            id: s.id,
            title: cleanDisplayTitle(s.title),
            season: s.season || '',
            year: s.year || null,
            kind: s.kind || 'TV',
            poster: s.art || s.key_art || null,
            rating: s.rating || null,
            relationType: relType,
            chronologyOrder: s.year || 0,
            isCurrent: s.id === card.id,
          });
        }
      }
    }
  } catch {}

  // Deduplicate by normalized title to prevent hash-slug duplicates (e.g. -6pb0, -5iet)
  const dedupedByTitle = new Map();
  for (const item of seasonsMap.values()) {
    const key = item.title.toLowerCase().trim();
    if (!dedupedByTitle.has(key)) {
      dedupedByTitle.set(key, item);
    } else {
      const existing = dedupedByTitle.get(key);
      // Prefer current active card, or prefer canonical slug without random 4-char hash
      if (item.isCurrent) {
        dedupedByTitle.set(key, item);
      } else if (!existing.isCurrent && /-[a-z0-9]{4}$/i.test(existing.id) && !/-[a-z0-9]{4}$/i.test(item.id)) {
        dedupedByTitle.set(key, item);
      }
    }
  }

  const items = Array.from(dedupedByTitle.values());
  if (items.length <= 1) return [];

  // Sort chronologically: by release year ascending, then chronology order, then title
  items.sort((a, b) => {
    if (a.year && b.year && a.year !== b.year) {
      return a.year - b.year;
    }
    const ca = a.chronologyOrder ?? 0;
    const cb = b.chronologyOrder ?? 0;
    if (ca !== cb) return ca - cb;
    return a.title.localeCompare(b.title);
  });

  return items;
}

export const KNOWN_PROVIDER_REGEX = /^(?:hianime|anikoto|aniwatch|watchanimeworld|animewave|animekai|anipm|anidisk|animeflv|hdrezka|jkanime|animedubhindi|desidubanime|torrent):/i;

const stripHashToken = (s) => {
  const m = s.match(/-([a-z0-9]{4,8})$/i);
  if (m && isHashToken(m[1])) {
    return s.slice(0, -m[0].length);
  }
  return s;
};

export const deriveSlugCandidates = (id) => {
  if (!id || typeof id !== 'string') return [];
  const rawSlug = id.replace(KNOWN_PROVIDER_REGEX, '').trim();
  const rawSlugNoHash = stripHashToken(rawSlug);
  const cleanSlug = rawSlug.replace(/:+/g, '-');
  const cleanSlugNoHash = stripHashToken(cleanSlug);
  const normalizedNoHash = cleanSlugNoHash.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const normalizedRaw = rawSlug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const seasonFromOrdinal = normalizedNoHash.replace(/(\d+)(?:st|nd|rd|th)-season/i, (m, n) => `season-${n}`);
  const ordinalFromSeason = normalizedNoHash.replace(/season-(\d+)/i, (m, n) => {
    const suf = n === '1' ? '1st' : n === '2' ? '2nd' : n === '3' ? '3rd' : `${n}th`;
    return `${suf}-season`;
  });

  return Array.from(new Set([
    id,
    rawSlug,
    rawSlugNoHash,
    cleanSlug,
    cleanSlugNoHash,
    normalizedNoHash,
    normalizedRaw,
    seasonFromOrdinal,
    ordinalFromSeason,
  ].filter(Boolean)));
};

export const findAnimeByCandidates = async (db, candidates) => {
  if (!db || !Array.isArray(candidates) || candidates.length === 0) return null;
  for (const cand of candidates) {
    const card = await db.prepare(`SELECT ${CARD_COLUMNS} FROM anime a WHERE a.id = ?1`).bind(cand).first().catch(() => null);
    if (card) return card;
  }
  for (const cand of candidates) {
    const redirected = await db.prepare(`SELECT to_id FROM anime_redirect WHERE from_id = ?1 LIMIT 1`).bind(cand).first().catch(() => null);
    if (redirected?.to_id) {
      const card = await db.prepare(`SELECT ${CARD_COLUMNS} FROM anime a WHERE a.id = ?1`).bind(redirected.to_id).first().catch(() => null);
      if (card) return card;
    }
  }
  for (const cand of candidates) {
    let mapped = await db.prepare(
      `SELECT anime_id FROM anime_provider_mapping WHERE provider_slug = ?1 LIMIT 1`
    ).bind(cand).first().catch(() => null);

    if (!mapped?.anime_id) {
      mapped = await db.prepare(
        `SELECT anime_id FROM anime_id_map
         WHERE anikoto_slug = ?1 OR hianime_slug = ?1 OR aniwatch_slug = ?1
         LIMIT 1`
      ).bind(cand).first().catch(() => null);
    }

    if (mapped?.anime_id) {
      const card = await db.prepare(`SELECT ${CARD_COLUMNS} FROM anime a WHERE a.id = ?1`).bind(mapped.anime_id).first().catch(() => null);
      if (card) return card;
    }
  }
  return null;
};

export const CARD_COLUMNS = `
  a.id, a.title, a.native, a.year, a.rating, a.season, a.kind, a.status,
  a.art, a.key_art, a.accent, a.synopsis, a.rank, a.trend_rank, a.alt_seasons,
  a.sched_day, a.sched_day_label, a.sched_date, a.sched_time, a.sched_season, a.sched_episode,
  a.sched_sub_at, a.sched_dub_at,
  a.episode_total, a.source_ids, a.skip_key_id, a.skip_key_space,
  (SELECT group_concat(genre_id) FROM anime_genre ag WHERE ag.anime_id = a.id) AS genre_ids,
  (SELECT count(*) FROM episode e WHERE e.anime_id = a.id) AS episode_count
`;

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const errorResponse = (err) =>
  err instanceof HttpError
    ? fail(err.status, err.code, err.message)
    : (reportFault(err), fail(500, 'internal', 'unexpected error serving this request'));

/* A viewer should not see a stack trace, but a 500 whose only record is that word cannot be
   diagnosed by anyone. The reason goes to the runtime log — printed by `pages dev` and streamed
   by Pages Analytics/Tail on the hosted site. */
const reportFault = (err) => {
  console.error('[anihub] unexpected failure:', err?.stack ?? err?.message ?? String(err));
};

export const intParam = (url, name, min, max, fallback) => {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) throw new HttpError(400, 'bad_request', `${name} must be an integer`);
  return Math.min(max, Math.max(min, n));
};

export const strParam = (url, name, max = 64) => {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === '') return null;
  if (raw.length > max) throw new HttpError(400, 'bad_request', `${name} is too long`);
  return raw;
};

/**
 * Parses variant renditions from an HLS master playlist
 * @param {string} text
 * @param {string} baseUrl
 * @returns {Array<{ quality: string, bandwidth: number, url: string }>}
 */
export function parseMasterVariants(text, baseUrl) {
  const lines = text.split(/\r?\n/);
  const renditions = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;

    const resMatch = line.match(/RESOLUTION=\d+x(\d+)/i);
    const bwMatch = line.match(/BANDWIDTH=(\d+)/i);
    const height = resMatch ? `${resMatch[1]}p` : 'unknown';
    const bandwidth = bwMatch ? Number(bwMatch[1]) : 0;

    let nextUrl = '';
    for (let j = i + 1; j < lines.length; j++) {
      const candidate = lines[j].trim();
      if (!candidate || candidate.startsWith('#')) continue;
      nextUrl = candidate;
      break;
    }

    if (nextUrl) {
      const fullUrl = nextUrl.startsWith('http') ? nextUrl : new URL(nextUrl, baseUrl).href;
      renditions.push({ quality: height, bandwidth, url: fullUrl });
    }
  }

  return renditions.sort((a, b) => {
    const numA = parseInt(a.quality, 10) || 0;
    const numB = parseInt(b.quality, 10) || 0;
    return numB - numA || b.bandwidth - a.bandwidth;
  });
}

/**
 * Parses media segments from a media playlist
 * @param {string} text
 * @param {string} baseUrl
 * @returns {string[]}
 */
export function parseMediaSegments(text, baseUrl) {
  const lines = text.split(/\r?\n/);
  const segments = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    const fullUrl = line.startsWith('http') ? line : new URL(line, baseUrl).href;
    segments.push(fullUrl);
  }

  return segments;
}

/* --- search matching ----------------------------------------------------
   Mirrors src/state/catalogue.tsx (foldSearch / matchScore / scoreSearchRow)
   so a server-paged search ranks exactly like the client-only one did.
   tools/sync-catalogue.mjs also imports foldSearch from here to build the
   stored a.search_text column, keeping the fold identical everywhere. */

export const foldSearch = (s) =>
  String(s)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/* Higher is better: whole field > whole word > field prefix > word initials
   (fandom shorthand like "op" or "mha") > word prefix > plain substring. */
export const matchScore = (text, token) => {
  if (!text) return 0;
  if (text === token) return 100;
  const words = text.split(' ');
  if (words.includes(token)) return 80;
  if (text.startsWith(token)) return 70;
  if (words.length > 1 && words.map((w) => w[0]).join('') === token) return 60;
  if (words.some((w) => w.startsWith(token))) return 50;
  return text.includes(token) ? 20 : 0;
};

/* The LIKE pattern that matches the same word-initials shorthand ("mha" →
   'm% h% a%') well enough to be a prefilter superset of matchScore's 60-case. */
export const initialsPattern = (token) =>
  token.length >= 2 && token.length <= 16
    ? [...token].map((c, i) => (i ? ' ' : '') + c + '%').join('')
    : null;

/* D1 enforces a strict 50-byte maximum limit on LIKE and GLOB expressions.
   Truncates the interior search term to ensure '%term%' never exceeds maxBytes. */
export const safeLikePattern = (text, maxBytes = 50) => {
  if (!text) return '%%';
  const chars = [...String(text).toLowerCase()];
  let end = chars.length;
  const encoder = new TextEncoder();
  while (end > 0 && encoder.encode('%' + chars.slice(0, end).join('') + '%').length > maxBytes) {
    end -= 1;
  }
  return '%' + chars.slice(0, end).join('') + '%';
};

/* Scored exactly like the client matcher: every token must hit some field
   (AND), title/native weigh most, an exact or prefix title match is boosted. */
export const scoreSearchRow = (row, folded, tokens, genreLabels) => {
  const fields = [
    [foldSearch(row.title), 10],
    [foldSearch(row.native), 6],
    [String(row.kind).toLowerCase(), 2],
    [String(row.status).toLowerCase(), 2],
    [row.genre_ids ? row.genre_ids.split(',').map((g) => foldSearch(genreLabels.get(g) ?? g)).join(' ') : '', 3],
  ];
  let score = 0;
  for (const t of tokens) {
    let best = 0;
    for (const [text, weight] of fields) {
      const m = matchScore(text, t) * weight;
      if (m > best) best = m;
    }
    if (!best) return 0;
    score += best;
  }
  const title = fields[0][0];
  if (title === folded) score += 120;
  else if (title.startsWith(folded)) score += 40;
  return score;
};

export function formatServerName(provider, serverId) {
  const provNames = {
    anikoto: 'AniKoto',
    hianime: 'HiAnime',
    aniwatch: 'AniWatch',
    anipm: 'AniPM',
    torrent: 'P2P Swarm',
  };
  const base = provNames[provider?.toLowerCase()] || (provider ? provider.toUpperCase() : 'Server');
  if (!serverId || serverId === 'default') return base;
  const cleanServer = String(serverId).replace(/^.*?\s*·\s*/, '').trim();
  return `${base} · ${cleanServer}`;
}

export function buildAudioTracks(audio) {
  if (audio === 'hindi') {
    return [
      { id: 'hin', language: 'hi', label: 'Hindi (Multi-Audio)', default: true },
      { id: 'ja', language: 'ja', label: 'Japanese (Original)', default: false },
    ];
  }
  if (audio === 'spanish') {
    return [
      { id: 'es', language: 'es', label: 'Spanish (Latino/Castellano)', default: true },
      { id: 'ja', language: 'ja', label: 'Japanese (Original)', default: false },
    ];
  }
  if (audio === 'russian') {
    return [
      { id: 'ru', language: 'ru', label: 'Russian (Multi-Voice)', default: true },
      { id: 'ja', language: 'ja', label: 'Japanese (Original)', default: false },
    ];
  }
  if (audio === 'dub') {
    return [
      { id: 'en', language: 'en', label: 'English Dub', default: true },
      { id: 'ja', language: 'ja', label: 'Japanese (Original)', default: false },
    ];
  }
  return [
    { id: 'ja', language: 'ja', label: 'Japanese (Original)', default: true },
  ];
}

import { parseMaster } from '../../lib/m3u8.mjs';
export { parseMaster };

const BETA_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const POSITIVE_TTL_MS = 30 * 60_000;
const NEGATIVE_TTL_MS = 60 * 60_000;

const slugify = (s) =>
  String(s || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');

export async function resolveBetaAudioTracks(env, resolvedAnilistId, meta, ep, audio, request = null) {
  const audioType = audio === 'dub' || audio === 'hindi' ? audio : 'sub';
  const epPadded = String(ep).padStart(4, '0');
  const cacheKey = `stream:anipm:beta:${resolvedAnilistId}:${ep}:${audioType}`;

  // 1. Cache read
  if (env?.ANIHUB?.prepare) {
    try {
      const row = await env.ANIHUB.prepare(
        'SELECT data FROM stream_cache WHERE key = ?1 AND expires_at > ?2'
      ).bind(cacheKey, Date.now()).first();
      if (row?.data) {
        const parsed = JSON.parse(row.data);
        if (parsed?.negative === true) return null;
        if (parsed?.streamUrl) return parsed;
      }
    } catch { /* miss */ }
  }

  // 2. Upstream fetch — deduped slug candidates
  const candidates = [...new Set(
    [slugify(meta?.title), slugify(meta?.id)].filter(Boolean)
  )];

  const isDebug = env?.EDGE_BETA_DEBUG === '1' || request?.headers?.get('x-debug-beta') === '1';
  if (isDebug) {
    console.log('[edge-beta] called', { resolvedAnilistId, candidates });
  }

  let winner = null;
  for (const slug of candidates) {
    const url = `https://beta.cno.to/hls/${resolvedAnilistId}-${slug}/E${epPadded}/master.m3u8`;
    let res;
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': BETA_UA, 'Referer': 'https://beta.cno.to/', 'Origin': 'https://beta.cno.to' },
      });
    } catch { continue; }
    if (!res.ok) continue;

    let parsed;
    try { parsed = parseMaster(await res.text(), url); } catch { continue; }
    const rawAudio = parsed?.audio ?? parsed?.audioTracks ?? (Array.isArray(parsed) ? parsed : []);
    if (!rawAudio.length) continue;

    const audioTracks = rawAudio.map((t, idx) => ({
      id: t.id !== undefined ? String(t.id) : (t.language || t.lang || `audio-${idx}`),
      language: t.language || t.lang || 'ja',
      label: t.label || t.name || t.language || 'Audio',
      default: t.default !== undefined ? Boolean(t.default) : idx === 0,
    }));

    winner = {
      streamUrl: url,
      audioTracks,
      provider: 'anipm',
      quality: '1080p',
      referer: 'https://beta.cno.to/',
      subtitles: (parsed?.subtitles || []).map((s, idx) => ({
        id: s.id !== undefined ? String(s.id) : `sub-${idx}`,
        language: s.language || s.lang || 'en',
        label: s.label || s.name || s.language || 'English',
        url: s.uri || s.url || '',
        default: Boolean(s.default),
      })),
    };
    break;
  }

  if (isDebug || (!winner && candidates.length > 0)) {
    console.log('[edge-beta] result', winner ? 'winner' : 'no-winner', {
      tried: candidates.length,
      audioTracks: winner?.audioTracks?.length ?? 0,
    });
  }

  // 3. Cache write
  if (env?.ANIHUB?.prepare) {
    try {
      if (winner) {
        await env.ANIHUB.prepare(
          'INSERT OR REPLACE INTO stream_cache (key, data, expires_at) VALUES (?1, ?2, ?3)'
        ).bind(cacheKey, JSON.stringify(winner), Date.now() + POSITIVE_TTL_MS).run();
      } else {
        await env.ANIHUB.prepare(
          'INSERT OR REPLACE INTO stream_cache (key, data, expires_at) VALUES (?1, ?2, ?3)'
        ).bind(cacheKey, JSON.stringify({ negative: true, audioTracks: [] }), Date.now() + NEGATIVE_TTL_MS).run();
      }
    } catch { /* best-effort */ }
  }

  return winner;
}

