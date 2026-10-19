// @ts-check
/**
 * HiAnime API — one provider, two players, end to end.
 *
 * A standalone, dependency-free port of the HiAnime chain that AniVerse v2
 * measured against the live site on 2026-10-12:  search / browse -> anime
 * details -> episode range -> per-episode embed URLs -> playable HLS ->
 * downloaded MPEG-TS file.  Plain Node 18+: global `fetch` + `node:crypto`
 * only, nothing imported from AniVerse.  Every endpoint, header, key and
 * parsing rule below is transcribed from a measured response — README.md
 * carries the evidence.
 *
 *   search(term)                    -> [{ id, slug, title, coverUrl, audio, ... }]
 *   browse({page,limit,type,status}) -> the same rows, unfiltered catalogue
 *   details(idOrSlug)               -> { media, episodes:[{ id, number, title, audioType }] }
 *   sources(episodeId,{audioType})   -> { embeds:[url], audioType }
 *   resolve(embedUrl)               -> { master, variants:[{url,quality,headers}], subtitles, skip }
 *   download(signedMasterUrl)       -> writes one real MPEG-TS file
 *   downloadEpisode(q, ep, out, {})  -> the whole thing in one call, with failover
 *
 * What makes this chain different from the two already exported here:
 *
 * 1. The provider is a JSON API, not scraped HTML. `POST /api/filter` and
 *    `GET /api/anime/<slug>` and `GET /api/episodes/<mongoId>?start&end` answer
 *    JSON; no regex over markup is needed anywhere in the provider hops.
 * 2. The episode row already separates the audios: `link.sub[]` and `link.dub[]`,
 *    so `{audioType:"dub"}` is honoured by reading the other array (AniKoto
 *    ignores its own audio option; see README "AniKoto gaps" #1).
 * 3. The API publishes how many episodes of each audio exist, per series
 *    (`totalSubbed`/`totalDubbed` on a search row, `totalSub`/`totalDub` on
 *    details) — a dub pill needs no probing here.
 * 4. The embeds are of TWO kinds.  Measured over 16 series / 43 embed URLs:
 *    25 `zokoanime.video` and 18 `megaplay.buzz`.  ZokoAnime is a jwplayer
 *    shell carrying `window.__P` (base64 -> XOR "otaku-embed-v1" -> JSON);
 *    MegaPlay is the AES-256-CBC + HMAC-token pipeline the other two modules
 *    of this folder use.  `resolve()` dispatches on the host.
 * 5. The signed master carries TWO real rungs (360p and 1080p), so quality is
 *    selectable — the one thing AniKoto and AniWatch could not offer.
 */

import { createDecipheriv, createHmac } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { once } from "node:events";
import { makeDubPairVerdict } from "./dubAudio.mjs";

const HIAnime_MAIN = "https://animehot.cc";
const ZOKO_HOSTS = ["zokoanime.video"];
const MEGAPLAY_HOSTS = [
  "megaplay.buzz", "megaplay-1.buzz",
  "vidwish.live", "vidwish.to",
  "vidtube.site", "vidtube.me",
  "1anime.site",
];
/** The ASCII key the delivered ZokoAnime player script XORs `window.__P` against. */
const ZOKO_XOR_KEY = "otaku-embed-v1";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const PROVIDER = { id: "hianime", name: "HiAnime", baseUrl: HIAnime_MAIN, language: "en" };
export const defaultHiAnimeReferer = `${HIAnime_MAIN}/`;

// --------------------------------------------------------------------- errors

/**
 * Same class, same default code as the other two exports, so the identical fault
 * carries the identical `code` whichever module a caller imports.  `NETWORK_ERROR`
 * is reserved for the two places that catch a fetch *rejection* (no HTTP answer at
 * all); everything here is the provider answering badly, which is `ERROR`.
 */
