// @ts-check
/**
 * WatchAnimeWorld API — one provider, end to end.
 *
 * A standalone, dependency-free port of the WatchAnimeWorld
 * (watchanimeworld.one) chain, recovered by live HTTP measurement on
 * 2026-10-11 (Naruto Shippuden 5x208) and re-proven against the running site
 * on 2026-10-13 — every endpoint, header and parsing rule below was read off a
 * real response, not guessed.  Plain Node 18+: global `fetch` and `node:crypto`
 * only, nothing imported from AniVerse.
 *
 * This chain has NO embed layer and NO HLS.  It is the odd one out among the
 * exported providers, and that is the reason it is worth having here: the site
 * hands the player an MP4 manifest, and the bytes arrive as fixed 2 MiB parts
 * whose URL is itself an AES-256-CTR token.  Everything a browser would need a
 * proxy for (stitching, ranges) is done here by `download`/`fetchPart`.
 *
 *   search(term)                  -> [{ id, slug, title, coverUrl }]
 *   details(idOrSlugOrUrl)        -> { media, episodes:[{ id, number, title, audioType:"dub" }] }
 *   sources(episodeRef,{audioType})-> { embeds:[], direct:[{ url, partUrl, spec, quality, ... }] }
 *   probeCopy(spec)               -> true only when the copy can actually serve
 *   abyssPartUrl(spec, part)      -> the signed URL for one 2 MiB part
 *   download(spec, outPath)       -> stitches parts into one real .mp4
 *   audioPairVerdict(ref,{left,right}) -> are two LANGUAGE labels two files?
 *   downloadEpisode(term, ep, out)-> one-call search->sources->download convenience
 *
 * Route map, measured 2026-10-11 and re-walked 2026-10-13:
 *
 *   GET /?s=<q>                       -> li#post-<id> cards (a[href*=/series/],
 *                                        h2.entry-title, protocol-relative
 *                                        image.tmdb.org poster)
 *   GET /series/<slug>/               -> h1.entry-title + the season picker
 *                                        (div.aa-drp.choose-season a[data-post][data-season]);
 *                                        ul#episode_by_temp carries ONLY the active season
 *   GET /wp-admin/admin-ajax.php?action=action_select_season&season=N&post=<id>
 *        with x-requested-with        -> article.episodes, span.num-epi "5x184"
 *                                        = <season>x<absolute number>
 *   GET /episode/<slug>-<S>x<N>/      -> div#options-0 iframe /dub-player/t/<id>/
 *                                        (div#options-1's zephyrix iframe: HTTP 523
 *                                        measured 2026-10-11, not attempted)
 *   GET /dub-player/t/<id>/           -> inline `var CONFIG = {prefix, ready:{lang:slug}, lang:{...}}`
 *   GET <prefix>/<slug>               -> `const datas = "<b64>"` -> AES-256-CTR manifest
 *   GET https://<sub>.sssrr.org/sora/<size>/<token>
 *                                     -> one 2 MiB part of the MP4
 *
 * Three quirks carry the whole chain, and each one silently produces garbage
 * rather than an error if it is missed:
 *
 *   1. `datas` must be base64-decoded as **latin1**.  The JSON inside carries the
 *      ciphertext's raw bytes; a UTF-8 decode turns every byte >= 0x80 into
 *      U+FFFD, which parses clean and decrypts to noise.
 *   2. The part-token key is md5 over the size's **decimal digit bytes**
 *      (md5 of [6,4,1,5,9,7,4,4]), not md5 of the string "64159744".
 *   3. The sora hosts 403 a bare request.  `Referer: https://player.abyssplayer.com/`
 *      clears it; nothing else about the request matters.
 *
 * Copies are uploaded incomplete on this pipeline, so a rendition is emitted
 * only after `probeCopy` reads 65 bytes that say it can serve: a plaintext
 * `ftyp` head AND a last byte that exists.  Declared size alone lies.
 */

import { createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { headContainer, headFingerprint, sharedRung } from "./dubAudio.mjs";

const WAW_MAIN = "https://watchanimeworld.one";

/**
 * The origin the AniVerse app stitches under.  A reserved TLD that can never
 * resolve, so an unregistered host fails obviously here instead of reaching a
 * third party.  `direct[].url` carries it so a ref minted by this export drops
 * into the app's player unchanged; `direct[].partUrl` is the byte-exact URL an
 * operator can curl from here.
 */
export const ABYSS_VIRTUAL_ORIGIN = "waw-abyss.invalid";

/**
 * The uploader's fixed part size.  Measured 2026-10-11 across every copy of a
 * fresh episode: 2 MiB part URLs answer exactly 2 MiB even on copies whose
 * `.fd` object was stored with 4 MiB parts, so the token's chunk field is
 * decoupled from storage and 2 MiB addressing is universal.
 */
export const ABYSS_PART_SIZE = 0x200000;

/** The sora hosts 403 a bare request; the player's own Referer clears it. */
export const ABYSS_REFERER = "https://player.abyssplayer.com/";

export const defaultWatchAnimeWorldReferer = `${WAW_MAIN}/`;

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const DEFAULT_PART_TIMEOUT_MS = 20_000;
const PROBE_TIMEOUT_MS = 8_000;
const SEASON_CONCURRENCY = 3;

// --------------------------------------------------------------------- HTTP

class ApiError extends Error {
  constructor(message, status = 0, code = "ERROR") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function request(url, { headers, referer, signal, timeoutMs } = {}) {
  const merged = {
    "user-agent": DEFAULT_UA,
    ...(referer ? { referer } : {}),
    ...(headers ?? {}),
  };
  const signals = [];
  if (timeoutMs !== undefined) signals.push(AbortSignal.timeout(timeoutMs));
  if (signal !== undefined) signals.push(signal);
  const init = { headers: merged, redirect: "follow" };
  if (signals.length === 1) return fetch(url, { ...init, signal: signals[0] });
  if (signals.length > 1) return fetch(url, { ...init, signal: AbortSignal.any(signals) });
  return fetch(url, init);
}

async function getText(url, opts = {}) {
  const res = await request(url, opts);
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new ApiError(`fetch ${url} -> ${res.status}`, res.status);
  }
  return await res.text();
}

async function getBytes(url, opts = {}) {
  const res = await request(url, opts);
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new ApiError(`fetch ${url} -> ${res.status}`, res.status);
  }
  return Buffer.from(await res.arrayBuffer());
}

