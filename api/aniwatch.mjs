// @ts-check
/**
 * AniWatch API — one provider, end to end.
 *
 * Dependency-free port of the AniWatch chain, proven against the live site on
 * 2026-10-12:  search -> series page -> episode list -> server list -> embed ->
 * playable HLS -> downloaded MPEG-TS.  Runs on plain Node 18+ with global
 * `fetch` and `node:crypto`; nothing here imports from AniVerse or from
 * anikoto.mjs — the file is self-contained so it can be copied out alone.
 *
 *   search(term)                    -> [{ id, slug, title, coverUrl, ... }]
 *   details(idOrSlugOrUrl)          -> { media, episodes:[{ id, number, title }] }
 *   sources(episodeId, {audioType}) -> { embeds:[url], audioByEmbed }
 *   resolve(embedUrl, {referer})    -> { master, variants, subtitles, audio }
 *   download(signedPlaylistUrl)     -> one real MPEG-TS file
 *   downloadEpisode(q, ep, out)     -> one-call convenience
 *
 * Chain, every hop measured live on 2026-10-12 (Solo Leveling Season 2):
 *
 *   GET /wp-json/hianime/v1/search/suggestions?keyword=<q>   200, 2 cards
 *   GET /anime/<slug>/                                       200, data-animeid=2138
 *   GET /wp-json/hianime/v1/episode/list/2138                200, 13 episodes
 *   GET /wp-json/hianime/v1/episode/servers/2140             200, rows {sub:1,dub:1}
 *   GET  embed 1anime.site/megaplay/stream/s-2/131394/{sub,dub}
 *   GET  <megaplay origin>/stream/getSources?id=<data-id>&platform=OTHER
 *        -> enc -> AES-256-CBC -> file
 *        https://fetch.nexabloom.top/anime/<dir>/<hash>/master.m3u8?token=...
 *        1 variant @1080, 5 subtitle tracks (chi eng ind tha vie)
 *   GET  master + segment 1 -> 436,536 B (sub) / 541,816 B (dub), starts 0x47
 *        with 0x47 on every 188-byte stride: real MPEG-TS, playlist 1420 s.
 *
 * The REST namespace is `hianime/v1` and every envelope carries its payload as
 * an `html` string of escaped JSON — the HTML must be read out of the envelope
 * before any regex touches it, or the parse runs on `\/`-escaped text and finds
 * nothing (measured: 0 hits that way, 2 hits done right).
 *
 * AniWatch is a WordPress deployment of the "Zoro Tv" theme; its own player
 * hands out Megaplay embeds, which is why the same token-bearing HLS pipeline
 * that AniKoto uses resolves this site's embeds too.  `resolve()` stamps
 * `provider:"aniwatch"` — provenance is per-call, not baked into the pipeline.
 */

import { createDecipheriv, createHmac } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { once } from "node:events";
import { makeDubPairVerdict } from "./dubAudio.mjs";

const ANIWATCH_MAIN = "https://aniwatch.co.at";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const MEGAPLAY_HOSTS = [
  "megaplay.buzz", "megaplay-1.buzz",
  "vidwish.live", "vidwish.to",
  "vidtube.site", "vidtube.me",
  "1anime.site", // thin wrapper whose whole body is one megaplay iframe
];

export const defaultAniWatchReferer = `${ANIWATCH_MAIN}/`;

// --------------------------------------------------------------------- HTTP

/**
 * Referer + X-Requested-With are what the REST endpoints check (measured 200s);
 * a duplicate Referer makes the megaplay CDN 403, so it is merged, never added
 * twice.
 */
async function request(url, { headers, referer, signal, method = "GET" } = {}) {
  const merged = { ...(referer ? { referer } : {}), ...(headers ?? {}) };
  return fetch(url, { method, ...(signal ? { signal } : {}), headers: merged });
}

