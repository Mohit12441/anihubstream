// @ts-check
/**
 * AnimeWave API — one provider, end to end.
 *
 * A standalone, dependency-free port of the AnimeWave (animewave.to) chain,
 * recovered by live HTTP measurement on 2026-10-13 and re-proven against the
 * running site — every endpoint, header and parsing rule below was read off a
 * real response, not guessed.  It runs on plain Node 18+ with the global `fetch`
 * and `node:crypto` only; nothing here imports from AniVerse.
 *
 * AnimeWave is the same CMS family as AniKoto: the episode/server layer is
 * byte-shape identical (`data-ids` opaque token -> `div.type[data-type]` groups
 * -> `li[data-link-id]` -> Megaplay embed), so the MegaPlay/HLS pipeline below
 * is the AniKoto one, kept verbatim on purpose — a shared module would make one
 * provider's CDN change silently break the other's proof.  Only the search and
 * details layers differ, and those differences are the interesting part:
 *
 *   search(term)                 -> [{ id, slug, title, coverUrl, ... }]
 *   details(idOrSlugOrUrl)       -> { media, episodes:[{ id, number, title, audioType }] }
 *   sources(episodeId,{audioType})-> { embeds:[url], audioType, available, skip? }  only
 *                                  the asked group; an absent group answers with zero
 *                                  embeds and `available` says what the page published
 *   resolve(embedUrl, referer)   -> { provider:"animewave", master, variants, subtitles, audio? }
 *   dubPairVerdict(sub,dub)      -> { verdict:"copy"|"distinct"|"unknown", ... }
 *   download(signedPlaylistUrl)  -> writes one real MPEG-TS file, returns { sizeBytes, mimeType }
 *   downloadEpisode(term, ep, out)-> one-call search->resolve->download convenience
 *
 * Route map, measured 2026-10-13 (all four ajax routes are same-origin JSON
 * envelopes whose `result` is HTML, and the HTML arrives `\/`-escaped — unwrap
 * the envelope before regexing anything):
 *
 *   GET /ajax/anime/search?keyword=<q>     {status,result:{html}}   <- nested, one level
 *   GET /watch/<slug>                      <div id="watch-main" data-id data-url>
 *   GET /ajax/episode/list/<id>?vrf=       {status,result:"<html>"} <- bare string
 *   GET /ajax/server/list?servers=<token>  {status,result:"<html>"}
 *   GET /ajax/server?get=<linkId>          {status,result:{url,skip_data}}
 *
 * The ajax header is not decoration.  Measured side by side on the same URL:
 *
 *   /ajax/anime/search?keyword=one piece   with x-requested-with -> 200, 3,939 B, 5 slugs
 *   /ajax/anime/search?keyword=one piece   without               -> 200, 50 B,
 *                                                                   {"status":500,"result":"Bad request"}
 *
 * That 50-byte answer is HTTP 200 with a JSON body that *looks* like the site is
 * broken, which is exactly how an earlier survey filed this provider as "search
 * answers 500 — dead".  It was never dead; the probe sent no `x-requested-with`.
 */

import { createDecipheriv, createHmac } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { once } from "node:events";
import { makeDubPairVerdict } from "./dubAudio.mjs";

const ANIMEWAVE_MAIN = "https://animewave.to";
const MEGAPLAY_HOSTS = [
  "megaplay.buzz", "megaplay-1.buzz",
  "vidwish.live", "vidwish.to",
  "vidtube.site", "vidtube.me",
  "1anime.site", // thin wrapper whose whole body is one megaplay iframe
];
/** The two headers the ajax routes check.  Drop the first and every route below
 *  answers 200 with `{"status":500,"result":"Bad request"}`. */
const ajaxHeaders = { "x-requested-with": "XMLHttpRequest", accept: "application/json, text/javascript, */*" };

// --------------------------------------------------------------------- HTTP

/**
 * Minimal fetch wrapper.  Referer and X-Requested-With are the headers the
 * AniKoto-family ajax endpoints and the Megaplay CDN actually check; a duplicate
 * Referer makes the nexabloom CDN 403, so it is merged, never added twice.
 */
async function request(url, { headers, referer, signal, method = "GET" } = {}) {
  const merged = { ...(referer ? { referer } : {}), ...(headers ?? {}) };
  return fetch(url, { method, ...(signal ? { signal } : {}), headers: merged });
}