/** A ranged GET, as `{status, body}` — the copy probe reads the status, not just bytes. */
async function getRange(url, range, opts = {}) {
  const res = await request(url, { ...opts, headers: { ...opts.headers, range } });
  const body = Buffer.from(await res.arrayBuffer());
  return { status: res.status, body };
}

// ------------------------------------------------------------ HTML plumbing

function fixUrl(base, href) {
  if (!href) return base;
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

/** Absolute-ise, but only when the site gave us something to absolute-ise. */
function absolute(base, href) {
  if (!href) return undefined;
  return fixUrl(base, href);
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
 * Curly quotes / dashes -> ASCII, zero-width removed.  WatchAnimeWorld's search
 * is WordPress `/?s=`, and a curly-quoted query that reaches the site un-rewritten
 * answers a page whose card markup differs from the plain-term page, so the
 * rewrite is what keeps `parseSearchCards` single-shaped.
 */
export function normalizeUnicodeToAscii(text) {
  return text
    .replace(/[‘’‚‛˂′']/g, "'")
    .replace(/[“”‟‟″"]/g, '"')
    .replace(/[–—―—–]/g, "-")
    .replace(/[​-‍﻿]/g, "")
    .trim();
}

// Ranking only — orders hits, never decides whether a title matched.
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

// -------------------------------------------------------------- page parsers

/**
 * Search cards are `<li id="post-<id>">` blocks whose one `lnk-blk` anchor points
 * at `/series/<slug>/`.  The `#post-<id>` anchor is what separates a result card
 * from the sidebar's other `li`s, so matching on it is load-bearing, not style.
 */
export function parseSearchCards(main, html) {
  const out = [];
  const cardRe = /<li\b[^>]*\bid="post-\d+"[^>]*>([\s\S]*?)<\/li>/gi;
  for (const match of html.matchAll(cardRe)) {
    const block = match[1] ?? "";
    const href = attr(block, /<a\b[^>]*\bhref="([^"]*\/series\/[^"]*)"[^>]*>/i);
    const slug = href?.match(/\/series\/([^"/?#]+)/i)?.[1];
    const title = clean(block.match(/<h2\b[^>]*class="[^"]*entry-title[^"]*"[^>]*>([\s\S]*?)<\/h2>/i)?.[1]);
    if (!slug || title === undefined || title === "") continue;
    const imgRaw = attr(block, /<img\b[^>]*\bsrc="([^"]*)"/i) ?? attr(block, /<img\b[^>]*\bdata-src="([^"]*)"/i);
    const coverUrl = imgRaw === undefined ? undefined
      : imgRaw.startsWith("//") ? `https:${imgRaw}` : absolute(main, imgRaw);
    out.push({ slug, title, ...(coverUrl === undefined ? {} : { coverUrl }) });
  }
  return out;
}

export function mediaFromPage(main, slug, html) {
  const title =
    clean(html.match(/<h1\b[^>]*class="[^"]*entry-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i)?.[1]) ??
    clean((attr(html, /<title>([\s\S]*?)<\/title>/i) ?? "").replace(/\s*[-–|].*$/, ""));
  const imgRaw =
    attr(html, /<img\b[^>]*\bsrc="([^"]*image\.tmdb\.org[^"]*)"/i) ??
    attr(html, /<img\b[^>]*\bdata-src="([^"]*image\.tmdb\.org[^"]*)"/i);
  const coverUrl = imgRaw === undefined ? undefined
    : imgRaw.startsWith("//") ? `https:${imgRaw}` : absolute(main, imgRaw);
  return {
    id: `watchanimeworld:${slug}`,
    kind: "anime",
    title: title !== undefined && title !== "" ? title : `watchanimeworld ${slug}`,
    provider: "watchanimeworld",
    ...(coverUrl === undefined ? {} : { coverUrl }),
  };
}

export function parseSeasonAnchors(html) {
  const out = [];
  const seen = new Set();
  const anchorRe = /<a\b[^>]*\bdata-post="(\d+)"[^>]*\bdata-season="(\d+)"[^>]*>/gi;
  for (const match of html.matchAll(anchorRe)) {
    const season = Number(match[2]);
    if (!Number.isSafeInteger(season) || seen.has(season)) continue;
    seen.add(season);
    out.push({ postId: match[1] ?? "", season });
  }
  out.sort((a, b) => a.season - b.season);
  return out;
}

/**
 * Episode items as they appear both in the series page (active season) and the
 * season AJAX (any season): `span.num-epi` is `<season>x<absolute number>`, and
 * the absolute number is the episode's identity across the whole series — the
 * site numbers Shippuden 5x184, not 5x24.  Every row this site publishes is a
 * dub: the episode page's only working iframe is `/dub-player/t/`.
 */
export function parseEpisodeItems(main, html, seriesSlug) {
  const out = [];
  const itemRe = /<article\b[^>]*class="[^"]*\bepisodes\b[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
  for (const match of html.matchAll(itemRe)) {
    const block = match[1] ?? "";
    const numRaw = clean(block.match(/<span\b[^>]*class="[^"]*\bnum-epi\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i)?.[1]);
    const numMatch = /^(\d+)\s*x\s*(\d+)$/.exec(numRaw ?? "");
    const href = attr(block, /<a\b[^>]*\bhref="([^"]*\/episode\/[^"]*)"[^>]*>/i);
    if (!numMatch || href === undefined) continue;
    const season = Number(numMatch[1]);
    const number = Number(numMatch[2]);
    const episodeUrl = absolute(main, href) ?? href;
    const title = clean(block.match(/<h2\b[^>]*class="[^"]*entry-title[^"]*"[^>]*>([\s\S]*?)<\/h2>/i)?.[1]);
    out.push({
      id: encodeEpisodeRef({ seriesSlug, season, number, episodeUrl }),
      mediaId: `watchanimeworld:${seriesSlug}`,
      seasonNumber: season,
      number,
      ...(title === undefined || title === "" ? {} : { title }),
      url: episodeUrl,
      audioType: "dub",
    });
  }
  return out;
}

function dedupeByNumber(episodes) {
  const byNumber = new Map();
  for (const episode of episodes) {
    if (!byNumber.has(episode.number)) byNumber.set(episode.number, episode);
  }
  return [...byNumber.values()].sort((a, b) => a.number - b.number);
}

/** Episode ids carry the series slug, season and absolute number plus the page `sources` re-fetches. */
export function encodeEpisodeRef(input) {
  return ["watchanimeworld", input.seriesSlug, String(input.season), String(input.number), input.episodeUrl].join("|");
}

export function decodeEpisodeRef(id) {
  if (!String(id).startsWith("watchanimeworld|")) return null;
  const parts = String(id).split("|");
  if (parts.length < 5) return null;
  const episodeUrl = parts.slice(4).join("|");
  if (!/^https?:\/\//i.test(episodeUrl)) return null;
  return {
    seriesSlug: parts[1] ?? "",
    season: Number(parts[2] ?? "0"),
    number: Number(parts[3] ?? "0"),
    episodeUrl,
  };
}

/** The dub-player iframe is the only one that yields bytes; zephyrix measured dead. */
export function parseDubPlayerUrl(main, html) {
  for (const match of html.matchAll(/<iframe\b[^>]*>/gi)) {
    const tag = match[0];
    const src = attr(tag, /\bsrc="([^"]*)"/i) ?? attr(tag, /\bdata-src="([^"]*)"/i);
    if (src === undefined || !src.includes("/dub-player/t/")) continue;
    const url = absolute(main, src);
    if (url !== undefined) return url;
  }
  return null;
}

export function parseDubPlayerConfig(html) {
  const marker = html.search(/var\s+CONFIG\s*=/);
  if (marker === -1) return null;
  const braceStart = html.indexOf("{", marker);
  if (braceStart === -1) return null;
  const raw = extractBalancedObject(html, braceStart);
  if (raw === null) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const candidate = /** @type {any} */ (parsed);
  if (typeof candidate.prefix !== "string" || !/^https?:\/\//i.test(candidate.prefix)) return null;
  if (candidate.ready === null || typeof candidate.ready !== "object") return null;
  if (candidate.lang === null || typeof candidate.lang !== "object") return null;
  const ready = {};
  for (const [key, value] of Object.entries(candidate.ready)) {
    if (typeof value === "string" && value.trim() !== "") ready[key] = value.trim();
  }
  return { prefix: candidate.prefix, ready, lang: candidate.lang };
}

/**
 * `var CONFIG` is JS, not JSON, so the object is found by brace balance from the
 * first `{` — with string state and backslash escapes tracked, because a title
 * inside `lang` can carry both a `}` and a `\"`.
 */
function extractBalancedObject(html, braceStart) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = braceStart; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return html.slice(braceStart, i + 1);
    }
  }
  return null;
}

// ----------------------------------------------------------- abyss manifest

/**
 * `const datas = "<b64>"` decodes to a JSON object whose `media` field is raw
 * ciphertext.  Base64 -> **latin1**, for the reason in the header: the JSON
 * carries ciphertext bytes, and a UTF-8 decode corrupts every one >= 0x80 into
 * U+FFFD without failing to parse.
 */
export function parseAbyssDatas(html) {
  const match = /const\s+datas\s*=\s*"([A-Za-z0-9+/=]+)"/.exec(html);
  if (match?.[1] === undefined) {
    throw new ApiError("abyss page carries no datas blob", 0, "NO_DATAS");
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(match[1], "base64").toString("latin1"));
  } catch (error) {
    throw new ApiError(`datas blob is not JSON: ${String(error?.message ?? error).slice(0, 60)}`, 0, "BAD_DATAS");
  }
  const candidate = /** @type {any} */ (parsed);
  if (
    candidate === null || typeof candidate !== "object" ||
    typeof candidate.slug !== "string" ||
    (typeof candidate.md5_id !== "string" && typeof candidate.md5_id !== "number") ||
    (typeof candidate.user_id !== "string" && typeof candidate.user_id !== "number") ||
    typeof candidate.media !== "string"
  ) {
    throw new ApiError("datas blob has the wrong shape", 0, "BAD_DATAS");
  }
  return {
    slug: candidate.slug,
    md5_id: String(candidate.md5_id),
    user_id: String(candidate.user_id),
    media: candidate.media,
  };
}

/**
 * AES-256-CTR, key = md5hex("<user_id>:<slug>:<md5_id>") used as its own ASCII
 * bytes, IV = the first 16 ASCII bytes of that hex.  Same construction as the
 * part tokens below, different pre-image.
 */
export function decryptAbyssManifest(outer) {
  const keyHex = createHash("md5").update(`${outer.user_id}:${outer.slug}:${outer.md5_id}`, "utf8").digest("hex");
  const decipher = createDecipheriv("aes-256-ctr", Buffer.from(keyHex, "ascii"), Buffer.from(keyHex.slice(0, 16), "ascii"));
  const plain = Buffer.concat([decipher.update(Buffer.from(outer.media, "latin1")), decipher.final()]).toString("utf8");
  let parsed;
  try {
    parsed = JSON.parse(plain);
  } catch (error) {
    throw new ApiError(`manifest is not JSON after decrypt: ${String(error?.message ?? error).slice(0, 60)}`, 0, "BAD_MANIFEST");
  }
  const mp4 = /** @type {any} */ (parsed)?.mp4;
  if (mp4 === undefined || !Array.isArray(mp4.sources)) {
    throw new ApiError("manifest carries no mp4 sources", 0, "BAD_MANIFEST");
  }
  return /** @type {{sources: any[], domains: string[], fristDatas: any[]}} */ (mp4);
}

const QUALITY_LEVELS = new Set([240, 360, 480, 720, 1080, 1440, 2160]);
const toSourceQuality = (value) => (QUALITY_LEVELS.has(value) ? value : "unknown");

/**
 * One entry per available quality tier, candidates ordered for probing: h264
 * before av1 (browser-safest first) and smaller files before larger (bandwidth),
 * because the first copy that passes `probeCopy` is the one emitted.
 */
export function selectRenditionCandidates(rows) {
  const byQuality = new Map();
  for (const row of rows) {
    if (row.status !== true) continue;
    if (row.codec !== "h264" && row.codec !== "av1") continue;
    if (typeof row.sub !== "string" || !/^[a-z0-9-]+$/i.test(row.sub)) continue;
    if (typeof row.size !== "number" || !Number.isSafeInteger(row.size) || row.size <= 0) continue;
    if (typeof row.res_id !== "number" || !Number.isSafeInteger(row.res_id)) continue;
    const quality = /^(\d{3,4})p$/i.exec(String(row.label))?.[1];
    if (quality === undefined) continue;
    const bucket = byQuality.get(Number(quality)) ?? [];
    bucket.push(row);
    byQuality.set(Number(quality), bucket);
  }
  for (const bucket of byQuality.values()) {
    bucket.sort((a, b) => (a.codec === "h264" ? 0 : 1) - (b.codec === "h264" ? 0 : 1) || a.size - b.size);
  }
  return byQuality;
}

const LANGUAGE_PRIORITY = ["hin", "eng", "jpn"];
const LANGUAGE_FALLBACK_LABELS = { hin: "Hindi", eng: "English", jpn: "Japanese" };

/**
 * The player config keeps one abyss slug per language.  Hindi leads on this site
 * (it is a Hindi-dub catalogue), then English and Japanese; if none of the three
 * is present the first offered language plays rather than nothing.  Two
 * languages sharing a slug — the same upload listed twice — collapse to the
 * higher-priority one.
 */
export function selectLanguageTargets(config) {
  const labelFor = (lang) => config.lang?.[lang]?.name ?? LANGUAGE_FALLBACK_LABELS[lang] ?? String(lang).toUpperCase();
  const out = [];
  const seen = new Set();
  for (const lang of LANGUAGE_PRIORITY) {
    const slug = config.ready[lang];
    if (slug === undefined || seen.has(slug)) continue;
    seen.add(slug);
    out.push({ lang, slug, label: labelFor(lang) });
  }
  if (out.length === 0) {
    const first = Object.entries(config.ready)[0];
    if (first !== undefined) out.push({ lang: first[0], slug: first[1], label: labelFor(first[0]) });
  }
  return out;
}

// --------------------------------------------------------------- abyss parts

/**
 * What the virtual URL encodes: the id triple that mints part tokens plus the
 * sora subdomain holding this copy.  Part count and part lengths derive from
 * `s`, so there is no second source of truth to drift.
 */
export function encodeAbyssSpec(spec) {
  return Buffer.from(JSON.stringify(spec), "utf8").toString("base64url");
}

export function decodeAbyssSpec(encoded) {
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(String(encoded), "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const c = /** @type {any} */ (parsed);
  if (typeof c.m !== "string" || !/^\d+$/.test(c.m)) return null;
  if (typeof c.r !== "number" || !Number.isSafeInteger(c.r) || c.r <= 0) return null;
  if (typeof c.s !== "number" || !Number.isSafeInteger(c.s) || c.s <= 0) return null;
  // The subdomain is interpolated into a URL, so a dot or slash here would be a
  // host-injection primitive riding inside a server-minted token.
  if (typeof c.h !== "string" || !/^[a-z0-9-]+$/i.test(c.h)) return null;
  return { m: c.m, r: c.r, s: c.s, h: c.h };
}

export function buildAbyssVirtualUrl(spec) {
  return `https://${ABYSS_VIRTUAL_ORIGIN}/${encodeAbyssSpec(spec)}.mp4`;
}

export function parseAbyssVirtualUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== ABYSS_VIRTUAL_ORIGIN) return null;
  const match = /^\/([A-Za-z0-9_-]+)\.mp4$/.exec(parsed.pathname);
  if (match?.[1] === undefined) return null;
  return decodeAbyssSpec(match[1]);
}

/**
 * The token key is md5 over the size's DECIMAL DIGITS as byte values (md5 of
 * bytes [6,4,1,5,9,7,4,4], not md5 of the string "64159744") — the player's
 * quirk, verified against live tokens.  The AES-256-CTR key and IV are both the
 * hex digest itself (32 and 16 ASCII bytes).
 */
export function abyssSizeKey(size) {
  return createHash("md5").update(Buffer.from(String(size).split("").map(Number))).digest("hex");
}

/**
 * Double base64, both layers without padding: ciphertext -> base64 -> ASCII
 * bytes of that string -> base64.  `latin1` on input because the plaintext is
 * ASCII path characters, and the doubled string must stay byte-faithful.
 */
export function abyssToken(plaintext, size) {
  const keyHex = abyssSizeKey(size);
  const cipher = createCipheriv("aes-256-ctr", Buffer.from(keyHex, "ascii"), Buffer.from(keyHex.slice(0, 16), "ascii"));
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext, "latin1")), cipher.final()]);
  const inner = ciphertext.toString("base64").replace(/=+$/, "");
  return Buffer.from(inner, "ascii").toString("base64").replace(/=+$/, "");
}