export class ApiError extends Error {
  constructor(message, status = 0, code = "ERROR") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

// ---------------------------------------------------------------------- HTTP

/**
 * One fetch, one shape.  Nothing on the provider side needs a Referer or a UA
 * (measured: `/api/anime/<slug>` and the embed page both answer 200 bare) — they
 * are sent anyway because a scraper that identifies itself is a scraper that
 * keeps working.  The CDN is the opposite: `hls.dramahot.top` 403s without
 * `Referer: https://zokoanime.video/`, so headers returned here are load-bearing.
 */
async function request(url, { headers, referer, signal, method = "GET", body } = {}) {
  const merged = {
    "user-agent": USER_AGENT,
    ...(referer ? { referer } : {}),
    ...(originOf(referer ?? url) ? { origin: originOf(referer ?? url) } : {}),
    ...(headers ?? {}),
  };
  return fetch(url, { method, ...(body ? { body } : {}), ...(signal ? { signal } : {}), headers: merged });
}

function originOf(url) {
  try { return new URL(url).origin; } catch { return undefined; }
}

/**
 * A response whose body is never consumed cannot go back to the connection pool, so
 * each refused request costs a live socket — which is exactly what the segment retry
 * loop multiplies.  Every `!res.ok` throw in this file drains first.
 *
 * What this is NOT: the fix for libuv's `Assertion failed: !(handle->flags &
 * UV_HANDLE_CLOSING)` / exit 127.  Measured with two probes differing only in this
 * cancel() — both hit the assertion when `process.exit()` ran while a fetch was in
 * flight, and both exited cleanly when the event loop was allowed to drain itself.
 * `cli.mjs` avoids 127 by setting `process.exitCode` and unwinding, never by
 * calling `process.exit()`.
 */
async function drain(res) {
  await res.body?.cancel().catch(() => {});
}

async function getText(url, opts = {}) {
  const res = await request(url, opts);
  if (!res.ok) { await drain(res); throw new ApiError(`fetch ${url} -> ${res.status}`, res.status); }
  return { body: await res.text(), url: res.url || url, headers: res.headers };
}

async function getJson(url, opts = {}) {
  const { body, url: finalUrl } = await getText(url, opts);
  try { return { json: JSON.parse(body), url: finalUrl }; }
  catch { throw new ApiError(`${new URL(url).pathname} returned a non-JSON body`, 0); }
}

async function postFilter(payload, signal) {
  const res = await request(`${HIAnime_MAIN}/api/filter`, {
    method: "POST",
    referer: `${HIAnime_MAIN}/`,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok) { await drain(res); throw new ApiError(`HiAnime /api/filter returned ${res.status}`, res.status); }
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { throw new ApiError(`HiAnime /api/filter returned a non-JSON body: ${text.slice(0, 80)}`, 0); }
}

// ------------------------------------------------------------------- helpers

/**
 * Curly quotes and typographic dashes -> ASCII.  Unlike AniKoto, this backend
 * does NOT 500 on them: it answers `total=0`.  Measured 2026-10-12 —
 * `“Solo Leveling”` -> 0 rows, `Solo’s Leveling` -> 0 rows, `Frieren – Beyond
 * Journey’s End` -> 0 rows, while the plain-ASCII forms return 4, 4 and 24.
 * A silent empty result is worse than a 500 for the caller, so normalising is
 * still mandatory; the retry below just triggers on emptiness instead of on 500.
 */
export function normalizeUnicodeToAscii(text) {
  return text
    .replace(/[‘’⁌⁍′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[–—―]/g, "-")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();
}

function numeric(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function text(value) {
  if (typeof value !== "string") return undefined;
  const t = value.replace(/\s+/g, " ").trim();
  return t.length ? t : undefined;
}

/** `Aired: "Jan 7, 2024 to Mar 31, 2024"` -> 2024. */
function yearOf(aired) {
  const m = /\b(19|20)\d{2}\b/.exec(String(aired ?? ""));
  return m ? Number(m[0]) : undefined;
}

const KIND_BY_TYPE = { tv: "anime", tv_special: "special", tv_movie: "movie", ona: "anime", ova: "ova", movie: "movie", special: "special", music: "special" };
const STATUS_BY_LABEL = {
  "finished airing": "finished", "currently airing": "releasing", "not yet aired": "not_yet_released",
  "finished airing, pending sequel": "finished", "currently airing, pending sequel": "releasing",
};

function normalizeTitle(input) {
  return String(input)
    .toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "")
    .replace(/['‘’`"]/g, "")
    .replace(/\(.*?\)/g, " ")
    .replace(/\b(?:season|cour|part)\s+\p{L}+\b/gu, " ")
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .replace(/\s+/g, " ").trim();
}

function similarity(a, b) {
  const l = normalizeTitle(a), r = normalizeTitle(b);
  if (!l || !r) return 0;
  if (l === r) return 1;
  if (l.includes(r) || r.includes(l)) {
    const s = Math.min(l.length, r.length), g = Math.max(l.length, r.length);
    if (s / g >= 0.75) return 0.95;
  }
  const max = Math.min(64, Math.max(l.length, r.length));
  return 1 - levenshtein(l.slice(0, max), r.slice(0, max)) / Math.max(l.slice(0, max).length, r.slice(0, max).length);
}

function levenshtein(a, b) {
  const cols = b.length + 1;
  let prev = Array.from({ length: cols }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

// ------------------------------------------------------------------ mappings

/**
 * One `results[]` / `animes[]` / `anime` object -> Media.  This API publishes the
 * most metadata of the three providers here, so almost every field is filled
 * rather than guessed: score, ranked, popularity, members, duration, status,
 * year, genres, synopsis, both cover and banner, and the MAL id.
 *
 * Two fields collide and only one is a score.  Measured: `Score` = "8.22" (the
 * audience score) while `score` = "R - 17+ (violence & profanity)" — the parental
 * rating, which also appears as `Rating`.  Reading `score` as a score would put
 * a rating label in a numeric field, so `averageScore` comes from `Score` only.
 */
function mediaFrom(anime) {
  const title = text(anime?.title);
  const slug = text(anime?.slug);
  if (!title || !slug) return undefined;
  const genres = Array.isArray(anime.genres) ? anime.genres.map((g) => text(g)).filter(Boolean) : [];
  const synonyms = [...new Set([text(anime.alternateTitle), text(anime.English)].filter((v) => v && v !== title))];
  const malId = numeric(anime.mal_id);
  const subCount = numeric(anime.totalSub ?? anime.totalSubbed);
  const dubCount = numeric(anime.totalDub ?? anime.totalDubbed);
  return {
    id: `hianime:${slug}`,
    slug,
    // The row's own Mongo id.  Carried because the cursor route only accepts it
    // (measured: /api/anime/?cursor=<slug|mal_id|garbage> -> HTTP 500 "Cast to
    // ObjectId failed") and without it a caller could never START a cursor walk.
    ...(text(anime._id) ? { nativeId: text(anime._id) } : {}),
    kind: KIND_BY_TYPE[String(anime.Type ?? "").toLowerCase().replace(/[\s-]+/g, "_")] ?? "anime",
    title,
    ...(text(anime.Japanese) ? { originalTitle: text(anime.Japanese) } : {}),
    ...(synonyms.length ? { synonyms } : {}),
    ...(text(anime.image) ? { coverUrl: text(anime.image) } : {}),
    ...(text(anime.landScapeImage) ? { bannerUrl: text(anime.landScapeImage) } : {}),
    ...(text(anime.synopsis) ? { description: text(anime.synopsis) } : {}),
    ...(yearOf(anime.Aired) ? { year: yearOf(anime.Aired) } : {}),
    ...(numeric(anime.Score) === undefined ? {} : { averageScore: numeric(anime.Score) }),
    ...(text(anime.Rating) ? { rating: text(anime.Rating) } : {}),
    ...(text(anime.Duration) ? { duration: text(anime.Duration) } : {}),
    ...(text(anime.Aired) ? { aired: text(anime.Aired) } : {}),
    ...(text(anime.Type) ? { type: text(anime.Type) } : {}),
    ...(STATUS_BY_LABEL[String(anime.Status ?? "").toLowerCase()]
      ? { status: STATUS_BY_LABEL[String(anime.Status ?? "").toLowerCase()] } : {}),
    ...(genres.length ? { genres } : {}),
    ...(numeric(anime.totalEpisodes) === undefined ? {} : { episodeCount: numeric(anime.totalEpisodes) }),
    ...(numeric(anime.Ranked) === undefined ? {} : { ranked: numeric(anime.Ranked) }),
    ...(numeric(anime.Popularity) === undefined ? {} : { popularity: numeric(anime.Popularity) }),
    ...(numeric(anime.Members) === undefined ? {} : { members: numeric(anime.Members) }),
    ...(Number.isFinite(malId) ? { malId } : {}),
    // Which audios exist, straight from the API — no probing, no census.
    ...(subCount === undefined && dubCount === undefined ? {} : {
      audio: { sub: subCount ?? 0, dub: dubCount ?? 0 },
      audioAvailability: (dubCount ?? 0) > 0 && (subCount ?? 0) > 0 ? "both" : (dubCount ?? 0) > 0 ? "dub" : "sub",
    }),
  };
}

function rank(rows, term) {
  return rows
    .map((media) => ({ media, score: similarity(term, media.title) }))
    .sort((a, b) =>
      (b.score - a.score) ||
      // A series beats its own special when the query did not ask for one: the
      // specials row for "Solo Leveling" ranks first straight out of the API.
      ((b.media.episodeCount ?? 0) - (a.media.episodeCount ?? 0)) ||
      (normalizeTitle(a.media.title).length - normalizeTitle(b.media.title).length) ||
      a.media.id.localeCompare(b.media.id),
    )
    .map((r) => r.media);
}

// -------------------------------------------------------------------- search

/**
 * Keyword search.  `limit` is honoured up to 50 (measured: limit=200 -> 50 rows)
 * and `page` pages through the hits (`totalPages` is real).  Empty and junk
 * queries return [] rather than throwing — measured over 13 hostile queries.
 */
export async function search(term, { signal, limit = 24, page = 1 } = {}) {
  const raw = String(term ?? "").trim();
  if (!raw) return [];
  const normalized = normalizeUnicodeToAscii(raw);
  // A punctuation-only query normalises to "" — and "" is this API's *unfiltered*
  // keyword (2 591 rows), so passing it through would answer a junk term with the
  // whole catalogue.
  if (!normalized) return [];
  const run = async (keyword) => {
    const body = await postFilter({ page, limit: Math.min(50, Math.max(1, limit)), keyword }, signal);
    const rows = Array.isArray(body?.results) ? body.results : [];
    const mediaList = [];
    const seen = new Set();
    for (const row of rows) {
      const media = mediaFrom(row);
      if (!media || seen.has(media.id)) continue;
      seen.add(media.id);
      mediaList.push(media);
    }
    return { mediaList, total: numeric(body?.total) ?? mediaList.length, totalPages: numeric(body?.totalPages) };
  };
  try {
    const first = await run(normalized);
    if (first.mediaList.length === 0 && normalized !== raw) {
      // Typography was the likely cause of the miss; the literal query is the
      // only other thing this backend could have indexed, so it gets one retry.
      const again = await run(raw);
      if (again.mediaList.length) return rank(again.mediaList, raw);
    }
    return rank(first.mediaList, raw);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(`HiAnime search failed: ${error?.message ?? error}`, 0);
  }
}

/**
 * Catalogue browsing — the feature the AniKoto export documents as missing.
 * Two routes, both measured 2026-10-12:
 *   POST /api/filter {keyword:""}            -> 2 592 rows, offset paging (page,limit<=50)
 *   GET  /api/anime/?cursor=<mongoId>       -> 20 rows per page, cursor paging (nextCursor)
 * Only `type` and `status` narrow the offset route, and only with the site's own
 * spelling: `type:"TV"` -> 1686, `status:"Finished Airing"` -> 2138, while
 * `type:"tv"` / `status:"finished airing"` -> 0 and `genres`, `sort`, `scoreMin`
 * are ignored (they return the same 2591 as no filter at all).
 *
 * The two routes do NOT page through the same order, so they are not
 * interchangeable: the cursor route walks the collection in `_id` order (measured:
 * every id in its first page starts `68e…`, while /api/filter's first page is the
 * `6ac…` ids, i.e. the newest documents), and the cursor is an exclusive floor —
 * feeding a row's `_id` returns the 20 rows inserted AFTER it, which is why the
 * walk from a `6acb9fa1…` row answered 2 rows, `hasNextPage:false`, and 0 rows on
 * the next hop.  `nativeId` is exposed so a caller can start and continue a cursor
 * walk at all (the route's own `nextCursor` only appears once you are inside it);
 * a cursor that is not a 24-hex id is rejected here rather than sent, because the
 * API answers that mistake with HTTP 500 and a Mongoose "Cast to ObjectId failed"
 * body naming the value.
 */
export async function browse({ page = 1, limit = 24, type, status, cursor, signal } = {}) {
  if (cursor !== undefined && cursor !== null && cursor !== "") {
    const clean = String(cursor).trim();
    if (!/^[0-9a-f]{24}$/i.test(clean)) {
      throw new ApiError(`HiAnime's cursor route needs a 24-hex Mongo id (a row's nativeId); got "${clean.slice(0, 40)}"`, 0, "ERROR");
    }
    const { json } = await getJson(`${HIAnime_MAIN}/api/anime/?cursor=${encodeURIComponent(clean)}`, { referer: `${HIAnime_MAIN}/`, signal });
    const mediaList = (Array.isArray(json?.animes) ? json.animes : []).map(mediaFrom).filter(Boolean);
    return { results: mediaList, hasNextPage: Boolean(json?.hasNextPage), nextCursor: text(json?.nextCursor), pageSize: numeric(json?.pageSize) };
  }
  const body = await postFilter({
    page, limit: Math.min(50, Math.max(1, limit)), keyword: "",
    ...(type ? { type } : {}), ...(status ? { status } : {}),
  }, signal);
  const mediaList = (Array.isArray(body?.results) ? body.results : []).map(mediaFrom).filter(Boolean);
  const total = numeric(body?.total);
  const pageNum = numeric(body?.page) ?? page;
  const totalPages = numeric(body?.totalPages);
  return {
    results: mediaList,
    total,
    page: pageNum,
    totalPages,
    ...(totalPages === undefined ? {} : { hasNextPage: pageNum < totalPages }),
    ...(mediaList.at(-1)?.nativeId ? { nextCursor: mediaList.at(-1).nativeId } : {}),
  };
}

/**
 * HiAnime home feed — featured, trending, popular, airing, finished, latest anime & latest episodes.
 * Fetches `GET https://animehot.cc/api/home`.
 */
export async function home({ signal } = {}) {
  const { json } = await getJson(`${HIAnime_MAIN}/api/home`, { referer: `${HIAnime_MAIN}/`, signal });
  if (!json || typeof json !== "object") {
    throw new ApiError("HiAnime /api/home returned empty body", 0);
  }
  const parseList = (arr) => (Array.isArray(arr) ? arr : []).map((item) => mediaFrom(item?.anime ?? item)).filter(Boolean);

  const featured = (Array.isArray(json.featured) ? json.featured : []).map((item) => mediaFrom(item?.anime ?? item)).filter(Boolean);
  const trending = parseList(json.trending?.animes);
  const popular = parseList(json.popular?.animes);
  const currentlyAiring = parseList(json.currentlyAiring?.animes);
  const finishedAiring = parseList(json.finishedAiring?.animes);
  const latestAnime = parseList(json.latestAnime?.animes);

  const latestEpisodes = (Array.isArray(json.latestEpisodes?.episodes) ? json.latestEpisodes.episodes : []).map((ep) => {
    const anime = ep.anime_info;
    const media = anime ? mediaFrom(anime) : undefined;
    return {
      id: ep._id,
      episodeNumber: numeric(ep.episodeNumber) ?? 1,
      title: text(ep.title) || `Episode ${ep.episodeNumber ?? 1}`,
      slug: text(ep.slug),
      media,
    };
  });

  return {
    featured,
    trending,
    popular,
    currentlyAiring,
    finishedAiring,
    latestAnime,
    latestEpisodes,
  };
}

// ------------------------------------------------------------------- details

function encodeEpisodeRef({ animeId, number, audioType, slug }) {
  return ["hianime", animeId, number, audioType, slug].join("|");
}

function decodeEpisodeRef(id) {
  if (!String(id).startsWith("hianime|")) {
    const m = /^hianime:([0-9a-f]{24})\/(\d+)$/i.exec(String(id));
    return m ? { animeId: m[1], number: Number(m[2]), audioType: "sub" } : null;
  }
  const parts = String(id).split("|");
  if (parts.length < 4) return null;
  return { animeId: parts[1], number: Number(parts[2]), audioType: (parts[3] || "sub").trim(), ...(parts[4] ? { slug: parts[4] } : {}) };
}

/**
 * Which audio the embed serves, read off its own path (`…/stream/mal/52299/1/dub`
 * says dub; a URL that names nothing says `undefined`).  The same exported rule in
 * all three provider files — a site claim, not a fact about the bytes, which is
 * what `dubPairVerdict` measures.
 */
export function audioOfEmbed(url) {
  const clean = decodeURIComponent(String(url).split("?")[0].replace(/\/+$/, ""));
  const last = clean.slice(clean.lastIndexOf("/") + 1);
  if (/^h?dub$/i.test(last)) return "dub";
  if (/^h?sub$/i.test(last)) return "sub";
  return undefined;
}

/**
 * One `episodes[]` row -> Episode.  The row publishes `link.sub[]` and
 * `link.dub[]` — arrays, so audio availability is a length, not a flag.  Measured
 * across 12 rows of Solo Leveling and 13 of its sequel: every row carries both
 * keys, and `dub` is non-empty exactly when the series has a dub — which is why
 * `audioType` here is `both` whenever both arrays have a URL: the row is the
 * SUB/DUB toggle, and the file that plays names its own audio.
 */
function episodeFrom(row, mediaId, animeId, slug, fallbackNumber) {
  const number = numeric(row?.episodeNumber) ?? fallbackNumber;
  const sub = Array.isArray(row?.link?.sub) ? row.link.sub.filter((u) => typeof u === "string") : [];
  const dub = Array.isArray(row?.link?.dub) ? row.link.dub.filter((u) => typeof u === "string") : [];
  const audioType = sub.length && dub.length ? "both" : dub.length ? "dub" : "sub";
  const title = text(row?.title);
  return {
    id: encodeEpisodeRef({ animeId, number, audioType, slug }),
    mediaId,
    seasonNumber: 1,
    number,
    ...(title ? { title } : {}),
    url: `${HIAnime_MAIN}/api/episodes/${animeId}?start=${number}&end=${number}`,
    audioType,
    embedCounts: { sub: sub.length, dub: dub.length },
  };
}

/**
 * slug -> media + episode list.  `/api/anime/<mongoId>` is a 404 (measured:
 * `{"message":"Anime not found"}`) — details are keyed by slug only, and the
 * Mongo `_id` it hands back is what `/api/episodes/<id>` needs.
 *
 * `/api/anime/<slug>` also embeds an `episodes` array, but with ONE row (ep 1,
 * link included) regardless of series length — measured on a 12-episode title —
 * so the range endpoint is still the only way to list.
 */
export async function details(idOrSlug, { signal } = {}) {
  const raw = String(idOrSlug ?? "").trim();
  if (!raw) throw new ApiError("HiAnime details needs a slug", 0, "ERROR");
  const slug = raw.startsWith("hianime:") ? raw.slice("hianime:".length) : raw;
  const { json } = await getJson(`${HIAnime_MAIN}/api/anime/${encodeURIComponent(slug).replace(/%3A/gi, ":")}`, { referer: `${HIAnime_MAIN}/`, signal });
  const anime = json?.anime;
  const media = mediaFrom(anime);
  if (!media) throw new ApiError(`HiAnime /api/anime/${slug} carried no usable anime object`, 0);
  const animeId = text(anime._id);
  if (!animeId) throw new ApiError("HiAnime anime object carried no _id", 0);
  const total = numeric(anime.totalEpisodes) ?? 0;
  media.watchUrl = `${HIAnime_MAIN}/anime/${slug}`;

  // start/end are episode NUMBERS, not offsets (measured: start=2&end=4 -> 2,3,4).
  // Garbage is ignored rather than rejected (start=abc -> every row), and an
  // out-of-range start returns zero rows, so ask for exactly what exists.
  const rows = [];
  if (total > 0) {
    const { json: listJson } = await getJson(`${HIAnime_MAIN}/api/episodes/${animeId}?start=1&end=${total}`, { referer: `${HIAnime_MAIN}/`, signal });
    for (const [i, row] of (Array.isArray(listJson?.episodes) ? listJson.episodes : []).entries()) {
      const ep = episodeFrom(row, media.id, animeId, slug, i + 1);
      if (ep) rows.push(ep);
    }
  }
  return { media, episodes: rows };
}

export async function episodes(idOrSlug, { signal } = {}) {
  return (await details(idOrSlug, { signal })).episodes;
}

/**
 * Resolves direct multi-quality download links from ZokoAnime.
 *
 * Target can be an embed URL (e.g. `https://zokoanime.video/stream/mal/52299/1/sub`),
 * a download URL, or an object `{ source, id, episode, track }`.
 */
export async function fetchDownloads(target, { signal } = {}) {
  let source, id, ep, track;
  if (typeof target === "string") {
    const m = /\/(?:stream|download)\/([^/]+)\/([^/]+)\/([^/]+)\/([^/?]+)/i.exec(target);
    if (!m) return [];
    [, source, id, ep, track] = m;
  } else if (target && typeof target === "object") {
    ({ source = "mal", id, episode: ep, track = "sub" } = target);
  }
  if (!id || !ep) return [];
  const cleanTrack = String(track).toLowerCase().startsWith("dub") ? "dub" : "sub";
  const path = `${source}/${id}/${ep}/${cleanTrack}`;
  const referer = `https://zokoanime.video/download/${path}`;
  try {
    const tokenRes = await request(`https://zokoanime.video/api/downloads/token/${path}`, {
      referer,
      signal,
    });
    if (!tokenRes.ok) return [];
    const tokenData = await tokenRes.json().catch(() => null);
    if (!tokenData?.token) return [];
    const dlRes = await request(`https://zokoanime.video/api/downloads/${path}?t=${encodeURIComponent(tokenData.token)}`, {
      referer,
      signal,
    });
    if (!dlRes.ok) return [];
    const data = await dlRes.json().catch(() => null);
    if (!Array.isArray(data?.downloads)) return [];
    return data.downloads.map((d) => ({
      name: `HiAnime (${(d.kind || cleanTrack).toUpperCase()}) ${d.label || "Direct"}`,
      label: d.label || "Direct",
      quality: d.label || "unknown",
      url: d.url,
      provider: "hianime",
      audio: d.kind || cleanTrack,
      type: d.type || "download",
    }));
  } catch {
    return [];
  }
}

/**
 * Episode ref -> the embed URLs of the requested audio group.
 *
 * `audioType` is honoured here, and it is honoured strictly: this API keeps the
 * audios in separate arrays, so a dub request reads `link.dub` and a row that
 * publishes `dub: []` answers with NO embeds.  Measured on Bocchi the Rock!
 * (`link={"sub":1,"dub":0}`): inventing an embed list from the sub array would
 * hand a dub-seeker the Japanese audio and label it dub, which is the exact
 * defect AniKoto's export lists as an open gap.
 */
export async function sources(episodeId, { audioType, signal, server, includeDownloads = false } = {}) {
  const ref = decodeEpisodeRef(episodeId);
  if (!ref?.animeId || !ref.number) throw new ApiError("HiAnime episode id carries no anime id + number", 0, "ERROR");
  // The caller's request wins; the ref's label is only a default for callers who
  // did not ask.  A "both" row defaults to sub, the site's own default toggle.
  const wanted = audioType === "dub" ? "dub" : audioType === "sub" ? "sub" : ref.audioType === "dub" ? "dub" : "sub";
  const { json } = await getJson(`${HIAnime_MAIN}/api/episodes/${ref.animeId}?start=${ref.number}&end=${ref.number}`, { referer: `${HIAnime_MAIN}/`, signal });
  const row = (Array.isArray(json?.episodes) ? json.episodes : []).find((r) => numeric(r?.episodeNumber) === ref.number) ?? json?.episodes?.[0];
  const link = row?.link ?? {};
  const groups = Object.entries(link).filter(([, v]) => Array.isArray(v));
  const pick = (name) => (link[name] ?? []).filter((u) => typeof u === "string" && /^https?:\/\//.test(u));
  const known = groups.some(([k]) => k === "sub" || k === "dub");
  // Only a row carrying no recognised audio key at all falls through to
  // "whatever the link object holds"; that is a schema surprise, not an answer.
  const embeds = [];
  const seen = new Set();
  const candidates = known ? pick(wanted) : groups.flatMap(([, v]) => v).filter((x) => typeof x === "string" && /^https?:\/\//.test(x));
  for (const u of candidates) if (!seen.has(u)) { seen.add(u); embeds.push(u); }

  const servers = [];
  for (const [idx, embed] of embeds.entries()) {
    const isZoko = hostMatches(embed, ZOKO_HOSTS) || /zokoanime/i.test(embed);
    const isMega = hostMatches(embed, MEGAPLAY_HOSTS) || /megaplay/i.test(embed);
    const serverId = isZoko ? `HD-${idx + 1}` : isMega ? `MegaPlay` : `Server-${idx + 1}`;
    const label = `HiAnime · ${serverId}`;
    servers.push({
      id: serverId,
      name: label,
      embedUrl: embed,
      type: "hls",
    });
  }

  // Direct multi-quality downloads are fetched on demand via /downloads endpoint to avoid blocking stream resolution.
  let downloads = [];
  const zokoEmbed = embeds.find((u) => hostMatches(u, ZOKO_HOSTS) || /zokoanime/i.test(u));
  if (zokoEmbed && includeDownloads) {
    downloads = await fetchDownloads(zokoEmbed, { signal }).catch(() => []);
  }

  // If a specific server was requested, order that server first
  let orderedEmbeds = embeds;
  if (server) {
    const normServer = String(server).toLowerCase();
    const matchedIdx = servers.findIndex((s) => s.id.toLowerCase() === normServer || s.name.toLowerCase().includes(normServer));
    if (matchedIdx > 0) {
      orderedEmbeds = [embeds[matchedIdx], ...embeds.filter((_, i) => i !== matchedIdx)];
    }
  }

  return {
    embeds: orderedEmbeds,
    subtitles: [],
    audioType: wanted,
    ...(orderedEmbeds.length ? { embedAudio: audioOfEmbed(orderedEmbeds[0]) } : {}),
    available: Object.fromEntries(groups.map(([k, v]) => [k, v.length])),
    downloads,
    servers,
  };
}

// -------------------------------------------------------------- the two players

/** ZokoAnime: `window.__P="<base64>"` -> bytes XOR the repeating key -> UTF-8 JSON. */
export function decodeZokoPayload(html) {
  const blob = /window\.__P\s*=\s*"([A-Za-z0-9+/=]{32,})"/.exec(html)?.[1];
  if (!blob) return undefined;
  const bytes = Buffer.from(blob, "base64");
  const out = Buffer.alloc(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ ZOKO_XOR_KEY.charCodeAt(i % ZOKO_XOR_KEY.length);
  try { return JSON.parse(out.toString("utf8")); } catch { return undefined; }
}

/** AES-256-CBC over base64url; key/IV are the player bundle's public literals. */
function decryptMegaPlayEnc(enc) {
  try {
    const key = Buffer.alloc(32), iv = Buffer.alloc(16);
    Buffer.from("i?LMTAx0Q6,:}50U", "utf8").copy(key);
    Buffer.from("W0;27ToaUpl_P%'c", "utf8").copy(iv);
    const d = createDecipheriv("aes-256-cbc", key, iv);
    return Buffer.concat([d.update(Buffer.from(String(enc).replace(/-/g, "+").replace(/_/g, "/"), "base64")), d.final()]).toString("utf8");
  } catch { return undefined; }
}

const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** MegaPlay's token signs the CDN directory only and expires by freshness. */
export function buildMegaPlayToken(fileUrl, now = Date.now) {
  let path; try { path = new URL(fileUrl).pathname.slice(1); } catch { return undefined; }
  const dir = path.replace(/\/[^/]*\.m3u8$/i, "");
  if (dir === path || !dir) return undefined;
  const message = `${Math.floor(now() / 1000)}|${dir}`;
  const signature = createHmac("sha256", "MpCdnT0k3n!9f2K#xQ7vL5mR8wN1pY4s").update(message, "utf8").digest();
  return `${b64url(Buffer.from(message, "utf8"))}.${b64url(signature)}`;
}

function hostMatches(url, hosts) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return hosts.some((h) => host === h || host.endsWith(`.${h}`));
  } catch { return false; }
}

function familyIframeUrl(html, hosts) {
  for (const m of html.matchAll(/(?:src|data-src|data-url)\s*=\s*["']([^"']+)["']/gi)) {
    const url = m[1];
    if (/^https?:\/\//i.test(url) && hostMatches(url, hosts)) return url;
  }
  return undefined;
}

function extractPlayerDataId(html) {
  return /id="megaplay-player"[^>]*\bdata-id="([^"]+)"/i.exec(html)?.[1]
    ?? /<div[^>]*\bdata-id="([^"]+)"[^>]*id="megaplay-player"/i.exec(html)?.[1]
    ?? /<[^>]+\bdata-id="([0-9A-Za-z_-]{3,64})"[^>]*>\s*<\/div>/i.exec(html)?.[1];
}

function parseSkip(pair) {
  const s = numeric(pair?.start), e = numeric(pair?.end);
  return Number.isFinite(s) && Number.isFinite(e) && e > s ? [s, e] : undefined;
}

function subtitleFrom(url, label, index, referer, prefix) {
  const language = label ? String(label).toLowerCase() : "unknown";
  return {
    id: `${prefix}-${index}`, url, language,
    ...(label ? { name: String(label) } : {}),
    ...(referer ? { headers: { referer } } : {}),
  };
}

// ------------------------------------------------------------------- resolve

/**
 * Embed URL -> playable HLS.  Dispatches on the host, because HiAnime hands out
 * both players (measured 25 ZokoAnime + 18 MegaPlay embeds over 16 series).
 *
 * The ZokoAnime branch is where this chain's real defect lives.  Its master is
 * referer-gated (`Referer: https://zokoanime.video/` -> 200, the site's own
 * referer or none -> 403) and lives on `hls.dramahot.top`, but the variant
 * playlist lists its segments on a DIFFERENT host, `hls1.drama1.cfd`.  Measured
 * against one identical segment, 8 requests each way:
 *
 *   360p  hls1.drama1.cfd  403 x8      hls.dramahot.top (same path)  200 x8  video/mp2t
 *   1080p hls1.drama1.cfd  200 x8      hls.dramahot.top (same path)  200 x8  video/mp2t
 *
 * The listed host therefore flakes per path, and the master's own origin serves
 * every path of the same stream.  `resolve()` rewrites segment URLs onto the
 * master origin and `download()` does it again per segment; without it a
 * download dies at segment 0 on the 360p rung with a 146-byte nginx 403 page.
 */
export async function resolve(embedUrl, { referer, signal, quality } = {}) {
  const page = await getText(embedUrl, { ...(referer ? { referer } : { referer: `${HIAnime_MAIN}/` }), signal });
  const embedOrigin = originOf(page.url) ?? originOf(embedUrl);
  const audio = audioOfEmbed(embedUrl);

  if (hostMatches(embedUrl, ZOKO_HOSTS) || /zokoanime/i.test(page.url)) {
    const cfg = decodeZokoPayload(page.body);
    if (!cfg?.src || !/^https?:\/\//.test(cfg.src)) {
      // Measured: some rows hand out a 1,011-byte "Player" shell with no __P at
      // all (Vinland Saga Season 2 specials), i.e. a real page with no stream.
      throw new ApiError(`${page.url} is a ZokoAnime shell with no window.__P play config`, 0, "EMPTY_STREAM");
    }
    const headers = { referer: `${embedOrigin}/`, origin: embedOrigin };
    const master = await getText(cfg.src, { headers, signal });
    const rungs = parseVariants(master.body, cfg.src);
    const variants = (rungs.length ? rungs : [{ url: cfg.src, height: undefined, bandwidth: undefined }])
      .map((v) => ({ url: ontoOrigin(v.url, cfg.src), quality: v.height ?? "unknown", bandwidth: v.bandwidth, headers: { ...headers } }))
      .sort((a, b) => (Number(b.quality) || 0) - (Number(a.quality) || 0) || (b.bandwidth ?? 0) - (a.bandwidth ?? 0));
    const chosen = quality && quality !== "auto"
      ? variants.filter((v) => String(v.quality) === String(quality))
      : variants;
    const intro = parseSkip(cfg.skip?.intro) ?? parseSkip(cfg.skip?.Intro);
    const outro = parseSkip(cfg.skip?.outro) ?? parseSkip(cfg.skip?.Ending);
    const skip = intro || outro ? { ...(intro ? { intro } : {}), ...(outro ? { outro } : {}) } : undefined;
    return {
      provider: "hianime",
      extractor: "zokoanime",
      master: { url: ontoOrigin(cfg.src, cfg.src), headers: { ...headers } },
      variants: (chosen.length ? chosen : variants).map((v) => ({ ...v, url: v.url })),
      subtitles: (Array.isArray(cfg.subtitles) ? cfg.subtitles : [])
        .map((s, i) => s?.src ? subtitleFrom(s.src, s.label ?? s.lang, i, headers.referer, "zoko") : undefined)
        .filter(Boolean),
      ...(audio ? { audio } : {}),
      ...(skip ? { skip } : {}),
      ...(text(cfg.player?.engine) ? { engine: text(cfg.player.engine) } : {}),
      ...(text(cfg.player?.default_quality) ? { defaultQuality: text(cfg.player.default_quality) } : {}),
      ...(cfg.download_url ? { downloadPage: new URL(cfg.download_url, embedOrigin).href } : {}),
      note: "segments are listed on a flaking second host; every URL here is rewritten onto the master origin",
    };
  }

  if (hostMatches(embedUrl, MEGAPLAY_HOSTS) || hostMatches(page.url, MEGAPLAY_HOSTS)) {
    let body = page.body, pageUrl = page.url;
    let fileId = extractPlayerDataId(body);
    if (!fileId) {
      const inner = familyIframeUrl(body, MEGAPLAY_HOSTS);
      if (inner) { const second = await getText(inner, { referer: pageUrl, signal }); body = second.body; pageUrl = second.url; fileId = extractPlayerDataId(body); }
    }
    if (!fileId) throw new ApiError("no #megaplay-player[data-id] on the embed page", 0, "EMPTY_STREAM");
    const origin = originOf(pageUrl) ?? "https://megaplay.buzz";
    const selector = (() => { try { const s = new URL(embedUrl).searchParams.get("s"); return s && /^[a-z]{1,16}$/i.test(s) ? s : undefined; } catch { return undefined; } })();
    const apiUrl = `${origin}/stream/getSources?id=${encodeURIComponent(fileId)}&platform=OTHER${selector ? `&s=${selector}` : ""}`;
    const apiRes = await request(apiUrl, { referer: pageUrl, headers: { "x-requested-with": "XMLHttpRequest" }, signal });
    if (!apiRes.ok) { await drain(apiRes); throw new ApiError(`getSources ${apiRes.status}`, apiRes.status); }
    let payload; try { payload = await apiRes.json(); } catch { throw new ApiError("getSources body was not JSON", 0); }
    let file;
    if (typeof payload.enc === "string") {
      const dec = decryptMegaPlayEnc(payload.enc);
      try { file = JSON.parse(dec ?? "")?.file; } catch { /* handled below */ }
    } else if (Array.isArray(payload.sources)) file = payload.sources[0]?.file;
    else if (typeof payload.file === "string") file = payload.file;
    if (typeof file !== "string" || !/^https?:\/\//.test(file)) {
      throw new ApiError("enc did not decrypt to a {file} URL", 0, "ENCRYPTED_STREAM");
    }
    const token = buildMegaPlayToken(file);
    const streamUrl = token ? `${file}?token=${encodeURIComponent(token)}` : file;
    const headers = { referer: `${origin}/` };
    const intro = parseSkip(payload.intro), outro = parseSkip(payload.outro);
    const skip = intro || outro ? { ...(intro ? { intro } : {}), ...(outro ? { outro } : {}) } : undefined;
    // The server names the rung it encoded for; if the master cannot be expanded
    // that label is still better than "unknown".
    const masterQuality = /(\d{3,4})[pP]/.exec(String(payload.RESOLUTION ?? ""))?.[1] ?? "unknown";
    let variants = [{ url: streamUrl, quality: masterQuality, headers: { ...headers } }];
    try {
      const master = await getText(streamUrl, { headers, signal });
      const dir = new URL(file).pathname.replace(/\/[^/]*\.m3u8$/i, "");
      const byQuality = new Map();
      for (const v of parseVariants(master.body, streamUrl)) {
        let path; try { path = new URL(v.url).pathname; } catch { continue; }
        if (!path.startsWith(`${dir}/`)) continue;
        const q = v.height ?? "unknown";
        if (byQuality.has(q) && (byQuality.get(q).bandwidth ?? 0) >= (v.bandwidth ?? 0)) continue;
        byQuality.set(q, v);
      }
      if (byQuality.size) {
        variants = [...byQuality.values()]
          .sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.bandwidth ?? 0) - (a.bandwidth ?? 0))
          .map((v) => ({ url: `${v.url}${token ? `?token=${encodeURIComponent(token)}` : ""}`, quality: v.height ?? "unknown", headers: { ...headers } }));
      }
    } catch { /* keep the master hand-out */ }
    return {
      provider: "hianime", extractor: "megaplay",
      master: { url: streamUrl, headers: { ...headers } },
      variants: quality && quality !== "auto" ? variants.filter((v) => String(v.quality) === String(quality)) : variants,
      subtitles: (Array.isArray(payload.tracks) ? payload.tracks : [])
        .filter((t) => t?.kind === "captions" || t?.kind === "subtitles")
        .map((t, i) => t?.file ? subtitleFrom(t.file, t.label, i, headers.referer, "megaplay") : undefined)
        .filter(Boolean),
      ...(audio ? { audio } : {}),
      ...(skip ? { skip } : {}),
      note: "token is directory-scoped and expires by unix-seconds freshness; re-resolve, never cache",
    };
  }

  throw new ApiError(`no resolver for embed host ${(() => { try { return new URL(embedUrl).host; } catch { return embedUrl; } })()}`, 0, "NO_EXTRACTOR");
}

/** Rewrite any URL onto another URL's origin, keeping its path (and query). */
function ontoOrigin(url, originUrl) {
  try {
    const u = new URL(url);
    const base = new URL(originUrl);
    if (u.host === base.host) return u.toString();
    return `${base.origin}${u.pathname}${u.search}`;
  } catch { return url; }
}

/**
 * `#EXT-X-STREAM-INF` -> variants.  I-FRAME preview tracks are skipped: they are
 * the scrubber thumbnail, not a playable rung.
 */
export function parseVariants(text, baseUrl) {
  const lines = String(text).split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const tag = (lines[i] ?? "").trim();
    if (!/^#EXT-X-STREAM-INF\b/i.test(tag)) continue;
    if (/TYPE=I-FRAME/i.test(tag)) continue;
    let media = "";
    for (let j = i + 1; j < lines.length; j++) {
      const next = (lines[j] ?? "").trim();
      if (!next) continue;
      if (next.startsWith("#")) continue;
      media = next; break;
    }
    if (!media) continue;
    const bandwidth = numeric(/BANDWIDTH=(\d+)/i.exec(tag)?.[1]);
    const res = /RESOLUTION=(\d+)x(\d+)/i.exec(tag);
    try { out.push({ url: new URL(media, baseUrl).toString(), ...(bandwidth ? { bandwidth } : {}), ...(res ? { width: Number(res[1]), height: Number(res[2]) } : {}) }); }
    catch { /* unusable line */ }
  }
  return out;
}

// ---------------------------------------------------------- container + download

/** What the bytes actually are, regardless of the URL's extension. */
export function sniffContainer(buf) {
  if (!buf || buf.length < 8) return "empty";
  if (buf[0] === 0x47 && buf.length > 188 && [...Array(Math.min(40, Math.floor(buf.length / 188)))].every((_, i) => buf[i * 188] === 0x47)) return "mpegts";
  if (buf.subarray(4, 8).toString("latin1") === "ftyp") return "mp4";
  if (buf.subarray(0, 7).toString("latin1").startsWith("#EXTM3U")) return "m3u8";
  if (buf[0] === 0x89 && buf.subarray(1, 4).toString("latin1") === "PNG") return "png";
  if (buf.subarray(0, 3).toString("latin1") === "ID3" || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return "audio";
  if (buf[0] === 0x1f && buf[1] === 0x8b) return "gzip";
  const head = buf.subarray(0, 64).toString("latin1").toLowerCase();
  if (head.startsWith("<!doctype html") || head.includes("<html")) return "html";
  return "unknown";
}

/**
 * Master/variant URL -> one real MPEG-TS file.
 *
 * Reads the playlist like a player does: master -> chosen rung -> media playlist
 * -> every segment, concatenated.  Three measured rules make it work:
 *   1. the rung's segments are rewritten onto the master's origin (the host the
 *      playlist names 403s intermittently — see resolve());
 *   2. the request carries `Referer` + `Origin` of the embed host; a missing
 *      pair is what turns a 200 into a 403 on this CDN;
 *   3. the first segment is sniffed before anything is believed — the URLs end
 *      `.ts.jpg`, and a `.jpg` that is really MPEG-TS must not be trusted as an
 *      extension and must not be renamed either.
 */
export async function download(playlistUrl, { referer, outPath, maxSegments, quality = "1080", signal, concurrency = 4, onProgress } = {}) {
  const headers = { ...(referer ? { referer } : {}), ...(originOf(referer) ? { origin: originOf(referer) } : {}) };
  const originUrl = playlistUrl;
  let masterText;
  try { masterText = (await getText(playlistUrl, { headers, signal })).body; }
  // An ApiError from getText already says what went wrong (its HTTP status, or a
  // body that was not a playlist); only a fetch *rejection* — no HTTP answer at all
  // — earns NETWORK_ERROR, which is what the siblings do at their boundary.
  catch (e) {
    const known = e instanceof ApiError;
    throw new ApiError(`playlist fetch failed: ${e?.message ?? e}`, known ? e.status : 0, known ? e.code : "NETWORK_ERROR");
  }
  const rungs = parseVariants(masterText, playlistUrl);
  let variantUrl = playlistUrl;
  if (rungs.length) {
    const wanted = String(quality) === "auto" || String(quality) === "best"
      ? rungs.reduce((b, v) => ((v.bandwidth ?? 0) > (b.bandwidth ?? 0) ? v : b), rungs[0])
      : rungs.find((v) => String(v.height) === String(quality)) ?? rungs.reduce((b, v) => ((v.bandwidth ?? 0) > (b.bandwidth ?? 0) ? v : b), rungs[0]);
    variantUrl = ontoOrigin(wanted.url, originUrl);
  }
  const variant = await getText(variantUrl, { headers, signal });
  const segLines = variant.body.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#"));
  if (!segLines.length) throw new ApiError("media playlist carried no segments", 0, "EMPTY_STREAM");
  const durations = [...variant.body.matchAll(/#EXTINF:([0-9.]+)/gi)].map((m) => Number(m[1]));
  const wanted = maxSegments && maxSegments > 0 ? segLines.slice(0, maxSegments) : segLines;
  // Duration of what the file actually holds, not of the episode: a preview's
  // "~1420s" would be a lie about a 12-segment clip.
  const durationSec = durations.slice(0, wanted.length).reduce((a, b) => a + b, 0);
  const segs = wanted.map((l) => ontoOrigin(new URL(l, variantUrl).href, originUrl));

  let out = outPath;
  if (out) {
    await mkdir(dirname(out), { recursive: true });
    const probe = await getBuffer(segs[0], headers, signal);
    const kind = sniffContainer(probe.subarray(0, 4096));
    if (kind === "png") throw new ApiError("segments are png, not video — decoy CDN", 0, "DECOY_CDN");
    if (kind === "html") throw new ApiError(`segments are an html error page — ${new URL(segs[0]).host} refused the request`, 403);
    if (kind !== "mpegts" && kind !== "mp4") throw new ApiError(`segments are ${kind}, not a video container`, 0, "EMPTY_STREAM");
    const stream = createWriteStream(out);
    await once(stream, "open").catch((e) => { throw new ApiError(`cannot open ${out}: ${e.message}`, 0, "STORAGE_ERROR"); });
    let sizeBytes = 0;
    // Segments arrive out of order (concurrency) but MPEG-TS is a concat: a file
    // with segments shuffled demuxes into garbage, so writes are released strictly
    // in playlist order through one chained writer.
    const slots = new Array(segs.length);
    slots[0] = probe;
    let nextWrite = 0;
    let pending = Promise.resolve();
    const flush = () => {
      pending = pending.then(async () => {
        while (slots[nextWrite] !== undefined) {
          const chunk = slots[nextWrite];
          slots[nextWrite] = undefined;
          sizeBytes += chunk.length;
          if (!stream.write(chunk)) await once(stream, "drain");
          nextWrite++;
          onProgress?.({ bytes: sizeBytes, percent: Math.round((nextWrite / segs.length) * 100), segment: nextWrite, of: segs.length });
        }
      });
      return pending;
    };
    let cursor = 1;
    // Release the probe before the workers: with maxSegments=1 there is nothing
    // else to fetch, and a writer that only runs on a new arrival would leave the
    // one segment it held in memory off the disk.
    await flush();
    const workers = Array.from({ length: Math.max(1, Math.min(concurrency, segs.length)) }, async () => {
      while (cursor < segs.length) {
        if (signal?.aborted) throw new ApiError("download aborted by caller", 0, "ABORTED");
        const index = cursor++;
        slots[index] = await getBuffer(segs[index], headers, signal);
        await flush();
      }
    });
    await Promise.all(workers);
    await pending;
    if (nextWrite !== segs.length) throw new ApiError(`wrote ${nextWrite} of ${segs.length} segments to ${out}`, 0, "STORAGE_ERROR");
    stream.end();
    await once(stream, "close");
    const onDisk = (await stat(out)).size;
    if (onDisk !== sizeBytes) throw new ApiError(`wrote ${onDisk} of ${sizeBytes} counted bytes to ${out}`, 0, "STORAGE_ERROR");
    return { outPath: out, sizeBytes, mimeType: kind === "mp4" ? "video/mp4" : "video/mp2t", segments: segs.length, durationSec, container: kind, cdn: new URL(variantUrl).host };
  }

  const parts = [];
  for (const url of segs) parts.push(await getBuffer(url, headers, signal));
  return { buffer: Buffer.concat(parts), sizeBytes: parts.reduce((a, b) => a + b.length, 0), mimeType: "video/mp2t", segments: segs.length, durationSec, cdn: new URL(variantUrl).host };
}

async function getBuffer(url, headers, signal) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (signal?.aborted) throw new ApiError("download aborted by caller", 0, "ABORTED");
    let res;
    try { res = await request(url, { headers, signal }); }
    catch (e) {
      if (attempt === 3) throw new ApiError(`segment fetch failed: ${e.message}`, 0, "NETWORK_ERROR");
      continue;
    }
    if (!res.ok) {
      // This CDN refuses intermittently per path (measured 0/8 then 8/8 on one
      // identical segment), so drain the refused body — otherwise the retry costs a
      // fresh socket each time — and retry before believing it.
      await res.body?.cancel().catch(() => {});
      if (res.status === 403 && attempt < 3) continue;
      throw new ApiError(`segment ${url.slice(0, 90)} -> ${res.status}`, res.status, "SEGMENT_ERROR");
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) throw new ApiError("segment was empty", 0, "EMPTY_STREAM");
    return buf;
  }
  throw new ApiError("unreachable", 0);
}

/**
 * One call: title -> episode -> chosen audio -> chosen quality -> real file.
 * Tries every embed of the requested group and only gives up when all of them
 * fail, reporting what each one did.
 */
export async function downloadEpisode(term, episodeNumber, outPath, { audioType = "sub", quality = "1080", maxSegments, signal, onProgress } = {}) {
  const results = await search(term, { signal });
  if (!results.length) throw new ApiError(`HiAnime has nothing for "${term}"`, 0, "EMPTY_STREAM");
  const chosen = results.find((m) => m.audioAvailability === "both" || m.audioAvailability === audioType) ?? results[0];
  const { media, episodes } = await details(chosen.slug, { signal });
  const ep = episodes.find((e) => e.number === Number(episodeNumber)) ?? episodes[0];
  if (!ep) throw new ApiError(`${media.title} published no episodes`, 0, "EMPTY_STREAM");
  const { embeds, available } = await sources(ep.id, { audioType, signal });
  if (!embeds.length) throw new ApiError(`${media.title} ep ${ep.number} has no ${audioType} embeds (row publishes ${JSON.stringify(available)})`, 0, "EMPTY_STREAM");
  const failures = [];
  for (const embed of embeds) {
    try {
      const r = await resolve(embed, { signal, quality });
      const href = (r.variants[0] ?? r.master).url;
      const file = await download(href, {
        referer: (r.variants[0] ?? r.master).headers.referer,
        outPath, maxSegments, quality, signal, onProgress,
      });
      return {
        ...file,
        media: media.title, mediaId: media.id, episode: ep.number, episodeId: ep.id,
        embed, extractor: r.extractor, audio: r.audio ?? audioType, quality: r.variants[0]?.quality ?? quality,
        rungs: r.variants.map((v) => v.quality), subtitles: r.subtitles.length,
        ...(r.skip ? { skip: r.skip } : {}),
        failures,
      };
    } catch (e) {
      if (e?.code === "ABORTED" || signal?.aborted) throw e;
      failures.push({ embed, code: e?.code ?? "error", message: e?.message });
      if (outPath) await rm(outPath, { force: true }).catch(() => {});
    }
  }
  throw Object.assign(new ApiError(`every embed failed: ${failures.map((f) => `${f.embed} -> ${f.code}: ${f.message}`).join(" | ")}`, 0, "UPSTREAM_FAILURE"), { failures });
}

/**
 * Is THIS site's `/dub` file its own bytes or a copy of its `/sub`?  Measures the
 * first media segment of both (see `dubAudio.mjs` for the 14-pair census behind the
 * rule); the `audio` field on `resolve()` above is only the site's claim.
 */
export const dubPairVerdict = makeDubPairVerdict(resolve, defaultHiAnimeReferer);