/**
 * A response whose body is never consumed cannot go back to the connection pool,
 * so each refused request costs a live socket.  Every `!res.ok` throw here
 * drains first.  This is NOT the fix for libuv's `UV_HANDLE_CLOSING` assertion /
 * exit 127 — that is `cli.mjs` never calling `process.exit()` over a live socket.
 */
async function drain(res) {
  await res.body?.cancel().catch(() => {});
}

async function getText(url, opts = {}) {
  const res = await request(url, opts);
  if (!res.ok) { await drain(res); throw new ApiError(`fetch ${url} -> ${res.status}`, res.status); }
  return { body: await res.text(), url: res.url || url, headers: res.headers, res };
}

async function getAjax(url, referer, signal) {
  const { body } = await getText(url, { headers: ajaxHeaders, referer, signal });
  return body;
}

// -------------------------------------------------------- AnimeWave provider

/**
 * Curly quotes / non-ASCII dashes -> ASCII.  Carried for contract parity with
 * the sibling exports: unlike AniKoto, this site answers a curly-quoted or
 * colon-bearing query with 200 and the same five cards (measured 2026-10-13,
 * `“` and `:` variants both fine), so nothing here depends on the rewrite.
 */
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
 * The search route answers HTTP 200 in more than one situation, so the envelope —
 * not `res.ok` — decides.  Bodies measured live 2026-10-13:
 *
 *   {status:200,result:{html:"…",count:"5",linkMore:"…"}}   3,965 B, 5 real cards
 *   {status:200,result:{html:'<div class="scaff items"></div>',count:"0"}}  207 B, nothing matched
 *   {status:500,result:"Bad request"}                        50 B, sent without `x-requested-with`
 *
 * The first two are answers (`result` is an object carrying an `html` string); the
 * third is a fault, because `result` is a *string*.  Reading that as "zero results"
 * is exactly what made an earlier survey retire this site as dead, so it raises.
 * `count` is the site's own tally, which lets a markup change that breaks
 * parseItemCards report as a fault too instead of as an empty-handed site.
 */
export function readSearchEnvelope(body) {
  const trimmed = body.trim();
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, reason: `body is not JSON (${trimmed.length} B)` };
  }
  const result = parsed?.result;
  if (typeof result === "string") {
    return { ok: false, reason: `status=${parsed?.status} result=${JSON.stringify(result.slice(0, 60))}` };
  }
  if (!result || typeof result !== "object" || typeof result.html !== "string") {
    return { ok: false, reason: `no result.html in a ${trimmed.length} B body (status=${parsed?.status})` };
  }
  const declared = Number(result.count);
  if (Number.isFinite(declared) && declared > 0 && !/\/watch\//i.test(result.html)) {
    return { ok: false, reason: `count=${result.count} but the fragment carries no /watch/ anchors` };
  }
  return { ok: true, html: result.html };
}

function jsonHtml(body) {
  const t = body.trim();
  if (!t.startsWith("{")) return t;
  try {
    const p = JSON.parse(t);
    if (typeof p.html === "string") return p.html;
    if (typeof p.result === "string") return p.result;
    if (p.result && typeof p.result.html === "string") return p.result.html;
    return "";
  } catch { return t; }
}

function jsonResultUrl(body) {
  const t = body.trim();
  if (!t.startsWith("{")) return undefined;
  try {
    const p = JSON.parse(t);
    if (typeof p.result === "string") return p.result;
    if (p.result && typeof p.result.url === "string") return p.result.url;
    return typeof p.url === "string" ? p.url : undefined;
  } catch { return undefined; }
}

function jsonResultSkip(body) {
  const t = body.trim();
  if (!t.startsWith("{")) return undefined;
  try {
    const sd = JSON.parse(t).result?.skip_data;
    if (!sd) return undefined;
    const pair = (v) => (Array.isArray(v) && v.length >= 2 && Number.isFinite(Number(v[0])) && Number.isFinite(Number(v[1])) && !(Number(v[0]) === 0 && Number(v[1]) === 0)
      ? [Number(v[0]), Number(v[1])] : undefined);
    // Measured on every AnimeWave embed probed: `skip_data:{intro:[0,0],outro:[0,0]}`
    // — the field is present and empty, so an all-zero pair is no marks at all.
    const out = {};
    const intro = pair(sd.intro), outro = pair(sd.outro);
    if (intro) out.intro = intro;
    if (outro) out.outro = outro;
    return Object.keys(out).length ? out : undefined;
  } catch { return undefined; }
}