export function abyssChunkSize(size) {
  return Math.min(size, ABYSS_PART_SIZE);
}

export function abyssPartCount(size) {
  return Math.ceil(size / abyssChunkSize(size));
}

export function abyssPartLength(size, part) {
  const chunk = abyssChunkSize(size);
  return Math.min(chunk, size - part * chunk);
}

export function abyssPartUrl(spec, part) {
  const chunk = abyssChunkSize(spec.s);
  const token = abyssToken(`/mp4/${spec.m}/${spec.r}/${spec.s}/${chunk}/${part}`, spec.s);
  return `https://${spec.h}.sssrr.org/sora/${spec.s}/${token}`;
}

/**
 * Single-range parsing with HTTP semantics: an open-ended `bytes=N-` ends at EOF,
 * a suffix `bytes=-N` takes the last N bytes, anything malformed or out of bounds
 * is `"unsatisfiable"` (answer 416).  Multi-range requests are refused rather than
 * partially honoured: a stitched response cannot produce a multipart body.
 */
export function parseAbyssRange(header, size) {
  if (header === undefined || header.trim() === "") return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return "unsatisfiable";
  const startRaw = match[1] ?? "";
  const endRaw = match[2] ?? "";
  if (startRaw === "" && endRaw === "") return "unsatisfiable";
  if (startRaw === "") {
    const suffix = Number(endRaw);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(startRaw);
  if (!Number.isSafeInteger(start) || start >= size) return "unsatisfiable";
  if (endRaw === "") return { start, end: size - 1 };
  const end = Math.min(Number(endRaw), size - 1);
  if (!Number.isSafeInteger(end) || end < start) return "unsatisfiable";
  return { start, end };
}

/**
 * A copy is emitted only if it can actually serve: its first box must be a
 * plaintext `ftyp` (an encrypted head would play as static) and its last byte
 * must exist (uploads truncated at declared−N×64 KiB are common on this
 * pipeline, and the tail byte is where they run out).  65 upstream bytes decide.
 */
export async function probeCopy(spec, { signal } = {}) {
  try {
    const head = await getRange(abyssPartUrl(spec, 0), "bytes=4-7", {
      referer: ABYSS_REFERER,
      timeoutMs: PROBE_TIMEOUT_MS,
      ...(signal === undefined ? {} : { signal }),
    });
    if (head.status !== 206 || head.body.toString("latin1") !== "ftyp") return false;
    const last = abyssPartCount(spec.s) - 1;
    const lastLen = abyssPartLength(spec.s, last);
    const tail = await getRange(abyssPartUrl(spec, last), `bytes=${lastLen - 1}-${lastLen - 1}`, {
      referer: ABYSS_REFERER,
      timeoutMs: PROBE_TIMEOUT_MS,
      ...(signal === undefined ? {} : { signal }),
    });
    return tail.status === 206 && tail.body.length >= 1;
  } catch {
    return false;
  }
}

/**
 * One part, whole, with the app handler's tolerance: two attempts, and a SHORT
 * FINAL part is returned rather than rejected (storage truncates mid-part and a
 * few hundred real bytes should not throw away a mostly-playable file).  A short
 * NON-final part is a fault — everything after it is missing, not truncated.
 */
export async function fetchPart(spec, part, { signal, timeoutMs = DEFAULT_PART_TIMEOUT_MS, onRetry } = {}) {
  const total = abyssPartCount(spec.s);
  const expected = abyssPartLength(spec.s, part);
  const isLast = part === total - 1;
  const url = abyssPartUrl(spec, part);
  let reason = "unknown";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const bytes = await getBytes(url, {
        referer: ABYSS_REFERER,
        accept: "*/*",
        timeoutMs,
        ...(signal === undefined ? {} : { signal }),
      });
      if (bytes.byteLength === expected) return { bytes, short: false };
      if (isLast && bytes.byteLength < expected) return { bytes, short: true };
      reason = `length ${bytes.byteLength} != ${expected}`;
    } catch (error) {
      if (signal?.aborted === true) throw error;
      reason = String(error?.message ?? error);
    }
    if (attempt === 1) onRetry?.({ part, reason });
  }
  throw new ApiError(`abyss part ${part} failed: ${reason}`, 0, "PART_FAILED");
}