/**
 * A response whose body is never consumed cannot go back to the connection pool, so
 * each refused request costs a live socket.  Every `!res.ok` throw in this file
 * drains first.
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
  return { body: await res.text(), url: res.url || url, headers: res.headers, res };
}

const providerHeaders = { "user-agent": USER_AGENT };
const ajaxHeaders = {
  "user-agent": USER_AGENT,
  "x-requested-with": "XMLHttpRequest",
  accept: "application/json, text/javascript, */*",
};

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

/**
 * The REST envelopes carry their payload as `html`, JSON-escaped.  Returning ""
 * for a non-envelope body keeps a hard HTML page (a block or an interstitial)
 * from being regex-parsed as if it were a fragment.
 */
export function fragmentHtml(body) {
  const t = body.trim();
  if (!t.startsWith("{")) return "";
  try {
    const p = JSON.parse(t);
    return typeof p.html === "string" ? p.html : "";
  } catch { return ""; }
}

// --------------------------------------------------------------- title rank

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

// ----------------------------------------------------------------- provider

/**
 * Suggestions endpoint (the theme publishes no full-search route).  Cards are
 * `<a href="/anime/<slug>/" class="nav-item">` with `img[data-src]` poster,
 * `.film-name` text and `data-jname` original title.
 */
export async function search(term, { signal } = {}) {
  const query = normalizeUnicodeToAscii(term.trim());
  if (!query) return [];
  const url = `${ANIWATCH_MAIN}/wp-json/hianime/v1/search/suggestions?keyword=${encodeURIComponent(query)}`;
  const { body } = await getText(url, { headers: ajaxHeaders, referer: defaultAniWatchReferer, signal });
  const html = fragmentHtml(body);
  const seen = new Set();
  const scored = [];
  for (const m of html.matchAll(/<a\b[^>]*\bhref="([^"]*\/anime\/[^"]*)"[^>]*>[\s\S]*?<\/a>/gi)) {
    const slug = m[1]?.match(/\/anime\/([^"/?#]+)/i)?.[1] ?? "";
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    const chunk = m[0];
    const nameTag = chunk.match(/<[^>]+class="[^"]*\bfilm-name\b[^"]*"[^>]*>([\s\S]*?)<\/[^>]*>/i);
    const title =
      clean(nameTag?.[1]) ?? clean(attr(chunk, /<img[^>]*\balt="([^"]*)"/i)) ?? slug;
    const original = nameTag ? attr(nameTag[0], /\bdata-jname="([^"]*)"/i) : undefined;
    const cover = attr(chunk, /<img[^>]*\bdata-src="([^"]*)"/i);
    scored.push({
      media: {
        id: `aniwatch:${slug}`, slug, kind: "anime", title,
        ...(original && original !== title ? { originalTitle: original } : {}),
        ...(cover ? { coverUrl: fixUrl(ANIWATCH_MAIN, cover) } : {}),
      },
      score: similarity(query, title),
    });
  }
  // score desc, then shortest title (base series beats its spin-offs), then id.
  return scored.sort((a, b) =>
    (b.score - a.score) ||
    (normalizeTitle(a.media.title).length - normalizeTitle(b.media.title).length) ||
    a.media.id.localeCompare(b.media.id),
  ).map((s) => s.media);
}

/**
 * Accepts `aniwatch:<slug>`, a bare slug, a `/anime/<slug>/` path or any URL on
 * the site.  The numeric series id is deliberately not accepted: episode/list
 * needs it, but every user-facing entry point yields the slug.
 */
function animeUrlFor(id) {
  const raw = id.trim();
  if (raw.startsWith("http")) return raw;
  const bare = raw.replace(/^aniwatch:/, "").replace(/^\/+/, "");
  if (/^\d+$/.test(bare)) {
    throw new ApiError(`AniWatch cannot open a details page from the numeric id ${bare}; it needs the /anime/<slug> locator`, 0);
  }
  if (bare.startsWith("anime/")) return `${ANIWATCH_MAIN}/${bare}`;
  return `${ANIWATCH_MAIN}/anime/${bare}/`;
}

function mediaFromPage(url, html) {
  const slug = url.match(/\/anime\/([^"/?#]+)/i)?.[1] ?? "";
  if (!slug) throw new ApiError("AniWatch page exposes no /anime/<slug> path", 0);
  const animeId = attr(html, /\bdata-animeid="(\d+)"/i) ?? "";
  if (!animeId) throw new ApiError("AniWatch page exposes no data-animeid", 0);
  const titleElement = html.match(/<[^>]+class="[^"]*\bfilm-name\b[^"]*"[^>]*>([\s\S]*?)<\/[^>]*>/i);
  const title =
    clean(titleElement?.[1]) ??
    attr(html, /<meta property="og:title" content="([^"]*)"/i)?.replace(/\s*[-–|]\s*Watch.*$/i, "") ??
    `AniWatch ${slug}`;
  const original = titleElement
    ? attr(titleElement[0], /\bdata-jname="([^"]*)"/i)
    : attr(html, /\bdata-jname="([^"]*)"/i);
  const description = clean(html.match(/<div class="film-description[\s\S]*?<div class="text"[^>]*>([\s\S]*?)<\/div>/i)?.[1]);
  return {
    animeId,
    media: {
      id: `aniwatch:${slug}`, slug, kind: "anime", title,
      ...(original && original !== title ? { originalTitle: original } : {}),
      coverUrl: fixUrl(ANIWATCH_MAIN, attr(html, /<meta property="og:image" content="([^"]*)"/i)),
      ...(description ? { description } : {}),
      // Nothing else is published here to read: `data-duration`, `data-count`,
      // `data-jp`, `itemprop` and the genre anchors are all absent from the
      // 147,504-byte page (measured by indexOf, not by a regex that could miss),
      // so year/genres/runtime/duration stay off the model rather than being
      // guessed from the title.
    },
  };
}

/** a.ep-item rows: [data-number][data-id][href], title in `title=`. */
async function episodesFor(mediaId, animeId, animeUrl, signal) {
  const { body } = await getText(
    `${ANIWATCH_MAIN}/wp-json/hianime/v1/episode/list/${animeId}`,
    { headers: ajaxHeaders, referer: animeUrl, signal },
  );
  const html = fragmentHtml(body);
  const episodes = [];
  for (const m of html.matchAll(/<a\b[^>]*\bclass="[^"]*\bep-item\b[^"]*"[^>]*>[\s\S]*?<\/a>/gi)) {
    const tag = m[0];
    const episodeId = attr(tag, /\bdata-id="(\d+)"/i) ?? "";
    const href = attr(tag, /\bhref="([^"]*)"/i) ?? "";
    if (!episodeId || !href) continue;
    const number = Number(attr(tag, /\bdata-number="(\d+)"/i)) || episodes.length + 1;
    const name =
      clean(tag.match(/class="[^"]*\bep-name\b[^"]*"[^>]*>([\s\S]*?)<\/[^>]*>/i)?.[1]) ??
      attr(tag, /\btitle="([^"]*)"/i);
    episodes.push({
      id: encodeEpisodeRef({ episodeId, number, episodeUrl: fixUrl(ANIWATCH_MAIN, href) }),
      mediaId, seasonNumber: 1, number,
      title: name ?? `Episode ${number}`,
      url: fixUrl(ANIWATCH_MAIN, href),
      // The listing row does not say which audio it carries: sub and dub are
      // separate rows only at episode/servers.  Measured 2026-10-12 across all
      // 13 episodes of Solo Leveling Season 2: every row publishes exactly one
      // `data-type=sub` and one `data-type=dub` server, both named "HD-1" — so
      // the site's episode row is its SUB/DUB toggle rather than one audio.
      // `both` is what the player's audio rule needs for that shape: the row can
      // serve either, and which one played is only knowable from the files.
      audioType: "both",
    });
  }
  episodes.sort((a, b) => a.number - b.number);
  return episodes;
}

export async function details(idOrSlugOrUrl, { signal } = {}) {
  const url = animeUrlFor(idOrSlugOrUrl);
  const { body: html } = await getText(url, { headers: providerHeaders, referer: defaultAniWatchReferer, signal });
  const core = mediaFromPage(url, html);
  return { media: core.media, episodes: await episodesFor(core.media.id, core.animeId, url, signal) };
}

export async function episodes(idOrSlugOrUrl, { signal } = {}) {
  return (await details(idOrSlugOrUrl, { signal })).episodes;
}

/**
 * `.server-item[data-type=sub|dub][data-hash]`; `data-hash` is standard base64
 * of the embed URL (measured: both rows decode to
 * `https://1anime.site/megaplay/stream/s-2/131394/{sub,dub}`).  A hash that
 * decodes to anything but http(s) is a site change, not an embed, so it is
 * dropped rather than passed on to fail downstream.
 */
export function parseServerItems(html) {
  const out = [];
  for (const m of html.matchAll(/<div\b[^>]*\bclass="[^"]*\bserver-item\b[^"]*"[^>]*>/gi)) {
    const tag = m[0];
    const rawType = (attr(tag, /\bdata-type="([^"]*)"/i) ?? "").toLowerCase();
    const hash = attr(tag, /\bdata-hash="([^"]*)"/i) ?? "";
    if (!hash) continue;
    out.push({
      type: rawType === "dub" ? "dub" : rawType === "sub" ? "sub" : "",
      name: attr(tag, /\bdata-server-name="([^"]*)"/i) ?? "",
      embed: decodeHash(hash),
    });
  }
  return out.filter((item) => item.embed);
}