function mediaSlugOf(url) { return url.match(/\/watch\/([^"/?#]+)/i)?.[1]; }

function watchUrlFor(id) {
  const raw = id.trim();
  if (raw.startsWith("http")) return raw;
  const bare = raw.replace(/^animewave:/, "").replace(/^\/+/, "");
  if (/^\d+$/.test(bare)) {
    throw new ApiError(`AnimeWave cannot open a watch page from the numeric id ${bare}; it needs the /watch/<slug> locator`, 0);
  }
  if (bare.startsWith("watch/")) return `${ANIMEWAVE_MAIN}/${bare}`;
  return `${ANIMEWAVE_MAIN}/watch/${bare}`;
}

// Ranking only.  This is the same minimal similarity rule the sibling exports
// use; it orders search hits and never decides whether a title is a match.
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

/**
 * Search cards are whole anchors, not `div.flw-item`s like AniKoto:
 * `<a class="item" href="https://animewave.to/watch/<slug>">` with
 * `img src` (cdn.anipixcdn.co), `div.name.d-title[data-jp]` and a `.meta` rail.
 * Only anchors pointing at `/watch/<slug>` count, because `.item` is also the
 * class the home rails use.
 */
export function parseItemCards(main, html) {
  const out = [];
  for (const match of html.matchAll(/<a\b[^>]*\bhref="([^"]*\/watch\/[^"]*)"[^>]*>[\s\S]*?<\/a>/gi)) {
    const chunk = match[0];
    const slug = (match[1] ?? "").match(/\/watch\/([^"/?#]+)/i)?.[1] ?? "";
    if (!slug) continue;
    const nameTag = chunk.match(/<[^>]+class="[^"]*\bname\b[^"]*"[^>]*>([\s\S]*?)<\/[^>]*>/i)?.[0];
    const title = clean(nameTag) ?? clean(attr(chunk, /<img[^>]*\balt="([^"]*)"/i)) ?? slug;
    const jname = nameTag ? attr(nameTag, /\bdata-jp="([^"]*)"/i) : undefined;
    const cover = fixUrl(main, attr(chunk, /<img[^>]*\bsrc="([^"]*)"/i));
    out.push({
      media: {
        id: `animewave:${slug}`, slug, kind: "anime", title,
        ...(jname && jname !== title ? { originalTitle: jname } : {}),
        ...(cover ? { coverUrl: cover } : {}),
      },
    });
  }
  return out;
}

/** search(term) -> ranked [{ id, slug, title, coverUrl?, originalTitle? }]. */
export async function search(term, { signal } = {}) {
  const query = normalizeUnicodeToAscii(term.trim());
  if (!query) return [];
  const url = `${ANIMEWAVE_MAIN}/ajax/anime/search?keyword=${encodeURIComponent(query)}`;
  const body = await getAjax(url, `${ANIMEWAVE_MAIN}/`, signal);
  const envelope = readSearchEnvelope(body);
  if (!envelope.ok) {
    // A fault, not an empty result set — see readSearchEnvelope.
    throw new ApiError(`AnimeWave search rejected the request: ${envelope.reason}`, 0, "UPSTREAM_REJECTED");
  }
  const html = envelope.html;
  const seen = new Set();
  const scored = [];
  for (const { media } of parseItemCards(ANIMEWAVE_MAIN, html)) {
    if (seen.has(media.id)) continue;
    seen.add(media.id);
    scored.push({ media, score: similarity(query, media.title) });
  }
  // score desc, then shortest title (base series beats spin-off), then id.
  return scored.sort((a, b) =>
    (b.score - a.score) ||
    (normalizeTitle(a.media.title).length - normalizeTitle(b.media.title).length) ||
    a.media.id.localeCompare(b.media.id),
  ).map((s) => s.media);
}

/**
 * The watch page's detail column.  Measured labels (`Type:`, `Premiered:`,
 * `Aired:`, `Status:`, `Genres:` in `.bmeta .meta`, then `MAL:`, `Duration:`,
 * `Episodes:` in the second) are matched as text, not guessed from a schema.
 * The year is read off `Aired:` first and the `Premiered:` link's `year[]=`
 * query second, because that is where the four digits actually sit.
 */
function mediaFromPage(pageUrl, html) {
  const watchTag = /<div\b[^>]*\bid="watch-main"[^>]*>/i.exec(html)?.[0] ?? "";
  const canonical = attr(watchTag, /\bdata-url="([^"]*)"/i) ?? pageUrl;
  const slug = mediaSlugOf(canonical) ?? mediaSlugOf(pageUrl) ?? "";
  const titleElement = html.match(/<h1\b[^>]*class="[^"]*\btitle\b[^"]*"[^>]*>[\s\S]*?<\/h1>/i)?.[0];
  const title =
    clean(titleElement?.match(/>([\s\S]*?)<\/h1>/i)?.[1] ?? "") ??
    clean(attr(html, /<title>([\s\S]*?)<\/title>/i))?.replace(/^\s*AniWave\s*-\s*/i, "").replace(/\s*Watch Anime Online\s*$/i, "") ??
    `AnimeWave ${slug}`;
  const originalTitle = titleElement ? attr(titleElement, /\bdata-jp="([^"]*)"/i) : undefined;
  // `.names.font-italic` is the site's own alt-title list, `;`-separated and
  // mixed-script (measured on Solo Leveling Season 2: romaji, two synonyms and
  // `俺だけレベルアップな件 Season 2 -Arise from the Shadow-`).  Kept because a
  // search that cannot see them misses titles users type.
  const altTitleText = clean(html.match(/<div\b[^>]*class="[^"]*\bnames\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1]);
  // The synopsis opens with a `.shorting` promotional paragraph ("… Animesalt is
  // a lifesaver"); only `.content` inside it is the series text.
  const description = clean(html.match(/<div\b[^>]*class="[^"]*\bsynopsis\b[^"]*"[^>]*>[\s\S]*?<div\b[^>]*class="[^"]*\bcontent\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1]);
  const bmeta = html.indexOf('class="bmeta"');
  const detailBlocks = bmeta === -1 ? "" : html.slice(bmeta, bmeta + 4000);
  const label = (name) => detailBlocks.match(new RegExp(`<div>\\s*${name}:\\s*(<span[\\s\\S]{0,400}?</span>)\\s*</div>`, "i"))?.[1] ?? "";
  const field = (name) => clean(label(name)) ?? "";
  const typeTag = field("Type").toUpperCase();
  const kind =
    typeTag === "MOVIE" ? "movie" : typeTag === "OVA" || typeTag === "ONA" ? "ova"
      : typeTag === "SPECIAL" ? "special" : "anime";
  const year = Number(/\b((?:19|20)\d{2})\b/.exec(field("Aired"))?.[1] ?? "") ||
    // `Premiered:` carries the year inside its filter link, not as text.
    Number(/year\[\]=(\d{4})/.exec(label("Premiered"))?.[1] ?? "") || undefined;
  const episodeCount = Number(/\d+/.exec(field("Episodes"))?.[0]) || undefined;
  const icons = html.match(/<div\b[^>]*class="[^"]*meta icons[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "";
  const audioIcons = ["sub", "dub", "hsub"].filter((name) => new RegExp(`<i\\b[^>]*class="[^"]*\\b${name}\\b`, "i").test(icons));
  const iconValue = (name) => clean(attr(icons, new RegExp(`<i\\b[^>]*class="${name}"[^>]*>([\\s\\S]*?)<\\/i>`, "i")));
  const status = field("Status");
  return {
    id: `animewave:${slug}`,
    slug,
    kind,
    title,
    ...(originalTitle && originalTitle !== title ? { originalTitle } : {}),
    ...(altTitleText ? { altTitles: altTitleText.split(";").map((s) => s.trim()).filter(Boolean) } : {}),
    coverUrl: fixUrl(ANIMEWAVE_MAIN, attr(html, /<meta property="og:image" content="([^"]*)"/i)),
    ...(description ? { description } : {}),
    genres: [...new Set([...html.matchAll(/<a[^>]+href="[^"]*\/genre\/[^"]*"[^>]*>([^<]+)<\/a>/gi)]
      .map((m) => clean(m[1] ?? "")).filter((v) => v !== undefined))],
    ...(year ? { year } : {}),
    ...(episodeCount ? { episodeCount } : {}),
    ...(status ? { status } : {}),
    // Series-level audio MARKUP: `<i class="sub …>` / `<i class="dub …>`.  A
    // claim, not a fact — it says the site offers the group, not that the group
    // carries different bytes.  `dubPairVerdict` measures the bytes.
    ...(audioIcons.length ? { audioIcons } : {}),
    ...(iconValue("rating") ? { rating: iconValue("rating") } : {}),
    ...(iconValue("quality") ? { quality: iconValue("quality") } : {}),
    watchUrl: canonical,
  };
}

/**
 * Episode ids carry the opaque server token, the audio the site opens by
 * default, and the episode page URL the site's own player sends as referer.
 * Same codec as the AniVerse `animewave` provider, so a ref from the app works
 * here and vice versa: `animewave|<serverIds>|<audioType>|<episodeUrl>`.
 */
export function encodeEpisodeRef(input) {
  return [
    "animewave",
    input.serverIds,
    input.audioType,
    ...(input.episodeUrl ? [input.episodeUrl] : []),
  ].join("|");
}

export function decodeEpisodeRef(id) {
  if (!id.startsWith("animewave|")) return null;
  const parts = id.split("|");
  if (parts.length < 3) return null;
  const episodeUrl = parts[3]?.trim();
  return { serverIds: parts[1] ?? "", audioType: (parts[2] ?? "sub").trim() || "sub", ...(episodeUrl ? { episodeUrl } : {}) };
}

/**
 * `/ajax/episode/list/<id>?vrf= -> Episode[]`.  Measured shape:
 * `<a href="#" data-num="1" data-slug="1" data-mal="58567" data-timestamp="…"
 *  data-sub="1" data-dub="1" data-ids="<203-char token>"><b>1</b>
 *  <span class="d-title" data-jp="Episode 1">You Aren't E-rank, Are You</span><i></i></a>`
 *
 * Two things here differ from the shape the code was written for.  The `href` is
 * a placeholder, so the episode URL is rebuilt from the series slug plus
 * `data-slug` — which is what the site's own player navigates to.  And the
 * `data-jp` is the EPISODE NUMBER while the anchor text is the real title, the
 * opposite of the search card, so the text wins.
 */
function parseEpisodeAnchors(main, html, mediaId, seriesSlug) {
  const episodes = [];
  for (const m of html.matchAll(/<a\b[^>]*\bdata-ids="[^"]*"[^>]*>[\s\S]*?<\/a>/gi)) {
    const tag = m[0];
    const serverIds = attr(tag, /\bdata-ids="([^"]*)"/i)?.trim() ?? "";
    if (!serverIds) continue;
    const numRaw = attr(tag, /\bdata-num="([^"]*)"/i)?.trim() ?? "";
    const number = /^\d+$/.test(numRaw) ? Number(numRaw) : episodes.length + 1;
    const episodeSlug = attr(tag, /\bdata-slug="([^"]*)"/i)?.trim() || String(number);
    const isSub = attr(tag, /\bdata-sub="([^"]*)"/i) === "1";
    const isDub = attr(tag, /\bdata-dub="([^"]*)"/i) === "1";
    const audioType = isDub && isSub ? "both" : isDub ? "dub" : "sub";
    const title =
      clean(tag.match(/<[^>]+class="[^"]*d-title[^"]*"[^>]*>([\s\S]*?)<\/[^>]*>/i)?.[1] ?? "") ||
      attr(tag, /\bdata-jp="([^"]*)"/i)?.trim() ||
      `Episode ${number}`;
    const episodeUrl = `${main}/watch/${seriesSlug}/ep-${episodeSlug}`;
    episodes.push({
      // A "both" row encodes `sub`, the site's own default toggle; the dub ask
      // is a parameter, not a second row.
      id: encodeEpisodeRef({ serverIds, audioType: isDub && !isSub ? "dub" : "sub", episodeUrl }),
      mediaId, seasonNumber: 1, number, title, url: episodeUrl, audioType,
    });
  }
  return episodes.sort((a, b) => a.number - b.number);
}