/**
 * Container sniff on stitched bytes.  `headContainer` (dubAudio.mjs) is the one
 * rule all six exports share: it reads what the head bytes ARE, so a PNG or an
 * HTML error page never passes as a video because its size looked right.
 */
export const sniffContainer = headContainer;

/**
 * Stitch the parts into ONE real .mp4.  Parts are fetched in order and written
 * as they arrive, so `maxParts` produces a real, short, playable-prefix file
 * instead of paying for 400 MiB — which is what verification uses.  Refuses to
 * believe the result without sniffing it, and reports a truncation rather than
 * hiding one.
 */
export async function download(specOrUrl, outPath, { signal, onProgress, maxParts, timeoutMs } = {}) {
  const spec = normalizeSpec(specOrUrl);
  if (spec === null) throw new ApiError("watchanimeworld download needs an AbyssSpec or a waw-abyss virtual URL", 0, "BAD_SPEC");
  const total = abyssPartCount(spec.s);
  const wanted = maxParts === undefined ? total : Math.min(maxParts, total);
  const stream = createWriteStream(outPath);
  let written = 0;
  let partsWritten = 0;
  let shortAt = -1;
  try {
    for (let part = 0; part < wanted; part++) {
      const { bytes, short } = await fetchPart(spec, part, {
        ...(signal === undefined ? {} : { signal }),
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
      });
      if (part === 0) {
        const sniffed = sniffContainer(bytes);
        // A head that is not an MP4 box means the copy served something else;
        // writing it would produce a file that passes every size check.
        if (sniffed !== "mp4") {
          throw Object.assign(new ApiError(`part 0 is not an MP4 container (sniffed ${sniffed})`, 0, "DECOY_CDN"), { sniffed });
        }
      }
      await new Promise((resolve, reject) =>
        stream.write(bytes, (err) => (err ? reject(err) : resolve())),
      );
      written += bytes.byteLength;
      partsWritten += 1;
      onProgress?.({ part: partsWritten, of: wanted, bytes: written });
      if (short) { shortAt = part; break; }
    }
  } finally {
    await new Promise((resolve, reject) => stream.close((err) => (err ? reject(err) : resolve())));
  }
  return {
    outPath,
    sizeBytes: written,
    mimeType: "video/mp4",
    container: "mp4",
    parts: partsWritten,
    totalParts: total,
    declaredBytes: spec.s,
    // A short final part, or a deliberate maxParts cut, are both truncations —
    // but only the first is upstream's fault, and the caller must be able to tell.
    truncatedUpstream: shortAt >= 0,
    truncatedByRequest: partsWritten < total,
  };
}