export function decodeHash(hash) {
  try {
    const decoded = Buffer.from(hash, "base64").toString("utf8").trim();
    return /^https?:\/\//i.test(decoded) ? decoded : undefined;
  } catch { return undefined; }
}

/** episode id (opaque ref) -> embed URLs, scoped to the audio asked for. */
export async function sources(episodeId, { audioType = "sub", signal } = {}) {
  const ref = decodeEpisodeRef(episodeId);
  if (!ref) throw new ApiError("AniWatch episode id is not an aniwatch ref", 0);
  const referer = ref.episodeUrl || defaultAniWatchReferer;
  const { body } = await getText(
    `${ANIWATCH_MAIN}/wp-json/hianime/v1/episode/servers/${ref.episodeId}`,
    { headers: ajaxHeaders, referer, signal },
  );
  const html = fragmentHtml(body);
  const entries = parseServerItems(html);
  const wanted = audioType === "dub" ? "dub" : "sub";
  // A `sub` row is the Japanese audio, so it is not opened on a dub ask.  This
  // used to fall back to `entries` when the asked group was empty, and the live
  // chain proved what that costs: a dub ask on a title the site does not dub
  // (measured 2026-10-12: Solo Leveling, and AniKoto's `link={sub:1,dub:0}` rows)
  // came back with the SUB embeds, which the caller then labelled dub.  Zero
  // embeds is the honest answer, and `servers` says so.  Rows with no `data-type`
  // answer to either ask: they carry no audio claim to contradict.
  const scoped = entries.filter((e) => e.type === wanted || e.type === "");
  const embeds = [];
  const seen = new Set();
  for (const entry of scoped) {
    if (!entry.embed || seen.has(entry.embed)) continue;
    seen.add(entry.embed);
    embeds.push(entry.embed);
  }
  return { embeds, subtitles: [], audioType: wanted, servers: scoped };
}

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
 * Which audio the embed serves, read off its own path.  AniWatch puts the
 * audio in the last segment of the embed URL
 * (`…/stream/s-2/131394/sub`, `…/131394/dub`), which is the only audio fact
 * the site states per file — so the player can label the Audio menu from it
 * instead of guessing from the row.
 */