async function episodesFor(watchId, mediaId, watchUrl, signal) {
  const body = await getAjax(`${ANIMEWAVE_MAIN}/ajax/episode/list/${watchId}?vrf=`, watchUrl, signal);
  const html = jsonHtml(body);
  if (!html) return { episodes: [], malId: undefined };
  const seriesSlug = watchUrl.match(/\/watch\/([^"/?#]+)/i)?.[1] ?? "";
  const episodes = parseEpisodeAnchors(ANIMEWAVE_MAIN, html, mediaId, seriesSlug);
  const malId = episodes.length ? attr(html, /\bdata-mal="(\d+)"/i) : undefined;
  return { episodes, ...(malId ? { malId } : {}) };
}

export async function details(idOrSlugOrUrl, { signal } = {}) {
  const url = watchUrlFor(idOrSlugOrUrl);
  const { body: html } = await getText(url, { referer: `${ANIMEWAVE_MAIN}/`, signal });
  const watchId = attr(/<div\b[^>]*\bid="watch-main"[^>]*>/i.exec(html)?.[0] ?? "", /\bdata-id="([^"]*)"/i) ?? "";
  if (!watchId) throw new ApiError("AnimeWave watch page exposed no data-id", 0);
  const media = mediaFromPage(url, html);
  const { episodes, malId } = await episodesFor(watchId, media.id, media.watchUrl ?? url, signal);
  // The listing rows carry `data-mal`, so the series' MyAnimeList id comes out of
  // the episode payload rather than the page — measured 58567 on Solo Leveling S2,
  // whose h1 exposes no MAL link anywhere.
  return { media: { ...media, ...(malId ? { malId } : {}) }, episodes };
}

export async function episodes(idOrSlugOrUrl, { signal } = {}) {
  return (await details(idOrSlugOrUrl, { signal })).episodes;
}

/**
 * `/ajax/server/list` -> `[{ linkId, type, name }]`, each `li` scoped to the
 * nearest preceding `div.type[data-type=…]`.  Measured group set: `["sub","dub"]`;
 * names are the site's labels (`HD-1`, `Vidstream-2`).
 */
export function parseServerLinks(html) {
  const out = [];
  const scopeRe = /data-type="([^"]*)"/gi;
  for (const m of html.matchAll(/<li\b[^>]*data-link-id="([^"]*)"[^>]*>([\s\S]*?)<\/li>/gi)) {
    const linkId = m[1]?.trim() ?? "";
    if (!linkId) continue;
    let type = "";
    for (const scope of html.slice(0, m.index).matchAll(scopeRe)) type = (scope[1] ?? "").trim().toLowerCase();
    out.push({ linkId, type, name: clean(m[2] ?? "") ?? "" });
  }
  return out;
}