/** Accepts an AbyssSpec, a `direct[]` row (which carries one), or a virtual URL. */
function normalizeSpec(input) {
  if (typeof input === "string") return parseAbyssVirtualUrl(input);
  const spec = input?.spec ?? input;
  if (spec === null || spec === undefined || typeof spec !== "object") return null;
  // Round-tripped through the decoder so a hand-built object is held to the same
  // shape rules a server-minted token is (digit-only id, safe size, bare hostname).
  return decodeAbyssSpec(encodeAbyssSpec(spec));
}

// ------------------------------------------------------------------ chain

/**
 * WordPress search: `GET /?s=<q>` with the site as Referer.  A non-200 raises —
 * there is no body-shape fault to distinguish here, because this route answers
 * 200 with an empty `<ul>` for a term nothing matches and 404 only for a broken
 * path (measured 2026-10-13).
 */
export async function search(term, { signal } = {}) {
  const query = normalizeUnicodeToAscii(String(term).trim());
  if (!query) return [];
  const html = await getText(`${WAW_MAIN}/?s=${encodeURIComponent(query)}`, {
    referer: defaultWatchAnimeWorldReferer,
    ...(signal === undefined ? {} : { signal }),
  });
  const seen = new Set();
  const scored = [];
  for (const card of parseSearchCards(WAW_MAIN, html)) {
    if (seen.has(card.slug)) continue;
    seen.add(card.slug);
    scored.push({
      media: { id: `watchanimeworld:${card.slug}`, kind: "anime", title: card.title, provider: "watchanimeworld", ...(card.coverUrl ? { coverUrl: card.coverUrl } : {}) },
      score: similarity(query, card.title),
    });
  }
  return scored
    .sort((a, b) => (b.score - a.score) || (normalizeTitle(a.media.title).length - normalizeTitle(b.media.title).length) || a.media.id.localeCompare(b.media.id))
    .map((s) => s.media);
}