export function audioOfEmbed(embedUrl) {
  const last = decodeURIComponent(embedUrl.split("?")[0].replace(/\/+$/, "").slice(embedUrl.lastIndexOf("/") + 1));
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
  const apiRes = await request(apiUrl, { referer: page.url, headers: { "x-requested-with": "XMLHttpRequest" }, signal });
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
  // AniWatch's embeds: one rendition @1080, not AniKoto's nine.
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
    provider: "aniwatch", extractor: "megaplay",
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
 * Container sniff on the first downloaded segment.  Measured 2026-10-12 on the
 * same series: AniWatch's embeds resolve to `fetch.nexabloom.top` and answer
 * `47 …` with 0x47 every 188 bytes, i.e. real MPEG-TS — but the same megaplay
 * pipeline on AniKoto answered PNG bytes from a decoy CDN once, so a download
 * is only believed after its first segment is sniffed.
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
  const first = await request(signedPlaylistUrl, { headers: reqHeaders, signal });
  if (!first.ok) { await drain(first); throw new ApiError(`playlist ${first.status}`, first.status); }
  let baseUrl = first.url || signedPlaylistUrl;
  let text = await first.text();

  const variants = parseVariants(text, baseUrl);
  const best = pickBestVariant(variants);
  if (best) {
    let renditionUrl = best.url;
    const tok = new URL(signedPlaylistUrl).searchParams.get("token");
    if (tok && !renditionUrl.includes("token=")) renditionUrl += `?token=${tok}`;
    const r = await request(renditionUrl, { headers: reqHeaders, signal });
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
    if (plan.init) await writeBody(await request(plan.init, { headers: reqHeaders, signal }));
    for (const seg of plan.segments) {
      if (signal?.aborted) throw new ApiError("download aborted", 0, "ABORTED");
      const h = seg.range === null ? reqHeaders : { ...reqHeaders, range: rangeHeader(seg.range) };
      await writeBody(await request(seg.url, { headers: h, signal }), { sniff: done === 0 });
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
  if (!hit) throw new ApiError(`search for "${query}" returned nothing on AniWatch`, 0);
  const { media, episodes } = await details(hit.id, { signal });
  const ep = episodes.find((e) => e.number === Number(episodeNumber)) ?? episodes[Number(episodeNumber) - 1];
  if (!ep) throw new ApiError(`episode ${episodeNumber} not listed for ${media.title}`, 0);
  const { embeds } = await sources(ep.id, { audioType, signal });
  if (!embeds.length) throw new ApiError(`no embeds for ${media.title} ep ${episodeNumber}`, 0);
  // Try each embed until one downloads a real media container: "playable" is
  // proven by the written bytes, not by the embed URL resolving.
  let lastError = null;
  for (const embed of embeds) {
    try {
      const resolved = await resolve(embed, { referer: defaultAniWatchReferer, signal });
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

export class ApiError extends Error {
  constructor(message, status = 0, code = "ERROR") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Episode ids must survive the round trip: the listing is parsed before anybody
 * asks for sources, so the numeric episode id and its page URL — the referer the
 * site's own player sends — ride on the id.
 */
export function encodeEpisodeRef(input) {
  return ["aniwatch", input.episodeId, String(input.number), input.episodeUrl].join("|");
}

export function decodeEpisodeRef(id) {
  if (!id.startsWith("aniwatch|")) return null;
  const parts = id.split("|");
  if (parts.length < 4) return null;
  const episodeId = parts[1] ?? "";
  if (!/^\d+$/.test(episodeId)) return null;
  return { episodeId, number: Number(parts[2] ?? "0"), episodeUrl: parts.slice(3).join("|") };
}

export const PROVIDER = { id: "aniwatch", name: "AniWatch", baseUrl: ANIWATCH_MAIN, language: "en" };

/**
 * Is THIS site's `/dub` file its own bytes or a copy of its `/sub`?  Measures the
 * first media segment of both (see `dubAudio.mjs` for the 14-pair census behind the
 * rule); the `audio` field on `resolve()` above is only the site's claim.
 */
export const dubPairVerdict = makeDubPairVerdict(resolve, defaultAniWatchReferer);