/**
 * episode id (opaque ref) -> embed URLs + skip marks, scoped to the audio asked
 * for.  The token is passed url-encoded and byte-for-byte; a tampered one is
 * refused locally rather than sent, because the site's answer to a broken token
 * is an empty group, which would read as "this episode has no servers".
 */
export async function sources(episodeId, { audioType, signal } = {}) {
  const ref = decodeEpisodeRef(episodeId);
  if (!ref?.serverIds) throw new ApiError("AnimeWave episode id carries no server set", 0);
  if (!/^[A-Za-z0-9+/=_-]{1,1024}$/.test(ref.serverIds)) throw new ApiError("AnimeWave server set is not a valid opaque token", 0);
  const referer = ref.episodeUrl ?? `${ANIMEWAVE_MAIN}/`;
  const serverHtml = jsonHtml(await getAjax(
    `${ANIMEWAVE_MAIN}/ajax/server/list?servers=${encodeURIComponent(ref.serverIds)}`, referer, signal));
  if (!serverHtml) return { embeds: [], subtitles: [], audioType: audioType ?? ref.audioType, available: { sub: 0, dub: 0 } };

  const entries = parseServerLinks(serverHtml);
  // The caller's ask wins; the ref's label (encoded from the listing row) is the
  // default for callers who did not ask.  Hardsubs ("hsub") count as sub.
  const requested = audioType === "dub" || audioType === "sub" ? audioType : ref.audioType;
  const wanted = requested === "dub" ? ["dub"] : ["sub", "hsub"];
  const typed = entries.filter((e) => e.type !== "");
  const scoped = typed.filter((e) => wanted.includes(e.type));
  // The fallback is for layout variance only — a page whose items carry no
  // `data-type` at all.  When the page IS typed and the asked group is simply
  // absent, the answer is zero embeds.  Measured on AnimeWave itself, 2026-10-13:
  // One Piece lists 1,180 rows in one payload, 1,155 of them `both` and 25 of them
  // sub-only (`data-sub="1"` with no `data-dub`, e.g. ep 1156, whose server set
  // publishes exactly one group, `["sub"]`, and three link-ids).  Falling through
  // to the unscoped entries served that row's `…/stream/s-2/169810/sub?s=tcdn` to
  // a dub ask — Japanese audio advertised as English.
  const usable = typed.length === 0 ? entries : scoped;
  const count = (type) => new Set(entries.filter((e) => e.type === type).map((e) => e.linkId)).size;
  const embeds = [];
  const seenLink = new Set();
  const published = new Set();
  let skip;
  for (const entry of usable) {
    if (!entry.linkId || seenLink.has(entry.linkId)) continue;
    seenLink.add(entry.linkId);
    try {
      const linkBody = await getAjax(`${ANIMEWAVE_MAIN}/ajax/server?get=${encodeURIComponent(entry.linkId)}`, referer, signal);
      const embedUrl = jsonResultUrl(linkBody);
      if (!embedUrl?.trim()) continue;
      const resolved = fixUrl(ANIMEWAVE_MAIN, embedUrl);
      if (published.has(resolved)) continue;
      published.add(resolved);
      embeds.push(resolved);
      skip ??= jsonResultSkip(linkBody);
    } catch (e) {
      if (e?.name === "AbortError") break;
    }
  }
  return {
    embeds, subtitles: [], audioType: requested, servers: usable,
    // What the page published per group, so a zero-embed answer can be told
    // apart from a page that changed shape.
    available: { sub: count("sub") + count("hsub"), dub: count("dub") },
    ...(skip ? { skip } : {}),
  };
}