function seriesRef(idOrUrl) {
  const raw = String(idOrUrl).trim();
  if (/^https?:\/\//i.test(raw)) {
    const slug = raw.match(/\/series\/([^"/?#]+)/i)?.[1] ?? "";
    if (!slug) throw new ApiError(`cannot parse series URL ${raw}`, 0, "BAD_REF");
    return { slug, url: raw.replace(/\/$/, "") };
  }
  const slug = raw.replace(/^watchanimeworld:/, "").replace(/^\/+/, "").replace(/\/+$/, "");
  if (!slug) throw new ApiError("series id is empty", 0, "BAD_REF");
  return { slug, url: `${WAW_MAIN}/series/${slug}/` };
}

/**
 * All seasons through one AJAX route.  The in-page `ul#episode_by_temp` carries
 * only the ACTIVE season, so reading it would need a special case for one
 * arbitrary season; the picker's `a[data-post][data-season]` covers every one.
 * Concurrency is capped at 3 because a 20-season crawl otherwise arrives as one
 * burst and the shared host starts refusing.
 */
export async function episodes(idOrSlugOrUrl, { signal } = {}) {
  const ref = seriesRef(idOrSlugOrUrl);
  const html = await getText(ref.url, { referer: defaultWatchAnimeWorldReferer, ...(signal === undefined ? {} : { signal }) });
  const seasons = parseSeasonAnchors(html);
  if (seasons.length === 0) return dedupeByNumber(parseEpisodeItems(WAW_MAIN, html, ref.slug));
  const byNumber = new Map();
  let failures = 0;
  /** @type {Set<Promise<void>>} */
  const inFlight = new Set();
  for (const season of seasons) {
    const task = (async () => {
      try {
        const url =
          `${WAW_MAIN}/wp-admin/admin-ajax.php` +
          `?action=action_select_season&season=${String(season.season)}&post=${encodeURIComponent(season.postId)}`;
        const body = await getText(url, {
          referer: ref.url,
          headers: { "x-requested-with": "XMLHttpRequest" },
          ...(signal === undefined ? {} : { signal }),
        });
        for (const episode of parseEpisodeItems(WAW_MAIN, body, ref.slug)) {
          if (!byNumber.has(episode.number)) byNumber.set(episode.number, episode);
        }
      } catch {
        failures += 1;
      }
    })().finally(() => inFlight.delete(task));
    inFlight.add(task);
    if (inFlight.size >= SEASON_CONCURRENCY) await Promise.race(inFlight);
  }
  await Promise.all(inFlight);
  const out = [...byNumber.values()].sort((a, b) => a.number - b.number);
  if (out.length === 0 && failures === seasons.length) {
    throw new ApiError(`all ${seasons.length} season requests failed`, 0, "UPSTREAM_REJECTED");
  }
  return out;
}

export async function details(idOrSlugOrUrl, { signal } = {}) {
  const ref = seriesRef(idOrSlugOrUrl);
  const html = await getText(ref.url, { referer: defaultWatchAnimeWorldReferer, ...(signal === undefined ? {} : { signal }) });
  const media = mediaFromPage(WAW_MAIN, ref.slug, html);
  const list = await episodes(idOrSlugOrUrl, { ...(signal === undefined ? {} : { signal }) });
  return { media, episodes: list };
}

/**
 * The abyss page for one language -> probed renditions.  Every quality keeps its
 * own first passing copy; a language whose candidates all fail the probe returns
 * an empty list rather than an error, because one broken upload must not take the
 * other languages down.
 */
async function sourcesForLanguage(prefix, target, { signal } = {}) {
  const abyssUrl = `${prefix.replace(/\/+$/, "")}/${target.slug}`;
  const html = await getText(abyssUrl, { referer: defaultWatchAnimeWorldReferer, ...(signal === undefined ? {} : { signal }) });
  const outer = parseAbyssDatas(html);
  const manifest = decryptAbyssManifest(outer);
  const candidates = selectRenditionCandidates(manifest.sources);
  const out = [];
  await Promise.all(
    [...candidates.entries()].map(async ([quality, rows]) => {
      for (const row of rows) {
        const spec = { m: outer.md5_id, r: row.res_id, s: row.size, h: row.sub };
        if (await probeCopy(spec, { ...(signal === undefined ? {} : { signal }) })) {
          out.push({
            provider: "watchanimeworld",
            extractorId: "watchanimeworld",
            name: `${target.label} · ${quality}p`,
            // What the AniVerse player is handed (stitched, range-served, token-hidden):
            url: buildAbyssVirtualUrl(spec),
            // What an operator can fetch from here — part 0 of the real copy:
            partUrl: abyssPartUrl(spec, 0),
            spec,
            type: "video",
            container: "mp4",
            quality: toSourceQuality(quality),
            codec: row.codec,
            language: target.lang,
            languageLabel: target.label,
            audioType: "dub",
            isDub: true,
            host: `${spec.h}.sssrr.org`,
            sizeBytes: spec.s,
            parts: abyssPartCount(spec.s),
            partBytes: abyssChunkSize(spec.s),
            slug: target.slug,
            abyssUrl,
          });
          break;
        }
      }
    }),
  );
  return out;
}

/**
 * Sources for one episode.  There are no embeds: the manifest's parts ARE the
 * stream, so a caller that expects `embeds.length > 0` will report this provider
 * as empty — `direct` is where the answer lives.
 *
 * `audioType` is honoured in the only direction this site allows.  Every episode
 * it publishes is a dub (the episode page's only working iframe is
 * `/dub-player/t/`), so a `sub` ask legitimately has nothing to serve and answers
 * with zero rows plus an `available` that says so.  That is the census record for
 * this provider, printed rather than assumed: the dub label here cannot be
 * byte-checked against a sub peer, because there is no sub peer.
 */
export async function sources(episodeRef, { audioType, signal } = {}) {
  const ref = decodeEpisodeRef(episodeRef);
  if (ref === null) throw new ApiError("episode id is not a watchanimeworld ref", 0, "BAD_REF");
  const episodeHtml = await getText(ref.episodeUrl, { referer: defaultWatchAnimeWorldReferer, ...(signal === undefined ? {} : { signal }) });
  const dubPlayerUrl = parseDubPlayerUrl(WAW_MAIN, episodeHtml);
  if (dubPlayerUrl === null) throw new ApiError("episode page carries no dub-player iframe", 0, "NO_PLAYER");
  const configHtml = await getText(dubPlayerUrl, { referer: ref.episodeUrl, ...(signal === undefined ? {} : { signal }) });
  const config = parseDubPlayerConfig(configHtml);
  if (config === null) throw new ApiError("dub-player config not parseable", 0, "NO_CONFIG");

  const targets = selectLanguageTargets(config);
  const perLanguage = await Promise.all(
    targets.map(async (target) => {
      try {
        return await sourcesForLanguage(config.prefix, target, { ...(signal === undefined ? {} : { signal }) });
      } catch {
        return [];
      }
    }),
  );
  const dub = perLanguage.flat();
  const askedSub = audioType !== undefined && audioType !== null && audioType !== "dub";
  return {
    provider: "watchanimeworld",
    embeds: /** @type {string[]} */ ([]),
    direct: askedSub ? [] : dub,
    subtitles: /** @type {string[]} */ ([]),
    audioType: askedSub ? undefined : "dub",
    // What the page published per group. `sub` is structurally 0 here, and
    // saying so is the difference between "no dub peer exists" and "the parse
    // missed" — which is the question the dub census keeps asking.
    available: { sub: 0, dub: dub.length },
    languages: targets.map((t) => t.lang),
  };
}

/**
 * The only audio-honesty measurement this site permits.  Its byte groups are not
 * sub-vs-dub (there is no sub), they are the LANGUAGE labels in `ready` — hin,
 * eng, jpn — each pointing at its own abyss slug.  Two languages collapsing onto
 * one upload, or two slugs whose files are byte-identical, means the player's
 * language menu is naming one file twice.  Same vocabulary as `dubAudio.mjs`:
 * `copy` / `distinct` / `unknown`, decided on the first part's head, never on
 * the site's word.
 */
export async function audioPairVerdict(episodeRef, { left = "hin", right = "eng", quality, signal, headBytes } = {}) {
  const { direct, available } = await sources(episodeRef, { audioType: "dub", ...(signal === undefined ? {} : { signal }) });
  const sideOf = (lang) => direct.filter((d) => d.language === lang);
  const a = sideOf(left), b = sideOf(right);
  if (a.length === 0 || b.length === 0) {
    return { verdict: "unknown", reason: `this episode publishes ${[left, right].filter((l) => sideOf(l).length === 0).join(" and ")} with no bytes to compare`, available };
  }
  const rung = sharedRung(a.map((d) => ({ quality: String(d.quality), entry: d })), b.map((d) => ({ quality: String(d.quality), entry: d })), quality);
  if (!rung) return { verdict: "unknown", reason: "no shared quality label between the two languages", available };
  const opts = { headers: { referer: ABYSS_REFERER }, ...(signal === undefined ? {} : { signal }), ...(headBytes === undefined ? {} : { limit: headBytes }) };
  // sharedRung's fields are named sub/dub; here they carry the LEFT/RIGHT language rows.
  const lhs = await headFingerprint(rung.sub.entry.partUrl, opts);
  const rhs = await headFingerprint(rung.dub.entry.partUrl, opts);
  if (lhs.error || rhs.error) {
    return { verdict: "unknown", reason: `head read refused: ${lhs.error ?? ""} ${rhs.error ?? ""}`.trim(), quality: rung.quality, left: lhs, right: rhs };
  }
  return {
    verdict: lhs.md5 === rhs.md5 ? "copy" : "distinct",
    quality: rung.quality,
    rungExact: rung.exact,
    left: { ...lhs, language: left },
    right: { ...rhs, language: right },
  };
}

/** search -> details -> first matching episode -> sources -> stitched .mp4. */
export async function downloadEpisode(query, episodeNumber, outPath, { signal, onProgress, audioType = "dub", maxParts, quality } = {}) {
  const hits = await search(query, { ...(signal === undefined ? {} : { signal }) });
  const hit = hits[0];
  if (hit === undefined) throw new ApiError(`search for "${query}" returned nothing on WatchAnimeWorld`, 0);
  const { episodes: list } = await details(hit.id, { ...(signal === undefined ? {} : { signal }) });
  const ep = list.find((e) => e.number === Number(episodeNumber)) ?? list[Number(episodeNumber) - 1];
  if (ep === undefined) throw new ApiError(`episode ${episodeNumber} not listed for ${hit.title}`, 0);
  const { direct, available } = await sources(ep.id, { audioType, ...(signal === undefined ? {} : { signal }) });
  if (direct.length === 0) {
    throw new ApiError(`no ${audioType} stream for ${hit.title} ep ${episodeNumber}; the page published sub=${available.sub} dub=${available.dub}`, 0);
  }
  const pick = (quality !== undefined ? direct.find((d) => String(d.quality) === String(quality)) : undefined) ?? direct[0];
  const result = await download(pick.spec, outPath, { ...(signal === undefined ? {} : { signal }), maxParts });
  return { media: hit.title, episode: ep.number, ...result, audio: "dub", language: pick.languageLabel ?? pick.language, quality: pick.quality, codec: pick.codec, host: pick.host };
}

export const PROVIDER = { id: "watchanimeworld", name: "WatchAnimeWorld", baseUrl: WAW_MAIN, language: "hi" };
