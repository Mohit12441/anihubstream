// @ts-check
/**
 * AnimeKai API — one provider, end to end.
 *
 * Dependency-free port of the AnimeKai chain, proven against the live site on
 * 2026-10-13: search -> watch page -> episode list -> server groups -> embed ->
 * playable HLS -> downloaded MPEG-TS.  Runs on plain Node 18+ with global
 * `fetch` and `node:crypto`; nothing here imports from AniVerse or from another
 * provider file — the file is self-contained so it can be copied out alone.
 *
 *   search(term)                    -> [{ id, slug, title, subCount, dubCount }]
 *   details(idOrSlugOrUrl)          -> { media, episodes:[{ id, number, audioType }] }
 *   sources(episodeId, {audioType}) -> { embeds:[url], audioType, servers }
 *   resolve(embedUrl, {referer})    -> { master, variants, subtitles, audio }
 *   download(signedPlaylistUrl)     -> one real MPEG-TS file
 *   downloadEpisode(q, ep, out)     -> one-call convenience
 *   dubPairVerdict(sub, dub)        -> is this site's /dub its own bytes?
 *
 * Chain, every hop measured live on 2026-10-13 (Solo Leveling, slug
 * `solo-leveling`, plus One Piece for the long-tail shape):
 *
 *   GET /api/search/suggest?q=<q>            200 application/json, 735 B,
 *        a BARE ARRAY (no envelope) of
 *        {slug,title,title_jp,poster_url,type,year,rating,
 *         has_sub,has_dub,sub_count,dub_count,ep_count}
 *   GET /watch/<slug>                        200 after a real HTTP 302 to
 *        /watch/<slug>/ep-1 (118,274 B, identical body — `redirected:true` is
 *        the only signal; the body carries no meta refresh on this deploy)
 *   GET /watch/<slug>/ep-<n>                 200, h1.title[data-jp],
 *        small.al-title, div.info (rating + per-audio counts + type),
 *        #synopsis-text, a[href=.../ep-N][num][data-sub][data-dub][langs],
 *        div.server-items[data-id=sub|dub] > span.server[data-url][data-sid]
 *   GET  embed megaplay.buzz/stream/mal/<malId>/<ep>/{sub,dub}
 *        -> #megaplay-player[data-id] -> /stream/getSources?id=&platform=OTHER
 *        -> AES-256-CBC `enc` -> file
 *        https://fetch.nexabloom.top/anime/<dir>/<hash>/master.m3u8?token=...
 *        1 rung @1080, 9 subtitle tracks (ara eng fre ger ita por rus spa spa)
 *
 * Two facts about this site decided the shape of `sources()` and the ref:
 *
 * 1. The server group is IN the watch page — `span.server[data-url]` carries the
 *    embed directly, so there is no decode hop and no second request.  What has
 *    to be scoped is the group: a `sub` span is the Japanese audio.
 * 2. `data-url` repeats: Server 1 and Server 2 of one group publish the SAME
 *    embed (measured, `sid` 6970/6971 for sub and 6994/6995 for dub), so embeds
 *    are deduped by URL or the failover walk would try the same CDN twice.
 *
 * `resolve()` stamps `provider:"animekai"` — provenance is per-call, not baked
 * into the shared megaplay pipeline that `anikoto.mjs` and `aniwatch.mjs` carry.
 */

import { createDecipheriv, createHmac } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { once } from "node:events";
import { makeDubPairVerdict } from "./dubAudio.mjs";

const ANIMEKAI_MAIN = "https://animekai.be";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const MEGAPLAY_HOSTS = [
  "megaplay.buzz", "megaplay-1.buzz",
  "vidwish.live", "vidwish.to",
  "vidtube.site", "vidtube.me",
  "1anime.site", // thin wrapper whose whole body is one megaplay iframe
];

export const PROVIDER = { id: "animekai", name: "AnimeKai", baseUrl: ANIMEKAI_MAIN, language: "en" };
export const defaultAnimeKaiReferer = `${ANIMEKAI_MAIN}/`;

// --------------------------------------------------------------------- HTTP

const providerHeaders = { "user-agent": USER_AGENT };

async function request(url, { headers, referer, signal, method = "GET" } = {}) {
  const merged = { ...(referer ? { referer } : {}), ...(headers ?? {}) };
  return fetch(url, { method, ...(signal ? { signal } : {}), headers: merged });
}

/**
 * A response whose body is never consumed cannot go back to the connection pool,
 * so each refused request costs a live socket.  Every `!res.ok` throw in this
 * file drains first — and none of them calls `process.exit()` over the socket
 * (that is libuv's `UV_HANDLE_CLOSING` assertion on Windows: see cli.mjs's `fail`).
 */
async function drain(res) {
  await res.body?.cancel().catch(() => {});
}

async function getText(url, opts = {}) {
  const res = await request(url, opts);
  if (!res.ok) { await drain(res); throw new ApiError(`fetch ${url} -> ${res.status}`, res.status); }
  return { body: await res.text(), url: res.url || url, headers: res.headers, res };
}

// ---------------------------------------------------------------- HTML utils