// ------------------------------------------------------------ Megaplay embed
// Verbatim across the AniKoto-family exports (see README: duplication is
// deliberate — one provider's CDN change must not silently break another's
// proof).  AnimeWave hands out the same two MegaPlay shapes as AniKoto.

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

/**
 * The embed's `?s=<selector>` picks the CDN the token is minted against.
 * Measured on AnimeWave ep 1 of Solo Leveling S2: `HD-1` is `…/sub?s=tcdn` and
 * `Vidstream-2` is the plain `…/sub` — and the two land on different hosts with
 * different honesty (see `sniffContainer`).
 */
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
 * Which audio the embed serves, read off its own path.  AnimeWave hands out
 * `…/stream/s-2/<id>/{sub,dub}[?s=…]`, which names the audio, so this is a real
 * answer here — but still only the site's claim: the `?s=tcdn` pair above came
 * back `sub`/`dub` correctly labelled and `dubPairVerdict` on the plain pair says
 * the bytes differ, which is the only fact in the chain that matters.
 */
export function audioOfEmbed(embedUrl) {
  const last = decodeURIComponent(embedUrl.split("?")[0].replace(/\/+$/, "").slice(embedUrl.lastIndexOf("/") + 1));
  if (/^h?dub$/i.test(last)) return "dub";
  if (/^h?sub$/i.test(last)) return "sub";
  return undefined;
}

