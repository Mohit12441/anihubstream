/* Shared helpers for the AniHubStream Pages Functions.
   Files under functions/ that start with "_" are never routed, so this module
   is private to the /api/* handlers. */

const VIEWER_COOKIE = 'anihub_viewer';
const VIEWER_AGE = 60 * 60 * 24 * 730; // two years — the library is meant to survive

export const json = (data, { status = 200, cache = 'no-store', headers = {} } = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': cache,
      vary: 'Cookie',
      ...headers,
    },
  });

export const ok = (data, opts = {}) => json(data, { cache: 'public, max-age=60', ...opts });
export const fail = (status, code, message) => json({ error: code, message }, { status });

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

export const cardFromRow = (r) => ({
  id: r.id,
  title: r.title,
  native: r.native,
  year: r.year,
  rating: r.rating,
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
  altSeasons: r.alt_seasons ? JSON.parse(r.alt_seasons) : [],
  schedule:
    r.sched_day === null || r.sched_day === undefined
      ? null
      : {
          day: r.sched_day,
          dayLabel: r.sched_day_label,
          date: r.sched_date,
          time: r.sched_time,
          season: r.sched_season,
        },
  episodeCount: r.episode_count,
  episodeTotal: r.episode_total ?? null,
});

export const episodeFromRow = (r) => ({
  id: r.id,
  n: r.n,
  title: r.title,
  runtime: r.runtime,
  runtimeSeconds: r.runtime_seconds,
  art: r.thumb,
  synopsis: r.synopsis,
  markers: JSON.parse(r.markers),
  airdate: r.airdate ?? null,
});

export const CARD_COLUMNS = `
  a.id, a.title, a.native, a.year, a.rating, a.season, a.kind, a.status,
  a.art, a.key_art, a.accent, a.synopsis, a.rank, a.trend_rank, a.alt_seasons,
  a.sched_day, a.sched_day_label, a.sched_date, a.sched_time, a.sched_season,
  a.episode_total,
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
    : fail(500, 'internal', 'unexpected error serving this request');

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

export const requiredBody = (body, name) => {
  const value = body?.[name];
  if (typeof value !== 'string' || value === '' || value.length > 200) {
    throw new HttpError(400, 'bad_request', `${name} must be a non-empty string`);
  }
  return value;
};

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