/** Curly quotes / non-ASCII dashes -> ASCII, so a pasted title still matches. */
export function normalizeUnicodeToAscii(text) {
  return text
    .replace(/[‘’⁌⁍′']/g, "'")
    .replace(/[“”‟‟″"]/g, '"')
    .replace(/[–—―]/g, "-")
    .replace(/[​-‍﻿]/g, "")
    .trim();
}

function fixUrl(base, href) {
  if (!href) return base;
  try { return new URL(href, base).toString(); } catch { return href; }
}

function decodeEntities(value) {
  return value
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(Number(c)));
}

function attr(source, pattern) {
  const m = source.match(pattern);
  return m ? decodeEntities(m[1] ?? "") : undefined;
}

function clean(value) {
  if (!value) return undefined;
  const t = decodeEntities(value.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
  return t.length > 0 ? t : undefined;
}

function digits(value) {
  const m = /(\d+)/.exec(value ?? "");
  return m ? Number(m[1]) : undefined;
}

// ---------------------------------------------------------------- title rank

function normalizeTitle(input) {
  return input
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

// ------------------------------------------------------------------ provider

const KIND_BY_TYPE = { MOVIE: "movie", OVA: "ova", SPECIAL: "special", ONA: "ova", TV: "anime" };

/**
 * `/api/search/suggest` answers a bare JSON array — no `{html:…}` envelope like
 * the WordPress twins — so a body that is not an array is a block page, and the
 * honest answer to a block page is no rows rather than a regex over HTML.
 */
export function parseSuggestRows(body) {
  const trimmed = String(body ?? "").trim();
  if (!trimmed.startsWith("[")) return [];
  let rows;
  try { rows = JSON.parse(trimmed); } catch { return []; }
  if (!Array.isArray(rows)) return [];
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const slug = typeof row.slug === "string" ? row.slug.trim() : "";
    const title = typeof row.title === "string" ? row.title.trim() : "";
    if (!slug || !title || seen.has(slug)) continue;
    seen.add(slug);
    const originalTitle = typeof row.title_jp === "string" ? row.title_jp.trim() : "";
    const poster = typeof row.poster_url === "string" ? row.poster_url.trim() : "";
    out.push({
      media: {
        id: `animekai:${slug}`,
        slug,
        kind: KIND_BY_TYPE[String(row.type ?? "").toUpperCase()] ?? "anime",
        title,
        ...(originalTitle && originalTitle !== title ? { originalTitle } : {}),
        ...(poster ? { coverUrl: poster } : {}),
        ...(Number.isFinite(row.year) ? { year: row.year } : {}),
        ...(typeof row.rating === "string" && row.rating ? { rating: row.rating } : {}),
        // The suggestion row states the audio claim per series, which is what a
        // SUB/DUB pill needs before anybody opens a watch page.  A claim, not a
        // fact: `dubPairVerdict` measures the files, and the census in README
        // exists because sites lie about exactly this pair of numbers.
        ...(Number.isFinite(row.ep_count) ? { episodeCount: row.ep_count } : {}),
        ...(Number.isFinite(row.sub_count) ? { subCount: row.has_sub === false ? 0 : row.sub_count } : {}),
        ...(Number.isFinite(row.dub_count) ? { dubCount: row.has_dub === false ? 0 : row.dub_count } : {}),
        watchUrl: `${ANIMEKAI_MAIN}/watch/${slug}`,
      },
    });
  }
  return out;
}

/**
 * term -> ranked cards.  Score desc, then shortest title (the base series beats
 * its own sequels and specials when both match), then id for a stable tie.
 */
export async function search(term, { signal } = {}) {
  const query = normalizeUnicodeToAscii(String(term ?? "").trim());
  if (!query) return [];
  const { body } = await getText(
    `${ANIMEKAI_MAIN}/api/search/suggest?q=${encodeURIComponent(query)}`,
    { headers: providerHeaders, referer: defaultAnimeKaiReferer, signal },
  );
  return parseSuggestRows(body)
    .map((row) => ({ ...row, score: similarity(query, row.media.title) }))
    .sort((a, b) =>
      (b.score - a.score) ||
      (normalizeTitle(a.media.title).length - normalizeTitle(b.media.title).length) ||
      a.media.id.localeCompare(b.media.id),
    )
    .map((row) => row.media);
}

/**
 * `/watch/<slug>` opens on the first episode.  Measured on this deploy: a real
 * HTTP 302 that `fetch` follows, and `response.redirected` + the final URL are the
 * only signals — the 118 KB body carries no meta refresh.  Both paths are still
 * honoured, because the sibling site of this theme publishes the refresh instead
 * of the redirect, and a caller who pastes an `/ep-<n>` URL gets it used as-is.
 */
async function firstEpisodePageFor(id, signal) {
  const raw = String(id ?? "").trim();
  if (!raw) throw new ApiError("AnimeKai details needs a slug or a /watch/<slug> URL", 0);
  if (/^https?:\/\//i.test(raw)) {
    return { url: raw, html: (await getText(raw, { headers: providerHeaders, referer: defaultAnimeKaiReferer, signal })).body };
  }
  const bare = raw.replace(/^animekai:/, "").replace(/^\/+/, "");
  if (/^\d+$/.test(bare)) {
    throw new ApiError(`AnimeKai cannot open a watch page from the numeric id ${bare}; it needs the /watch/<slug> locator`, 0);
  }
  const path = bare.startsWith("watch/") ? bare : `watch/${bare}`;
  const seriesUrl = `${ANIMEKAI_MAIN}/${path}`.replace(/\/+$/, "");
  const page = await getText(seriesUrl, { headers: providerHeaders, referer: defaultAnimeKaiReferer, signal });
  if (page.res?.redirected && /\/ep-\d+/i.test(page.url)) return { url: page.url, html: page.body };
  const refresh =
    attr(page.body, /http-equiv="refresh"[^>]*content="\d+;\s*url='([^']*)'"/i) ??
    attr(page.body, /http-equiv="refresh"[^>]*content="\d+;\s*url=([^"']*)"/i);
  if (refresh) {
    const url = fixUrl(ANIMEKAI_MAIN, refresh);
    return { url, html: (await getText(url, { headers: providerHeaders, referer: defaultAnimeKaiReferer, signal })).body };
  }
  return { url: seriesUrl, html: page.body };
}

/**
 * Everything here is read out of `#main-entity` — the series' own block.  The
 * rest of the page is rails: the same `<b>TV</b>` markup repeats six-plus times
 * across related cards, so an unscoped type scan can call a TV series a Movie
 * because a film sits in "Related".
 */
function mediaFromPage(pageUrl, html) {
  const slug = pageUrl.match(/\/watch\/([^"/?#]+)/i)?.[1] ?? "";
  const start = html.indexOf('id="main-entity"');
  const block = start === -1 ? html : html.slice(start, start + 6_000);
  const titleElement = /<h1\b[^>]*class="[^"]*\btitle\b[^"]*"[^>]*>[\s\S]*?<\/h1>/i.exec(block)?.[0];
  const title =
    clean(titleElement) ??
    clean(attr(block, /<meta property="og:title" content="([^"]*)"/i)) ??
    `AnimeKai ${slug}`;
  const originalTitle = titleElement ? attr(titleElement, /\bdata-jp="([^"]*)"/i) : undefined;
  // `small.al-title` is the site's own alt-title list, `; `-separated
  // (romaji; Japanese).  Kept because a search that cannot see them misses titles
  // users type.
  const altTitleText = clean(/<small\b[^>]*class="[^"]*al-title[^"]*"[^>]*>([\s\S]*?)<\/small>/i.exec(block)?.[1]);
  const infoBlock = /<div class="info">([\s\S]*?)<\/div>/i.exec(block)?.[1] ?? "";
  const typeTag = /<b>(TV|Movie|OVA|ONA|Special)<\/b>/i.exec(infoBlock)?.[1]?.toUpperCase();
  const kind =
    typeTag === "MOVIE" ? "movie" : typeTag === "OVA" || typeTag === "ONA" ? "ova"
      : typeTag === "SPECIAL" ? "special" : "anime";
  const description = clean(/<div\b[^>]*\bid="synopsis-text"[^>]*>([\s\S]*?)<\/div>/i.exec(block)?.[1]);
  const nativeId = attr(block, /\bid="comment"[^>]*\bdata-anime="(\d+)"/i);
  const count = (pattern) => digits(pattern.exec(infoBlock)?.[0]);
  return {
    id: `animekai:${slug}`,
    slug,
    kind,
    title,
    ...(originalTitle && originalTitle !== title ? { originalTitle } : {}),
    ...(altTitleText ? { altTitles: altTitleText.split(";").map((s) => s.trim()).filter(Boolean) } : {}),
    coverUrl: fixUrl(ANIMEKAI_MAIN, attr(html, /<meta property="og:image" content="([^"]*)"/i)),
    ...(description ? { description } : {}),
    ...(clean(attr(infoBlock, /<span class="rating">([^<]*)</i)) ? { rating: clean(attr(infoBlock, /<span class="rating">([^<]*)</i)) } : {}),
    ...(count(/<span class="sub">[\s\S]*?<\/span>/i) !== undefined ? { subCount: count(/<span class="sub">[\s\S]*?<\/span>/i) } : {}),
    ...(count(/<span class="dub">[\s\S]*?<\/span>/i) !== undefined ? { dubCount: count(/<span class="dub">[\s\S]*?<\/span>/i) } : {}),
    // The site's own series id, from the comment widget.  Not a MAL id: it is what
    // /watchlist/save and the report form post as `anime_id` (measured 90 for
    // Solo Leveling, whose MAL id 52299 only ever appears inside the embed path).
    ...(nativeId ? { nativeId } : {}),
    watchUrl: pageUrl,
  };
}

/**
 * Episode anchors: `a[href=/watch/<slug>/ep-N][num][data-sub][data-dub][langs]`,
 * ordinal text then `<span data-jp>` with the site's own label.  Scoped to the
 * media's slug, because One Piece answers 1,180 anchors on one page and a
 * recommendations rail reusing the shape must not leak another series' rows in.
 */
export function parseEpisodeAnchors(main, html, mediaId) {
  const seriesSlug = String(mediaId ?? "").replace(/^animekai:/, "");
  const out = [];
  for (const m of html.matchAll(/<a\b[^>]*\/watch\/[^"/?#]+\/ep-\d+[^>]*>([\s\S]*?)<\/a>/gi)) {
    const tag = m[0];
    const href = attr(tag, /\bhref="([^"]*)"/i) ?? "";
    if (seriesSlug && !href.includes(`/watch/${seriesSlug}/`)) continue;
    const number = digits(attr(tag, /\bnum="(\d+)"/i)) ?? out.length + 1;
    const isSub = attr(tag, /\bdata-sub="([^"]*)"/i) === "1";
    const isDub = attr(tag, /\bdata-dub="([^"]*)"/i) === "1";
    const audioType = isDub && isSub ? "both" : isDub ? "dub" : isSub ? "sub" : "sub";
    const label = clean(m[1]?.match(/<span\b[^>]*>([\s\S]*?)<\/span>/i)?.[1]);
    const episodeUrl = fixUrl(main, href);
    out.push({
      id: encodeEpisodeRef({ number, episodeUrl, audioType: audioType === "dub" ? "dub" : "sub" }),
      mediaId,
      seasonNumber: 1,
      number,
      title: label ?? `Episode ${number}`,
      url: episodeUrl,
      audioType,
    });
  }
  out.sort((a, b) => a.number - b.number);
  return out;
}

/**
 * `div.server-items[data-id=sub|dub] > span.server[data-url][data-sid]`.
 * Group comes from the nearest preceding `data-id="sub|dub"`; the page's own
 * jQuery template writes a third `data-id="' + lang + '"` block whose spans carry
 * `' + src.source_url + '` — that is not a URL, so it is dropped here rather than
 * handed downstream as an embed.
 */
export function parseServerSpans(html) {
  const out = [];
  const groups = [...String(html).matchAll(/<div class="server-items lang-group" data-id="(sub|dub)"/gi)]
    .map((m) => ({ index: m.index ?? 0, group: (m[1] ?? "").toLowerCase() }));
  for (const m of html.matchAll(/<span\b[^>]*\bclass="[^"]*\bserver\b[^"]*"[^>]*>([\s\S]*?)<\/span>/gi)) {
    const tag = m[0];
    const url = attr(tag, /\bdata-url="([^"]*)"/i) ?? "";
    if (!/^https?:\/\//i.test(url)) continue;
    let group = "";
    for (const candidate of groups) {
      if (candidate.index < (m.index ?? 0)) group = candidate.group;
      else break;
    }
    out.push({ group, name: clean(m[1]) ?? "", sid: attr(tag, /\bdata-sid="([^"]*)"/i) ?? "", url });
  }
  return out;
}

/**
 * The ref carries the episode number, the page URL whose markup holds the server
 * groups, and the row's own audio label.  Identical shape to the app provider's
 * (`animekai|<number>|<episodeUrl>|<audioType>`), so a ref from either side works
 * on both.
 */
export function encodeEpisodeRef(input) {
  return ["animekai", String(input.number), input.episodeUrl, input.audioType ?? "sub"].join("|");
}

export function decodeEpisodeRef(id) {
  if (!String(id ?? "").startsWith("animekai|")) return null;
  const parts = String(id).split("|");
  if (parts.length < 4) return null;
  const episodeUrl = parts[2] ?? "";
  if (!/^https?:\/\//i.test(episodeUrl)) return null;
  return { number: Number(parts[1] ?? "0"), episodeUrl, audioType: parts[3] ?? "sub" };
}

/**
 * Episode ref -> the embed URLs of ONE audio group.
 *
 * `audioType` is honoured strictly, and the strictness is the point.  Measured on
 * One Piece episode 1180 (`data-sub="1"`, no `data-dub`, `langs="1"`): the page
 * publishes a `sub` group and no `dub` group.  Falling back to "whatever the page
 * had" — which is what this provider did before 2026-10-13 — hands the dub-seeker
 * `megaplay.buzz/stream/s-2/233066/sub`, and the caller then labels Japanese audio
 * English.  15 of One Piece's 1,180 rows are shaped like that.  Zero embeds is the
 * honest answer, and `servers` says so.
 *
 * Deduped by URL: both spans of a group carry the same `data-url` (Server 1/2
 * differ only by `data-sid`), so a failover walk over raw spans would hit one CDN
 * twice and call the second attempt a different server.
 */
export async function sources(episodeId, { audioType, signal } = {}) {
  const ref = decodeEpisodeRef(episodeId);
  if (!ref) throw new ApiError("AnimeKai episode id is not an animekai ref", 0);
  // The caller's ask wins; the ref's label is the default for callers who did not
  // ask, and a "both" row defaults to sub — the site's own default toggle, measured
  // as `data-id="sub" style=""` next to `data-id="dub" style="display:none"`.
  const wanted = audioType === "dub" ? "dub" : audioType === "sub" ? "sub" : ref.audioType === "dub" ? "dub" : "sub";
  const { body: html } = await getText(ref.episodeUrl, { headers: providerHeaders, referer: ref.episodeUrl, signal });
  const entries = parseServerSpans(html);
  const typed = entries.filter((entry) => entry.group === "sub" || entry.group === "dub");
  // Only a page whose items carry no recognised group at all answers to either
  // ask; that is a layout surprise, not an audio claim to contradict.
  const scoped = typed.length === 0 ? entries : entries.filter((entry) => entry.group === wanted);
  const embeds = [];
  const seen = new Set();
  for (const entry of scoped) {
    if (seen.has(entry.url)) continue;
    seen.add(entry.url);
    embeds.push(entry.url);
  }
  return {
    embeds,
    subtitles: [],
    audioType: wanted,
    servers: scoped,
    // What the page claimed, so a zero-embed answer can be told apart from a page
    // that changed shape.
    available: { sub: dedupeUrls(entries.filter((e) => e.group === "sub")), dub: dedupeUrls(entries.filter((e) => e.group === "dub")) },
  };
}

const dedupeUrls = (list) => [...new Set(list.map((entry) => entry.url))].length;

// ------------------------------------------------------------ Megaplay embed

function extractPlayerDataId(html) {
  const tag = /<[^>]*id="megaplay-player"[^>]*>/i.exec(html)?.[0];
  return tag ? (/data-id="([^"]+)"/i.exec(tag)?.[1] || undefined) : undefined;
}

function familyIframeUrl(html, hosts) {
  for (const m of html.matchAll(/<iframe\b[^>]*\bsrc="([^"]+)"/gi)) {
    let url; try { url = new URL(m[1]); } catch { continue; }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    const host = url.hostname.toLowerCase();
    if (hosts.some((h) => host === h || host.endsWith(`.${h}`))) return url.toString();
  }
  return undefined;
}

function extractCdnSelector(embedUrl) {
  try { const s = new URL(embedUrl).searchParams.get("s"); return s && /^[a-z]{1,16}$/i.test(s) ? s : undefined; }
  catch { return undefined; }
}

/** AES-256-CBC; key/IV are the player bundle's public client-side literals. */
function decryptMegaPlayEnc(enc) {
  try {
    const key = Buffer.alloc(32), iv = Buffer.alloc(16);
    Buffer.from("i?LMTAx0Q6,:}50U", "utf8").copy(key);
    Buffer.from("W0;27ToaUpl_P%'c", "utf8").copy(iv);
    const d = createDecipheriv("aes-256-cbc", key, iv);
    return Buffer.concat([d.update(Buffer.from(enc.replace(/-/g, "+").replace(/_/g, "/"), "base64")), d.final()]).toString("utf8");
  } catch { return undefined; }
}

const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Token signs the CDN *directory* only (filename-independent), fresh per request. */
export function buildMegaPlayToken(fileUrl, now = Date.now) {
  let path; try { path = new URL(fileUrl).pathname.slice(1); } catch { return undefined; }
  const dir = path.replace(/\/[^/]*\.m3u8$/i, "");
  if (dir === path || dir.length === 0) return undefined;
  const message = `${Math.floor(now() / 1000)}|${dir}`;
  const signature = createHmac("sha256", "MpCdnT0k3n!9f2K#xQ7vL5mR8wN1pY4s").update(message, "utf8").digest();
  return `${b64url(Buffer.from(message, "utf8"))}.${b64url(signature)}`;
}

function recoverFileUrl(payload) {
  if (typeof payload.enc === "string") {
    const dec = decryptMegaPlayEnc(payload.enc);
    if (dec === undefined) return undefined;
    let inner; try { inner = JSON.parse(dec); } catch { return undefined; }
    const file = inner?.file;
    return typeof file === "string" && file.startsWith("http") ? file : undefined;
  }
  const sources = payload.sources;
  if (Array.isArray(sources)) {
    const first = sources[0];
    if (typeof first?.file === "string" && first.file.startsWith("http")) return first.file;
  }
  return typeof payload.file === "string" && payload.file.startsWith("http") ? payload.file : undefined;
}

function originOf(url) { try { return new URL(url).origin; } catch { return "https://megaplay.buzz"; } }

function qualityFromName(name) {
  const m = /(\d{3,4})[pP]/.exec(name);
  const ladder = [240, 360, 480, 720, 1080, 1440, 2160];
  const snap = (h) => !Number.isFinite(h) ? "unknown" : h <= 240 ? 240 : h >= 2160 ? 2160 : ladder.reduce((b, c) => Math.abs(c - h) < Math.abs(b - h) ? c : b);
  return m ? snap(Number(m[1])) : "unknown";
}

function languageFromVttUrl(url) {
  const file = url.slice(url.lastIndexOf("/") + 1);
  if (!/\.vtt$/i.test(file)) return undefined;
  const tokens = file.slice(0, -4).split(/[._-]+/).filter(Boolean);
  for (let i = tokens.length - 1; i >= 0; i--) if (/^[a-z]{2,3}$/i.test(tokens[i])) return tokens[i].toLowerCase();
  return undefined;
}

function parseTracks(payload, referer) {
  const raw = payload.tracks;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t) => t.kind === "captions" || t.kind === "subtitles")
    .map((t, i) => {
      const url = typeof t.file === "string" ? t.file : "";
      const label = typeof t.label === "string" ? t.label : undefined;
      const language = languageFromVttUrl(url) ?? (label ? label.toLowerCase() : "unknown");
      return { id: `megaplay-${i}`, url, language, ...(label ? { name: label } : {}), ...(referer ? { headers: { referer } } : {}) };
    })
    .filter((s) => s.url.length);
}

/**
 * Which audio the embed serves, read off its own path.  AnimeKai hands out
 * `…/stream/mal/<malId>/<ep>/{sub,dub}` for its MAL-keyed titles and
 * `…/stream/s-2/<id>/{sub,dub}` for the rest (measured: episode 1180 of One Piece
 * is an `s-2` row), and both spell the audio in the last segment — so this is the
 * only audio fact the CDN states per file.  Still only a claim:
 * `dubPairVerdict` measures the bytes.
 */
export function audioOfEmbed(embedUrl) {
  const last = decodeURIComponent(String(embedUrl).split("?")[0].replace(/\/+$/, "").slice(embedUrl.lastIndexOf("/") + 1));
  if (/^h?dub$/i.test(last)) return "dub";
  if (/^h?sub$/i.test(last)) return "sub";
  return undefined;
}

/** embed URL -> playable HLS (signed master + variants) + subtitles. */
export async function resolve(embedUrl, { referer, signal } = {}) {
  let page = await getText(embedUrl, { headers: providerHeaders, ...(referer ? { referer } : {}), signal });
  if (!extractPlayerDataId(page.body)) {
    const inner = familyIframeUrl(page.body, MEGAPLAY_HOSTS);
    if (inner) page = await getText(inner, { headers: providerHeaders, referer: page.url, signal });
  }
  const fileId = extractPlayerDataId(page.body);
  if (!fileId) throw new ApiError("no #megaplay-player[data-id] on embed page", 0);

  const cdnSelector = extractCdnSelector(embedUrl) ?? extractCdnSelector(page.url);
  const apiUrl = `${originOf(page.url)}/stream/getSources?id=${encodeURIComponent(fileId)}&platform=OTHER${cdnSelector ? `&s=${cdnSelector}` : ""}`;
  const apiRes = await request(apiUrl, { headers: { ...providerHeaders, "x-requested-with": "XMLHttpRequest" }, referer: page.url, signal });
  if (!apiRes.ok) { await drain(apiRes); throw new ApiError(`getSources ${apiRes.status}`, apiRes.status); }
  let payload; try { payload = await apiRes.json(); } catch { throw new ApiError("getSources body not JSON", 0); }

  const media = recoverFileUrl(payload);
  if (media === undefined) throw new ApiError(typeof payload.enc === "string" ? "enc did not decrypt to {file}" : "no file in getSources payload", 0);

  const token = buildMegaPlayToken(media);
  const streamUrl = token ? `${media}?token=${token}` : media;
  const headers = { referer: `${originOf(page.url)}/` };
  const masterQuality = typeof payload.RESOLUTION === "string" ? qualityFromName(payload.RESOLUTION) : "unknown";
  const audio = audioOfEmbed(embedUrl) ?? audioOfEmbed(page.url);

  // Expand the master into per-variant sources.  The token is directory-scoped,
  // so every variant carries the SAME token; anything that would leave the
  // signed directory is dropped rather than shipped untokenized.  Measured on
  // AnimeKai's embeds: one rung @1080 and 9 subtitle tracks, sub and dub
  // resolving into the SAME signed directory with different file names — which is
  // exactly why the dub verdict hashes segments instead of comparing paths.
  let variants = [{ url: streamUrl, quality: masterQuality, headers }];
  try {
    const master = await getText(streamUrl, { headers, signal });
    const dir = new URL(media).pathname.replace(/\/[^/]*\.m3u8$/i, "");
    const byQuality = new Map();
    for (const v of parseVariants(master.body, streamUrl)) {
      let path; try { path = new URL(v.url).pathname; } catch { continue; }
      if (!path.startsWith(`${dir}/`) || v.url === streamUrl) continue;
      const q = v.height ?? "unknown";
      if (byQuality.has(q) && byQuality.get(q).bandwidth >= v.bandwidth) continue;
      byQuality.set(q, v);
    }
    if (byQuality.size > 0) {
      variants = [...byQuality.values()]
        .sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || b.bandwidth - a.bandwidth)
        .map((v) => ({ url: `${v.url}${token ? `?token=${token}` : ""}`, quality: v.height ?? "unknown", headers }));
    }
  } catch { /* keep the master hand-out */ }

  return {
    provider: "animekai", extractor: "megaplay",
    master: { url: streamUrl, headers },
    variants,
    subtitles: parseTracks(payload, headers.referer),
    ...(audio ? { audio } : {}),
    ...(token ? { note: "token is directory-scoped and expires by unix-seconds freshness; re-resolve, never cache" } : {}),
  };
}

// ------------------------------------------------- HLS -> MPEG-TS download

/** #EXT-X-STREAM-INF variants (I-FRAME preview tracks are not matched -> skipped). */
export function parseVariants(text, baseUrl) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const tag = (lines[i] ?? "").trim();
    if (!/^#EXT-X-STREAM-INF\b/i.test(tag)) continue;
    let media = "";
    for (let j = i + 1; j < lines.length; j++) {
      const c = (lines[j] ?? "").trim();
      if (c === "") continue;
      if (c.startsWith("#")) break;
      media = c; break;
    }
    if (!media) continue;
    let url; try { url = new URL(media, baseUrl).toString(); } catch { continue; }
    const bandwidth = Number(/BANDWIDTH=(\d+)/i.exec(tag)?.[1] ?? "0");
    const h = /RESOLUTION=\d{2,5}x(\d{2,5})/i.exec(tag)?.[1];
    out.push({ url, bandwidth: Number.isFinite(bandwidth) ? bandwidth : 0, ...(h ? { height: Number(h) } : {}) });
  }
  return out;
}

export function pickBestVariant(variants) {
  if (!variants.length) return null;
  return [...variants].sort((a, b) => (b.bandwidth - a.bandwidth) || ((b.height ?? 0) - (a.height ?? 0)))[0];
}

/** media playlist -> { init, segments:[{url, range}], durationSec, keyMethod } */
export function parseMedia(text, baseUrl) {
  const ATTR = (tag, line) => {
    const m = new RegExp(`${tag}=(?:"([^"]*)"|([^",\\s]+))`, "i").exec(line);
    return m ? (m[1] ?? m[2] ?? null) : null;
  };
  const abs = (ref) => { try { return new URL(ref, baseUrl).toString(); } catch { return null; } };
  const segments = [];
  let init = null, durationSec = 0, keyMethod = null, pending = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^#EXT-X-KEY\b/i.test(line)) { const m = (ATTR("METHOD", line) ?? "NONE").toUpperCase(); if (m !== "NONE") keyMethod ??= m; continue; }
    if (/^#EXT-X-MAP\b/i.test(line)) { const u = ATTR("URI", line); if (u) init = abs(u); continue; }
    if (/^#EXT-X-BYTERANGE\b/i.test(line)) {
      const [lenRaw, startRaw] = line.slice(line.indexOf(":") + 1).trim().split("@");
      const length = Number(lenRaw);
      pending = Number.isFinite(length) ? { length, start: startRaw === undefined ? null : Number(startRaw) } : null;
      continue;
    }
    if (/^#EXTINF\b/i.test(line)) { durationSec += Number(line.slice(line.indexOf(":") + 1).split(",")[0]) || 0; continue; }
    if (line.startsWith("#")) continue;
    const url = abs(line);
    if (!url) continue;
    segments.push({ url, range: pending });
    pending = null;
  }
  return { init, segments, durationSec, keyMethod };
}

function rangeHeader(range) {
  return range.start === null ? `bytes=0-${range.length - 1}` : `bytes=${range.start}-${range.start + range.length - 1}`;
}

/**
 * Container sniff on the first downloaded segment.  The same megaplay pipeline on
 * AniKoto answered PNG bytes from a decoy CDN once (measured 2026-10-12), so a
 * download is only believed after its first segment is sniffed — which is also
 * why AnimeKai's `?s=` selector, when a site ever appends one, has to survive
 * being wrong loudly instead of writing pictures.
 */
export function sniffContainer(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf.subarray(1, 4).toString("latin1") === "PNG") return "png";
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8) return "jpeg";
  if (buf.length >= 8 && buf.subarray(4, 8).toString("latin1") === "ftyp") return "mp4";
  if (buf.length > 0 && buf[0] === 0x47) return "mpegts";
  if (/^#EXTM3U/.test(buf.subarray(0, 64).toString("utf8"))) return "playlist";
  return "unknown";
}

const MEDIA_CONTAINERS = new Set(["mp4", "mpegts"]);

/**
 * Download an HLS hand-out into ONE real MPEG-TS (or MP4) file: read the
 * playlist the way a player does — best rendition, then its segments in order
 * (init first for fMP4, honouring #EXT-X-BYTERANGE) — and refuse a keyed stream
 * rather than write ciphertext that passes every size check.
 */
export async function download(signedPlaylistUrl, {
  headers, referer, outPath, signal, onProgress, maxSegments,
} = {}) {
  const reqHeaders = { ...(referer ? { referer } : {}), ...(headers ?? {}) };
  const first = await request(signedPlaylistUrl, { headers: { ...providerHeaders, ...reqHeaders }, signal });
  if (!first.ok) { await drain(first); throw new ApiError(`playlist ${first.status}`, first.status); }
  let baseUrl = first.url || signedPlaylistUrl;
  let text = await first.text();

  const variants = parseVariants(text, baseUrl);
  const best = pickBestVariant(variants);
  if (best) {
    let renditionUrl = best.url;
    const tok = new URL(signedPlaylistUrl).searchParams.get("token");
    if (tok && !renditionUrl.includes("token=")) renditionUrl += `?token=${tok}`;
    const r = await request(renditionUrl, { headers: { ...providerHeaders, ...reqHeaders }, signal });
    if (!r.ok) { await drain(r); throw new ApiError(`rendition ${r.status}`, r.status); }
    text = await r.text();
    baseUrl = r.url || renditionUrl;
  }

  const plan = parseMedia(text, baseUrl);
  if (plan.keyMethod !== null) throw new ApiError(`HLS stream is encrypted (${plan.keyMethod}); the media key is not part of the hand-out`, 0, "ENCRYPTED_STREAM");
  if (plan.segments.length === 0) throw new ApiError("HLS playlist carries no media segments", 0, "EMPTY_STREAM");

  await mkdir(dirname(outPath), { recursive: true });
  const ws = createWriteStream(outPath);
  let streamError = null;
  ws.on("error", (e) => { streamError = e; });
  let bytes = 0;
  const total = plan.segments.length;
  let done = 0;

  const check = () => {
    if (streamError) throw new ApiError(`cannot write file: ${streamError.message}`, 0, "STORAGE_ERROR");
    if (signal?.aborted) throw new ApiError("download aborted", 0, "ABORTED");
  };
  // Drain or close, whichever comes first — and drop the losing listener, or
  // every backpressured chunk leaves one behind and Node warns past ten.
  const waitDrainOrClose = () => new Promise((resolve) => {
    const onDrain = () => { ws.off("close", onClose); resolve(); };
    const onClose = () => { ws.off("drain", onDrain); resolve(); };
    ws.once("drain", onDrain);
    ws.once("close", onClose);
  });
  const writeBody = async (res, { sniff = false } = {}) => {
    if (!res.ok) { await drain(res); throw new ApiError(`segment ${res.status}`, res.status, "SEGMENT_ERROR"); }
    if (!res.body) throw new ApiError("segment empty body", 0, "EMPTY_BODY");
    if (sniff) {
      // Segment 1 is buffered whole so its container is proven before the rest
      // of the episode transfers.
      const buf = Buffer.from(await res.arrayBuffer());
      const kind = sniffContainer(buf);
      if (!MEDIA_CONTAINERS.has(kind)) {
        throw new ApiError(`segments are ${kind}, not video — decoy CDN, try the next embed`, 0, "DECOY_CDN");
      }
      bytes += buf.length;
      if (!ws.write(buf)) await waitDrainOrClose();
      return;
    }
    for await (const chunk of Readable.fromWeb(res.body)) {
      bytes += chunk.length;
      if (!ws.write(chunk)) await waitDrainOrClose();
      check();
    }
  };

  try {
    // Node reports a bad path on `open`, one tick late.  Awaiting it is what
    // turns ENOENT into an honest error instead of counted bytes with no file.
    await once(ws, "open");
    if (plan.init) await writeBody(await request(plan.init, { headers: { ...providerHeaders, ...reqHeaders }, signal }));
    for (const seg of plan.segments) {
      if (signal?.aborted) throw new ApiError("download aborted", 0, "ABORTED");
      const h = seg.range === null ? reqHeaders : { ...reqHeaders, range: rangeHeader(seg.range) };
      await writeBody(await request(seg.url, { headers: { ...providerHeaders, ...h }, signal }), { sniff: done === 0 });
      done++;
      onProgress?.({ bytes, percent: Math.round((done / total) * 100), segment: done, of: total });
      // A preview stops cleanly: a truncated MPEG-TS keeps its 0x47 sync
      // structure, so the head of the file still plays.
      if (maxSegments !== undefined && done >= maxSegments) break;
    }
    ws.end();
    await once(ws, "close");
    check();
    return { outPath, sizeBytes: bytes, mimeType: plan.init !== null ? "video/mp4" : "video/mp2t", segments: total, durationSec: Math.round(plan.durationSec) };
  } catch (e) {
    ws.destroy();
    await rm(outPath, { force: true }).catch(() => undefined);
    throw e instanceof ApiError ? e : new ApiError(String(e?.message ?? e), 0, "NETWORK_ERROR");
  }
}

// --------------------------------------------------------------- convenience

/** search -> details -> episodes -> sources -> resolve -> download. */
export async function downloadEpisode(query, episodeNumber, outPath, { signal, onProgress, audioType = "sub", maxSegments } = {}) {
  const results = await search(query, { signal });
  const hit = results[0];
  if (!hit) throw new ApiError(`search for "${query}" returned nothing on AnimeKai`, 0);
  const { media, episodes } = await details(hit.id, { signal });
  const ep = episodes.find((e) => e.number === Number(episodeNumber)) ?? episodes[Number(episodeNumber) - 1];
  if (!ep) throw new ApiError(`episode ${episodeNumber} not listed for ${media.title}`, 0);
  const { embeds } = await sources(ep.id, { audioType, signal });
  if (!embeds.length) throw new ApiError(`no ${audioType} embed for ${media.title} ep ${episodeNumber} (the site publishes no such group)`, 0);
  // Try each embed until one downloads a real media container: "playable" is
  // proven by the written bytes, not by the embed URL resolving.
  let lastError = null;
  for (const embed of embeds) {
    try {
      const resolved = await resolve(embed, { referer: defaultAnimeKaiReferer, signal });
      const pick = resolved.variants[0];
      const result = await download(pick.url, { referer: pick.headers?.referer, outPath, signal, onProgress, maxSegments });
      return {
        media: media.title, episode: ep.number, embed,
        cdn: new URL(pick.url).host,
        audio: resolved.audio ?? audioType,
        ...result,
      };
    } catch (e) {
      lastError = e;
      if (e?.code === "DECOY_CDN") continue;
      if (e?.name === "AbortError" || signal?.aborted) throw e;
    }
  }
  throw lastError ?? new ApiError("no embed produced a real video file", 0);
}

export async function details(idOrSlugOrUrl, { signal } = {}) {
  const page = await firstEpisodePageFor(idOrSlugOrUrl, signal);
  const media = mediaFromPage(page.url, page.html);
  return { media, episodes: parseEpisodeAnchors(ANIMEKAI_MAIN, page.html, media.id) };
}

export async function episodes(idOrSlugOrUrl, { signal } = {}) {
  return (await details(idOrSlugOrUrl, { signal })).episodes;
}

export class ApiError extends Error {
  constructor(message, status = 0, code = "ERROR") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Is THIS site's `/dub` file its own bytes or a copy of its `/sub`?  Measures the
 * first media segment of both (see `dubAudio.mjs` for the census behind the rule).
 * AnimeKai needs the measurement more than most: its page prints the claim as
 * markup (`<span class="dub">12</span>` next to `<span class="sub">12</span>`) and
 * its sub and dub embeds resolve into the SAME signed CDN directory, so nothing
 * about the paths proves the audio is different — only the bytes do.
 */
export const dubPairVerdict = makeDubPairVerdict(resolve, defaultAnimeKaiReferer);