/** embed URL -> playable HLS (signed master + best-first variants) + subtitles + claimed audio. */
export async function resolve(embedUrl, { referer, signal } = {}) {
  let page = await getText(embedUrl, { ...(referer ? { referer } : {}), signal });
  if (!extractPlayerDataId(page.body)) {
    const inner = familyIframeUrl(page.body, MEGAPLAY_HOSTS);
    if (inner) page = await getText(inner, { referer: page.url, signal });
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

  // Expand the master into per-variant sources (device parity).  The token is
  // directory-scoped, so every variant carries the SAME token; anything that
  // would leave the signed directory is dropped rather than shipped untokenized.
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

  const audio = audioOfEmbed(embedUrl) ?? audioOfEmbed(page.url);
  return {
    provider: "animewave", extractor: "megaplay",
    master: { url: streamUrl, headers },
    variants,
    subtitles: parseTracks(payload, headers.referer),
    ...(audio ? { audio } : {}),
    ...(token ? { note: "token is directory-scoped and expires by unix-seconds freshness; re-resolve, never cache" } : {}),
  };
}

// ------------------------------------------------- HLS -> MPEG-TS download

/**
 * #EXT-X-STREAM-INF variants (I-FRAME preview tracks are not matched -> skipped).
 */
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
 * Container sniff on the first downloaded segment.
 *
 * Measured 2026-10-13 on AnimeWave's own hand-outs, reproducing the AniKoto
 * result exactly: the FIRST listed embed (`HD-1` = `…/sub?s=tcdn`) resolves to
 * `megap.shiora.top`, whose "segments" are PNGs, while the plain `…/sub`
 * (`Vidstream-2`) resolves to `fetch.nexabloom.top` and writes real MPEG-TS.
 * The CDN even declares `content-type: image/jpeg` on the nexabloom segments
 * that carry the actual video (measured: 262,144 bytes starting `47` with a
 * declared `image/jpeg`), so the declared type is not evidence either way and
 * the first byte is.  The container must be sniffed before a download is
 * believed, and the caller must be able to fall through to the next embed.
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
 * playlist the way a player does (best rendition, then its segments, init first
 * for fMP4, honouring #EXT-X-BYTERANGE), refuse a keyed stream rather than write
 * ciphertext that passes every size check, and sniff the first segment so a decoy
 * CDN's PNGs are reported instead of "completed".
 */
export async function download(signedPlaylistUrl, {
  headers, referer, outPath, signal, onProgress, maxSegments,
} = {}) {
  const reqHeaders = { ...(referer ? { referer } : {}), ...(headers ?? {}) };
  const first = await request(signedPlaylistUrl, { headers: reqHeaders, signal });
  if (!first.ok) { await drain(first); throw new ApiError(`playlist ${first.status}`, first.status); }
  let baseUrl = first.url || signedPlaylistUrl;
  let text = await first.text();

  // Master? resolve to the best rendition (carry the directory token — variant
  // URLs inside the signed directory share it).
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
      // Segment 1 is buffered whole so its container is proven before the rest of
      // the episode transfers.  A decoy CDN's PNGs are otherwise indistinguishable
      // from a real download until playback fails.
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
    // Node reports a bad path (missing dir) on `open`, one tick late.  Awaiting it
    // is what turns ENOENT into an honest error instead of counted bytes with no
    // file written.
    await once(ws, "open");
    if (plan.init) await writeBody(await request(plan.init, { headers: reqHeaders, signal }));
    for (const seg of plan.segments) {
      if (signal?.aborted) throw new ApiError("download aborted", 0, "ABORTED");
      const h = seg.range === null ? reqHeaders : { ...reqHeaders, range: rangeHeader(seg.range) };
      await writeBody(await request(seg.url, { headers: h, signal }), { sniff: done === 0 });
      done++;
      onProgress?.({ bytes, percent: Math.round((done / total) * 100), segment: done, of: total });
      // A preview stops cleanly, not via abort: a truncated MPEG-TS keeps its
      // 0x47 sync structure, so the head of the file still plays.
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

/** search -> details -> sources -> resolve each embed -> download the first real one. */
export async function downloadEpisode(query, episodeNumber, outPath, { signal, onProgress, audioType = "sub", maxSegments } = {}) {
  const results = await search(query, { signal });
  const hit = results[0];
  if (!hit) throw new ApiError(`search for "${query}" returned nothing on AnimeWave`, 0);
  const { media, episodes } = await details(hit.id, { signal });
  const ep = episodes.find((e) => e.number === Number(episodeNumber)) ?? episodes[Number(episodeNumber) - 1];
  if (!ep) throw new ApiError(`episode ${episodeNumber} not listed for ${media.title}`, 0);
  const { embeds, available } = await sources(ep.id, { ...(audioType ? { audioType } : {}), signal });
  if (!embeds.length) {
    throw new ApiError(`no ${audioType ?? "sub"} embed for ${media.title} ep ${episodeNumber}; the page published sub=${available?.sub ?? 0} dub=${available?.dub ?? 0}`, 0);
  }
  // Try each embed until one downloads a real media container.  On this site the
  // FIRST embed is the decoy (see sniffContainer), so "playable" is proven by the
  // written bytes, not by the embed URL resolving.
  let lastError = null;
  for (const embed of embeds) {
    try {
      const resolved = await resolve(embed, { referer: `${ANIMEWAVE_MAIN}/`, signal });
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

export const PROVIDER = { id: "animewave", name: "AnimeWave", baseUrl: ANIMEWAVE_MAIN, language: "en" };
export const defaultAnimeWaveReferer = `${ANIMEWAVE_MAIN}/`;

/**
 * Is THIS site's `/dub` file its own bytes or a copy of its `/sub`?  Measures the
 * first media segment of both (see `dubAudio.mjs` for the census behind the rule);
 * `audio`/`audioType` above is only the site's claim.
 *
 * AnimeWave is where the rule has the least to do: measured 2026-10-13 on Solo
 * Leveling S2 ep 1, the plain pair came back `distinct` — two 262,144-byte heads,
 * md5 `d5479315fdaafcd73ba13737f44763ee` vs `6ec719bdde2801db926cf7d0c29df08f`.
 * The `?s=tcdn` pair is the one that cannot be read at all, because that CDN
 * answers with PNGs, which is why an unmeasurable pair is `unknown` and not
 * quietly treated as either verdict.
 */
export const dubPairVerdict = makeDubPairVerdict(resolve, defaultAnimeWaveReferer);
