// @ts-check
/**
 * AnimeDubHindi API — one provider, end to end.
 *
 * A standalone, dependency-free port of the animedubhindi.link chain, recovered
 * and proven by live HTTP measurement from plain Node on 2026-10-11 and
 * re-walked end to end on 2026-10-14 (proxy disabled) — every endpoint, header
 * and parsing rule below was read off a real response.  Node 18+: global
 * `fetch` and `node:fs` only, nothing imported from AniVerse.
 *
 * This is the export that ends where the others cannot: **a whole file**.  The
 * six HLS exports stop at a segment head, and WatchAnimeWorld stitches 2 MiB
 * parts of an MP4 it can only address part-by-part.  Here the last hop is a
 * Cloudflare Worker that serves one complete Matroska with HTTP Range, so this
 * module can fetch `bytes=100000000-100000063` and get video back, and can write
 * a 160,950,974-byte episode to disk and prove it is EBML at both ends.
 *
 *   search(term)                    -> [{ id, slug, title, coverUrl }]
 *   details(idOrSlugOrUrl)          -> { media, episodes:[{ id, number, audioType:"dub" }] }
 *   sources(episodeRef,{audioType}) -> { embeds:[15 mirror URLs], direct:[], available, skip }
 *   resolve(embedUrl)               -> the terminal behind an adhlinks route
 *   download(terminalUrl,{outPath}) -> one complete .mkv, range by range
 *   audioTruth(embedOrRef)          -> the file's OWN audio tracks, read from EBML
 *   downloadEpisode(term, ep, out)  -> search->sources->resolve->download in one call
 *
 * Route map, measured 2026-10-11 and re-walked 2026-10-14:
 *
 *   GET https://www.animedubhindi.link/?s=<q>       -> Astra `<article id=post-<id>>`
 *        cards: h2.entry-title > a[rel=bookmark] holds /<slug>/, the poster is a
 *        Jetpack-proxied blogger.googleusercontent image (8 hits for "slime")
 *   GET /<slug>/                                    -> h1.entry-title plus ONE
 *        a.wp-block-button__link whose href is new.adhlinks.com/episode/<slug>/
 *   GET https://new.adhlinks.com/episode/<slug>/    -> one `<h2>Episode: NN</h2>`
 *        section per episode (24 for Slime S01), each with a single `<h4>` that
 *        carries three quality markers `[480P x264] [720P x264] [1080P x265 10bit]`
 *        and five mirror anchors per marker, always in this order:
 *          Hcloud  https://hubcloud.ist/drive/<code>        (another extractor)
 *          Multi   /re.php?data=<base64>                    -> THIS module
 *          GDF     https://gdflix.dev/file/<id>             (another extractor)
 *          Fprs    https://fpgo.xyz/file/<id>               (another extractor)
 *          MEGA    /redirect.php?data=<base64>              -> EMBED_ONLY
 *   GET /re.php?data=<b64>       -> 200 JS interstitial, `var redirectUrl="<b64>"`
 *        decodes to https://filesforever.link/file/<code>
 *   GET https://filesforever.link/file/<code>
 *                                -> 302 -> 302 -> https://pro.iqsmartgames.com/files/<token>
 *        whose 50,552-byte ad-gate page carries
 *        `<input name="source_url" value="https://<worker>.workers.dev/?id=<t>&name=<file>.mkv">`
 *   GET https://<worker>.workers.dev/?id=<t>&name=<f>.mkv   [Range: bytes=0-65535]
 *                                -> 206 video/x-matroska, content-range
 *                                   bytes 0-65535/160950974, EBML magic 1a45dfa3
 *
 * Three things about this chain are easy to get wrong and each one is silent:
 *
 *   1. The mirror list must be read from the anchor **hrefs**, not the labels.
 *        The zip-pack rows at the bottom of the page label a `/redirect.php`
 *        target "Hcloud", so label-based classification routes a MEGA link to a
 *        drive extractor.  And the trailing `desidubanime.me` "Watch online"
 *        hand-out shares the same h4 as the mirrors — it is not one.
 *   2. `redirect.php` answers 302 to cuty.io, and the useful data is in the
 *        302's **body**, not the destination: an HTML comment naming the
 *        shortener's own server-side API call leaks the real mega.nz target.
 *        Following the Location walks into a redirect loop and shows nothing.
 *   3. `source_url` is HTML-escaped (`&amp;` before `name=`).  Read it raw and
 *        the worker sees a truncated query and serves an error page with 200.
 *
 * The audio question here is not the one the other exports answer.  There are
 * no sub/dub groups to compare — each file is ONE upload whose name claims
 * "Multi Audio", so `comparePair` has no pair to hash.  Instead `audioTruth`
 * reads the container's own Tracks element out of a 1 MiB ranged head and
 * reports how many audio tracks the file really has and in what languages,
 * which turns the site's filename claim into a measurement (`dubProvenance`).
 */
import { createWriteStream } from "node:fs";
import { headContainer } from "./dubAudio.mjs";

const ADB_MAIN = "https://www.animedubhindi.link";
const ADHLINKS_ORIGIN = "https://new.adhlinks.com";

export const defaultAnimeDubHindiReferer = `${ADB_MAIN}/`;

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** The page timeouts. The gate page is a redirect chain, so it gets its own budget. */
const PAGE_TIMEOUT_MS = 30_000;
const GATE_TIMEOUT_MS = 45_000;
/** 1 MiB, from the throughput probe on this worker (2026-10-14): 1 MiB ranges
 *  sustained 102 KB/s, one 8 MiB range managed 39 KB/s, and 4 parallel 1 MiB
 *  ranges aggregate 60 KB/s — bigger requests are slower and concurrency does
 *  not help, so chunks stay small and sequential and a stalled one is retried. */
const DEFAULT_CHUNK_BYTES = 1024 * 1024;
const CHUNK_TIMEOUT_MS = 120_000;
const CHUNK_ATTEMPTS = 3;
/** Enough of the file to hold the EBML header + Segment Info + Tracks, which is
 *  what `audioTruth` needs; the census reads 1 MiB because Tracks can sit late. */
export const TERMINAL_HEAD_BYTES = 64 * 1024;
export const TRACKS_HEAD_BYTES = 1024 * 1024;

/** The mirror names the site prints, in the order its h4 lists them. */
export const MIRROR_ORDER = ["Hcloud", "Multi", "GDF", "Fprs", "MEGA"];

// --------------------------------------------------------------------- HTTP

class ApiError extends Error {
  constructor(message, status = 0, code = "ERROR") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/** @param {string} url */
async function request(url, { headers, referer, signal, timeoutMs, redirect } = {}) {
  const merged = { "user-agent": DEFAULT_UA, accept: "*/*", ...(referer ? { referer } : {}), ...(headers ?? {}) };
  const signals = [];
  if (timeoutMs !== undefined) signals.push(AbortSignal.timeout(timeoutMs));
  if (signal !== undefined) signals.push(signal);
  /** @type {RequestInit} */
  const init = { headers: merged, ...(redirect ? { redirect } : {}) };
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

/** A ranged GET kept as `{status, body, total}` — the status is the answer here. */
async function getRange(url, range, opts = {}) {
  const res = await request(url, { ...opts, headers: { ...opts.headers, range } });
  const body = Buffer.from(await res.arrayBuffer());
  return { status: res.status, body, total: parseContentRangeTotal(res.headers.get("content-range")), ct: res.headers.get("content-type") };
}

function parseContentRangeTotal(value) {
  const m = /\/(\d+)\s*$/.exec(String(value ?? ""));
  return m ? Number(m[1]) : undefined;
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
 * WordPress `/?s=` takes a plain-term query; curly quotes and zero-width spaces
 * reach the site as different queries and answer a differently-shaped page.
 */
export function normalizeUnicodeToAscii(text) {
  return text
    .replace(/[‘’‚‛˂′']/g, "'")
    .replace(/[“”‟″"]/g, '"')
    .replace(/[–—―]/g, "-")
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
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

// -------------------------------------------------------------- page parsers

/**
 * `<article id="post-<id>">` cards. The h2.entry-title anchor is the only one
 * whose relationship is `bookmark`; the card image anchor points at the same
 * href but carries an aria-label that duplicates the title, so the heading is
 * the single source. The one article image whose host is a Jetpack proxy of
 * blogger.googleusercontent is the poster — anything else is a site logo.
 */
export function parseSearchCards(main, html) {
  const out = [];
  for (const match of html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)) {
    const block = match[1] ?? "";
    const heading = /<h2\b[^>]*class="[^"]*entry-title[^"]*"[^>]*>([\s\S]*?)<\/h2>/i.exec(block)?.[1];
    if (heading === undefined) continue;
    const href = attr(heading, /<a\b[^>]*\bhref="([^"]+)"[^>]*>/i);
    let slug;
    if (href !== undefined) {
      try {
        slug = new URL(href, main).pathname.split("/").filter(Boolean)[0];
      } catch {
        slug = undefined;
      }
    }
    const rawTitle = clean(heading);
    if (!slug || rawTitle === undefined) continue;
    const imgRaw = attr(block, /<img\b[^>]*\bsrc="([^"]+)"[^>]*>/i);
    const coverUrl = imgRaw && imgRaw.includes("blogger.googleusercontent") ? absolute(main, imgRaw) : undefined;
    out.push({ slug, title: cleanAdbTitle(rawTitle) || rawTitle, ...(coverUrl ? { coverUrl } : {}) });
  }
  return out;
}

export function mediaFromPage(main, slug, html) {
  const h1 = clean(html.match(/<h1\b[^>]*class="[^"]*entry-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i)?.[1]);
  const fallback = clean((attr(html, /<title>([\s\S]*?)<\/title>/i) ?? "").replace(/\s*[-–|].*$/, ""));
  const raw = h1 ?? fallback;
  const coverRaw = attr(html, /<meta\b[^>]*property="og:image"[^>]*content="([^"]+)"/i);
  return {
    id: `animedubhindi:${slug}`,
    kind: "anime",
    provider: "animedubhindi",
    title: raw === undefined ? `animedubhindi ${slug}` : cleanAdbTitle(raw) || raw,
    ...(coverRaw ? { coverUrl: absolute(main, coverRaw) } : {}),
  };
}

/**
 * Every post title carries the site's distribution noise after the name: a
 * language list, an audio tag, a source tag and "Episodes Download". The
 * language list is the fragile part (open-ended), so it is cut LAST, after the
 * fixed tags anchor the end. "Season NN" is NOT noise — seasons are what tell
 * sibling posts apart.
 */
export function cleanAdbTitle(raw) {
  let title = raw;
  title = title.replace(/\s*\((?:Multi|Dual)\s*Audio\)[\s\S]*$/i, "");
  title = title.replace(/\s*\b(?:WEB-DL|WEBRip|BluRay|BDRip|HDRip|HDTV)\b[\s\S]*$/i, "");
  title = title.replace(/\s*\bEpisodes?\s*Download\s*$/i, "");
  title = title.replace(
    /\s+(?:Hindi|English|Japanese|Tamil|Telugu|Malayalam|Kannada|Bengali)(?:\s*\([^)]*\))?(?:\s*,\s*[A-Za-z]+(?:\s*\([^)]*\))?)*\s*$/i,
    "",
  );
  return title.replace(/\s+/g, " ").trim();
}

/** The one "Download / Watch" button anchors the adhlinks episode index. */
export function parseFunnelUrl(main, html) {
  for (const match of html.matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>/gi)) {
    const href = match[1];
    if (href === undefined || !/adhlinks\.com\/episode\//i.test(href)) continue;
    const url = absolute(main, href);
    if (url !== undefined) return url;
  }
  return null;
}

/**
 * Which `<h2>`s are real episodes. "Season End" and "Zip Pack" headings fail the
 * numeric shape and are dropped here, so their rows never reach mirror parsing.
 */
export function parseAdhlinksEpisodeNumbers(html) {
  const numbers = new Set();
  for (const match of html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)) {
    const text = clean(match[1]);
    const raw = text === undefined ? undefined : /^Episode\s*:\s*(\d+)$/i.exec(text)?.[1];
    if (raw === undefined) continue;
    const number = Number(raw);
    if (Number.isSafeInteger(number) && number > 0) numbers.add(number);
  }
  return [...numbers].sort((a, b) => a - b);
}

/**
 * The mirrors of one episode, in site order: for each `[NNNP …]` marker
 * segment of the section's h4, every http(s) anchor except the desidubanime.me
 * "Watch online" hand-out. Classification is by href because the labels lie.
 */
export function parseAdhlinksEpisodeMirrors(html, baseUrl, episodeNumber) {
  const section = adhlinksEpisodeSection(html, episodeNumber);
  if (section === null) return [];
  const h4 = /<h4\b[^>]*>([\s\S]*?)<\/h4>/i.exec(section)?.[1];
  if (h4 === undefined) return [];
  const markerPositions = [];
  for (const match of h4.matchAll(/\[(\d{3,4})\s*P\b[^\]]*\]/gi)) {
    markerPositions.push({ at: match.index ?? 0, quality: Number(match[1]) });
  }
  if (markerPositions.length === 0) return [];
  /** @type {{url: string, quality: number, marker: string}[]} */
  const out = [];
  for (let i = 0; i < markerPositions.length; i++) {
    const start = markerPositions[i].at;
    const quality = markerPositions[i].quality;
    const end = markerPositions[i + 1]?.at ?? h4.length;
    const label = /\[[^\]]*\]/.exec(h4.slice(start))?.[0] ?? `${quality}P`;
    for (const match of h4.slice(start, end).matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>/gi)) {
      const href = match[1];
      if (href === undefined) continue;
      let resolved;
      try {
        resolved = new URL(decodeEntities(href), baseUrl);
      } catch {
        continue;
      }
      if (resolved.protocol !== "http:" && resolved.protocol !== "https:") continue;
      if (/(^|\.)desidubanime\.me$/i.test(resolved.hostname)) continue;
      out.push({ url: resolved.href, quality, marker: label });
    }
  }
  return out;
}

/**
 * A section runs from its "Episode: NN" h2 to the NEXT h2 of any kind — that
 * boundary is what stops a truncated last row from leaking the "Season End"
 * blurbs or the zip packs into the mirror list.
 */
function adhlinksEpisodeSection(html, episodeNumber) {
  /** @type {{start: number, end: number, number: number|null}[]} */
  const headings = [];
  for (const match of html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)) {
    const text = clean(match[1]);
    const raw = text === undefined ? undefined : /^Episode\s*:\s*(\d+)$/i.exec(text)?.[1];
    headings.push({
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
      number: raw === undefined ? null : Number(raw),
    });
  }
  for (let i = 0; i < headings.length; i++) {
    if (headings[i].number !== episodeNumber) continue;
    return html.slice(headings[i].end, headings[i + 1]?.start ?? html.length);
  }
  return null;
}

/** Episode ids carry the series slug, the episode number and the page to re-fetch. */
export function encodeEpisodeRef(input) {
  return ["animedubhindi", input.seriesSlug, String(input.number), input.pageUrl].join("|");
}

export function decodeEpisodeRef(id) {
  const raw = String(id).trim();
  if (!raw.startsWith("animedubhindi|")) return null;
  const parts = raw.split("|");
  if (parts.length < 4) return null;
  const pageUrl = parts.slice(3).join("|");
  if (!/^https?:\/\//i.test(pageUrl)) return null;
  const number = Number(parts[2] ?? "0");
  if (!Number.isSafeInteger(number) || number <= 0) return null;
  return { seriesSlug: parts[1] ?? "", number, pageUrl };
}

// ---------------------------------------------------------- mirror hand-outs

/**
 * Which of the five hand-outs a mirror URL belongs to. By href, always: the
 * zip-pack rows label a `/redirect.php` target "Hcloud", and the label is what
 * a naive reader would classify on.
 * @returns {"adhlinks-re" | "adhlinks-redirect" | "hubcloud" | "gdflix" | "fpgo" | "other"}
 */
export function classifyMirror(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return "other";
  }
  const host = u.hostname.toLowerCase();
  const onAdhlinks = /(^|\.)adhlinks\.com$/i.test(host);
  if (onAdhlinks && /\/re\.php$/i.test(u.pathname)) return "adhlinks-re";
  if (onAdhlinks && /\/redirect\.php$/i.test(u.pathname)) return "adhlinks-redirect";
  if (/(^|\.)hubcloud\.[a-z]+$/i.test(host)) return "hubcloud";
  if (/(^|\.)gdflix\.[a-z]+$/i.test(host)) return "gdflix";
  if (/^fpgo\.xyz$/i.test(host) || /(^|\.)fpgo\.xyz$/i.test(host)) return "fpgo";
  return "other";
}

/**
 * What a mirror's `data=` token holds, one base64 round on.
 *
 * Measured 2026-10-14 on live tokens: `MTZ0THlobEJ…PQ==` decodes to
 * `16tLyhlBl4dz6kK4SEQB/AXNVnh+dnZ4Pk243abpSPu5r/QbUNk=` — a second base64
 * handle, not a URL, and a second round gives binary. So `re.php`'s token is a
 * server-side reference the site resolves itself, and the destination only ever
 * appears in the interstitial's `redirectUrl` (see `parseAdhlinksRedirect`).
 * Decoding here is diagnostics: an operator comparing two rows can see they
 * carry different handles without assuming either is a link.
 *
 * @returns {string|null} the decoded payload, or null when there is no `data=`
 */
export function decodeMirrorData(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const data = u.searchParams.get("data");
  if (!data) return null;
  const b64 = decodeURIComponent(data).replace(/=+$/, "");
  try {
    const text = Buffer.from(b64, "base64").toString("utf8").trim();
    return text === "" ? null : text;
  } catch {
    return null;
  }
}

/** The re.php interstitial hides its destination in a base64 `redirectUrl`. */
export function parseAdhlinksRedirect(html) {
  const raw = /redirectUrl\s*=\s*["']([^"']+)["']/.exec(html)?.[1]?.trim();
  if (!raw) return null;
  try {
    const decoded = Buffer.from(raw, "base64").toString("utf8").trim();
    return /^https?:\/\//i.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

/**
 * The ad-gate page carries the playable URL in a hidden form input, HTML-escaped.
 * Left escaped, the worker sees `&amp;name=` as part of `id` and answers 200 with
 * an error page instead of the file.
 */
export function parseIqsmartSourceUrl(html) {
  const raw = /name=["']source_url["']\s+value=["']([^"']+)["']/i.exec(html)?.[1];
  if (!raw) return null;
  const url = raw.replace(/&amp;/g, "&").trim();
  return /^https?:\/\//i.test(url) ? url : null;
}

/** The cuty.io shortener leaks its real target in a comment naming its own API. */
export function parseCutyApiTarget(body) {
  const encoded = /[?&]url=([^\s"'<>&]+)/.exec(body)?.[1];
  if (!encoded) return null;
  try {
    const decoded = decodeURIComponent(encoded).trim();
    return /^https?:\/\//i.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

/** The worker URL names the file it serves in its `name` query parameter. */
export function terminalFileName(url) {
  try {
    const name = new URL(url).searchParams.get("name");
    return name && name.trim() !== "" ? name.trim() : null;
  } catch {
    return null;
  }
}

const QUALITY_LADDER = [240, 360, 480, 720, 1080, 1440, 2160];

/** `…1080p x265 10bit…mkv` or `[1080P x265]` -> 1080, snapped to the ladder. */
export function qualityFromName(name) {
  const m = /(\d{3,4})[pP]/.exec(String(name ?? ""));
  if (!m) return "unknown";
  const height = Number(m[1]);
  let best = QUALITY_LADDER[0];
  for (const candidate of QUALITY_LADDER) {
    if (Math.abs(candidate - height) < Math.abs(best - height)) best = candidate;
  }
  return best;
}

/** Which audio claim the filename itself makes. */
export function fileNameAudioClaim(name) {
  const text = String(name ?? "");
  if (/\bmulti[\s-]*audio\b/i.test(text)) return "Multi Audio";
  if (/\bdual[\s-]*audio\b/i.test(text)) return "Dual Audio";
  if (/\bhindi\b.*\bdub\b/i.test(text) || /\bdub\b/i.test(text)) return "Hindi dub";
  return null;
}

// ------------------------------------------------------- terminal resolution

/**
 * Walk `re.php` to the byte-serving worker URL. Two hops, both measured:
 * interstitial -> filesforever.link -> (302 x2) pro.iqsmartgames.com, whose
 * ad-gate page carries `source_url`. The redirect budget is followed by fetch;
 * the gate page needs no ad click for its markup.
 * @returns {Promise<{terminal: string, gate: string, landed: string, fileName: string|null}>}
 */
export async function resolveReTerminal(reUrl, { signal } = {}) {
  const interstitial = await getText(reUrl, {
    referer: `${ADHLINKS_ORIGIN}/`,
    timeoutMs: PAGE_TIMEOUT_MS,
    ...(signal === undefined ? {} : { signal }),
  });
  const gate = parseAdhlinksRedirect(interstitial);
  if (gate === null) throw new ApiError("re.php page carries no redirectUrl payload", 200, "EMPTY_STREAM");
  // res.url is the landed host: filesforever.link answers 302 twice and the
  // body that carries source_url belongs to pro.iqsmartgames.com, which is the
  // thing worth naming when a gate changes shape.
  const res = await request(gate, {
    referer: reUrl,
    timeoutMs: GATE_TIMEOUT_MS,
    ...(signal === undefined ? {} : { signal }),
  });
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new ApiError(`ad-gate returned ${res.status} for ${gate}`, res.status, "UPSTREAM_FAILURE");
  }
  const gatePage = await res.text();
  const terminal = parseIqsmartSourceUrl(gatePage);
  if (terminal === null) {
    throw new ApiError(`ad-gate page exposes no source_url (${gate})`, res.status, "EMPTY_STREAM");
  }
  return {
    terminal,
    gate,
    landed: hostOf(res.url) ?? new URL(gate).host,
    fileName: terminalFileName(terminal),
  };
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

/**
 * `redirect.php` has no server-side bytes: the 302's body leaks a mega.nz
 * target, which needs the MEGA client-side key to decrypt. Reported, not parsed
 * around — the same verdict the app's extractor gives (EMBED_ONLY).
 */
export async function resolveRedirectTarget(redirectUrl, { signal } = {}) {
  // redirect:"manual" is load-bearing — the 302's BODY is the payload.
  const res = await request(redirectUrl, {
    referer: `${ADHLINKS_ORIGIN}/`,
    redirect: "manual",
    timeoutMs: PAGE_TIMEOUT_MS,
    ...(signal === undefined ? {} : { signal }),
  });
  const body = await res.text().catch(() => "");
  return { target: parseCutyApiTarget(body), status: res.status };
}

/**
 * The registry-shaped answer for one hand-out URL. Progressive, not HLS: one
 * file, one rung, no playlist anywhere in it.
 */
export async function resolve(url, { referer, signal } = {}) {
  const kind = classifyMirror(url);
  if (kind === "other") {
    throw new ApiError(`not an adhlinks route (${new URL(url).host}) — resolve only the Multi/MEGA mirrors here`, 0, "NO_EXTRACTOR");
  }
  if (kind === "adhlinks-redirect") {
    const { target, status } = await resolveRedirectTarget(url, { ...(signal === undefined ? {} : { signal }) });
    throw new ApiError(
      `redirect.php is EMBED_ONLY: ${target ?? "the shortener leaked no target"} needs MEGA client-side decryption, so no direct bytes exist`,
      status,
      "EMBED_ONLY",
    );
  }
  if (kind !== "adhlinks-re") {
    throw new ApiError(`${kind} is a drive page, claimed by its own extractor, not by this chain`, 0, "NO_EXTRACTOR");
  }
  const { terminal, gate, fileName } = await resolveReTerminal(url, { ...(signal === undefined ? {} : { signal }) });
  const host = new URL(terminal).host;
  const headers = { "user-agent": DEFAULT_UA, referer: `${new URL(terminal).origin}/` };
  const probe = await probeTerminal(terminal, { ...(signal === undefined ? {} : { signal }) });
  const quality = qualityFromName(fileName ?? terminal);
  return {
    extractor: "adhlinks",
    provider: "animedubhindi",
    kind: "progressive",
    route: "re.php",
    gate,
    terminal,
    fileName,
    audioClaim: fileNameAudioClaim(fileName ?? ""),
    master: { url: terminal, headers, container: probe.container, totalBytes: probe.totalBytes },
    variants: [{
      url: terminal,
      name: quality === "unknown" ? "Adhlinks Direct" : `Adhlinks ${quality}p`,
      quality,
      container: probe.container,
      sizeBytes: probe.totalBytes,
      headers,
      host,
    }],
    subtitles: [],
    // No subtitle track is handed separately: the site's "ESub" is burned in, and
    // the Matroska's own TextTracks would need the full container to extract.
  };
}

/**
 * Ask the worker for the first bytes and read what it says about the whole.
 * The answer is a 206 whose `content-range` names the file's real size; a 200
 * means the server ignored Range (and would stream 160 MB), and anything else
 * means the token died.
 */
export async function probeTerminal(terminalUrl, { headBytes = TERMINAL_HEAD_BYTES, signal } = {}) {
  const origin = new URL(terminalUrl).origin;
  const res = await getRange(terminalUrl, `bytes=0-${headBytes - 1}`, {
    referer: `${origin}/`,
    timeoutMs: GATE_TIMEOUT_MS,
    ...(signal === undefined ? {} : { signal }),
  });
  const container = headContainer(res.body);
  if (res.status !== 206 || res.body.length < 32 || container !== "matroska" && container !== "mp4") {
    throw new ApiError(
      `terminal answered ${res.status} with ${res.body.length}B (${container})`,
      res.status,
      res.status === 200 ? "RANGE_IGNORED" : "UPSTREAM_FAILURE",
    );
  }
  return {
    ok: true,
    status: res.status,
    contentType: res.ct,
    totalBytes: res.total,
    declaredSizeKnown: res.total !== undefined,
    container,
    headBytes: res.body.length,
    head: res.body,
  };
}

// --------------------------------------------------- Matroska Tracks reader

const MKV_IDS = {
  EBML: 0x1a45dfa3, Segment: 0x18538067, SeekHead: 0x114d9b74, Info: 0x1549a966,
  Tracks: 0x1654ae6b, TrackEntry: 0xae, TrackNumber: 0xd7, TrackType: 0x83,
  FlagDefault: 0x88, FlagForced: 0x55aa, Language: 0x22b59c, LanguageIETF: 0x22b59d,
  CodecID: 0x86, Name: 0x536e, CodecPrivate: 0x63a2, TimecodeScale: 0x2ad7b1,
  // Duration's id is TWO bytes, `4489`, not the three-byte `4489d6` a reader
  // could infer from the EBML leading-bit rule being applied wrongly: 0x44 has
  // its marker bit at position 2, so the id ends after 0x89. Measured in the
  // live 480p head at byte 4239 — `4489 84 49adb788` (size 4, float32 =
  // 1423089 -> 1423.1 s at the default TimecodeScale) followed cleanly by
  // DateUTC `4461 88 <8 bytes>`. `indexOf(4489d6)` over the whole 64 KiB head
  // is -1. A three-byte read here mis-frames the rest of Info and loses the
  // duration without saying so.
  Duration: 0x4489,
  DateUTC: 0x4461,
  Cluster: 0x1f43b675, Void: 0xec, Cues: 0x1c53bb6b, Attachments: 0x1941a469, Chapters: 0x1043a770,
};

/**
 * TrackType is NOT ordered the intuitive way: 1 is video and 2 is audio.
 * Measured on the live 480p head, where track 1 carries V_MPEG4/ISO/AVC with
 * type 1 and the five A_VORBIS dubs (hin/tam/tel/und/jpn) all carry type 2.
 */
const TRACK_TYPES = { 1: "video", 2: "audio", 3: "complex", 0x10: "logo", 0x11: "subtitle", 0x12: "buttons", 0x20: "control" };

/**
 * EBML variable-length integer. `keepMarker` keeps the length-signalling bits,
 * which is what makes the value comparable to a documented element ID.
 */
export function readEbmlVint(buf, pos, keepMarker = false) {
  if (pos >= buf.length || buf[pos] === 0) return null;
  let len = 1;
  let mask = 0x80;
  while (len <= 8 && (buf[pos] & mask) === 0) {
    mask >>= 1;
    len += 1;
  }
  if (len > 8 || pos + len > buf.length) return null;
  let value = keepMarker ? buf[pos] : buf[pos] & (mask - 1);
  for (let i = 1; i < len; i++) value = value * 256 + buf[pos + i];
  return { value, length: len };
}

function unknownSize(value, len) {
  return value >= 2 ** (7 * len) - 1;
}

function readUInt(buf, pos, len) {
  let v = 0;
  for (let i = 0; i < len; i++) v = v * 256 + buf[pos + i];
  return v;
}

function readFloat(buf, pos, len) {
  if (len === 4) return buf.readFloatBE(pos);
  if (len === 8) return buf.readDoubleBE(pos);
  return undefined;
}

/**
 * Walk the children of one element, in order, without recursing into what the
 * caller did not ask for. `stopIds` ends the walk (a Cluster means only media
 * data follows).
 */
function* ebmlChildren(buf, start, end, stopIds) {
  let pos = start;
  let guard = 0;
  while (pos + 2 < end && guard++ < 4096) {
    const id = readEbmlVint(buf, pos, true);
    if (id === null) return;
    const size = readEbmlVint(buf, pos + id.length, false);
    if (size === null) return;
    const headerEnd = pos + id.length + size.length;
    const known = !unknownSize(size.value, size.length);
    const bodyEnd = known ? Math.min(headerEnd + size.value, end) : end;
    yield { id: id.value, start: headerEnd, end: bodyEnd, complete: known && headerEnd + size.value <= end };
    if (!known) return;
    pos = headerEnd + size.value;
    if (stopIds?.has(id.value)) return;
  }
}

/**
 * Read the file's own description of itself out of a ranged head: DocType,
 * duration, and every TrackEntry (type, language, codec, name).  Deliberately
 * strict — an absent Tracks element reports `partial`, it does not report zero
 * audio tracks, because "not in the first megabyte" and "the file has none" are
 * different claims and only the second one settles a filename.
 *
 * @param {Buffer|Uint8Array} head
 */
export function readMatroskaHead(head) {
  const buf = Buffer.isBuffer(head) ? head : Buffer.from(head.buffer, head.byteOffset ?? 0, head.byteLength ?? head.length);
  const out = {
    container: headContainer(buf),
    doctype: undefined,
    durationSec: undefined,
    audio: [], video: [], subtitle: [],
    tracksSeen: false, partial: true,
  };
  if (out.container !== "matroska") return { ...out, reason: `head is ${out.container}, not EBML` };

  for (const top of ebmlChildren(buf, 0, buf.length, undefined)) {
    if (top.id === MKV_IDS.EBML) {
      for (const child of ebmlChildren(buf, top.start, top.end, undefined)) {
        if (child.id === 0x4282) out.doctype = buf.subarray(child.start, child.end).toString("utf8").replace(/\0+$/, "");
      }
      continue;
    }
    if (top.id !== MKV_IDS.Segment) continue;
    for (const node of ebmlChildren(buf, top.start, top.end, new Set([MKV_IDS.Cluster]))) {
      if (node.id === MKV_IDS.Info) {
        let timecodeScale = 1_000_000;
        for (const f of ebmlChildren(buf, node.start, node.end, undefined)) {
          if (f.id === MKV_IDS.TimecodeScale) timecodeScale = readUInt(buf, f.start, f.end - f.start);
          if (f.id === MKV_IDS.Duration && f.end > f.start) {
            const raw = readFloat(buf, f.start, f.end - f.start);
            if (raw !== undefined) out.durationSec = Math.round((raw * timecodeScale) / 1_000_000_000 * 10) / 10;
          }
        }
        continue;
      }
      if (node.id !== MKV_IDS.Tracks) continue;
      out.tracksSeen = true;
      // "Tracks declared more bytes than the head holds" is not "the file has N
      // tracks": a cut-off walk must report partial, or a truncated read counts
      // as a measurement and settles a filename on tracks it never saw.
      out.partial = !node.complete;
      if (out.partial) out.reason = `Tracks element extends ${node.end - top.start}B past the ${buf.length}B head`;
      for (const entry of ebmlChildren(buf, node.start, node.end, undefined)) {
        if (entry.id !== MKV_IDS.TrackEntry) continue;
        /** @type {any} */
        const track = { number: undefined, type: undefined, language: undefined, languageIETF: undefined, codec: undefined, name: undefined, isDefault: undefined };
        for (const f of ebmlChildren(buf, entry.start, entry.end, undefined)) {
          if (f.id === MKV_IDS.TrackNumber) track.number = readUInt(buf, f.start, f.end - f.start);
          if (f.id === MKV_IDS.TrackType) track.type = readUInt(buf, f.start, f.end - f.start);
          if (f.id === MKV_IDS.FlagDefault) track.isDefault = readUInt(buf, f.start, f.end - f.start) === 1;
          if (f.id === MKV_IDS.Language) track.language = buf.subarray(f.start, f.end).toString("utf8").replace(/\0+$/, "");
          // Matroska v4 uploads carry both tags. On the live 480p file every audio
          // track has a filled LanguageIETF, and track 5 has no 3-char Language at
          // all — see trackLanguage for which field the verdict reads.
          if (f.id === MKV_IDS.LanguageIETF) track.languageIETF = buf.subarray(f.start, f.end).toString("utf8").replace(/\0+$/, "");
          if (f.id === MKV_IDS.CodecID) track.codec = buf.subarray(f.start, f.end).toString("utf8").replace(/\0+$/, "");
          if (f.id === MKV_IDS.Name) track.name = buf.subarray(f.start, f.end).toString("utf8").replace(/\0+$/, "");
        }
        track.kind = TRACK_TYPES[/** @type {number} */ (track.type)] ?? "unknown";
        if (track.kind === "audio") out.audio.push(track);
        else if (track.kind === "video") out.video.push(track);
        else if (track.kind === "subtitle") out.subtitle.push(track);
      }
    }
  }
  if (!out.tracksSeen) out.reason = "Tracks element is not inside the requested head";
  return out;
}

const LANGUAGE_NAMES = {
  hi: "Hindi", hin: "Hindi", ja: "Japanese", jpn: "Japanese", en: "English", eng: "English",
  ta: "Tamil", tam: "Tamil", te: "Telugu", tel: "Telugu", ml: "Malayalam", mal: "Malayalam",
  kn: "Kannada", kan: "Kannada", bn: "Bengali", ben: "Bengali", mul: "Multiple", und: "Undetermined",
};

export const languageName = (tag) => LANGUAGE_NAMES[String(tag).toLowerCase()] ?? String(tag).toUpperCase();

/**
 * The language a track states for itself, from the field that is actually filled.
 * Measured on the live 480p head: all five audio tracks carry a LanguageIETF tag
 * (hi/ta/te/en/ja), and track 5 has no 3-char Language element at all, while the
 * video track's 3-char tag reads "und". Preferring the IETF field is the only one
 * that names every audio track on the site's own uploads.
 */
export const trackLanguage = (track) =>
  String(track.languageIETF || track.language || "").trim().toLowerCase() || "und";

/**
 * Is the "Multi Audio" the filename claims actually in the container?
 *
 * @param {string} claim  what the site says ("Multi Audio", "Hindi dub", null)
 * @param {{audio:{language?:string,languageIETF?:string}[], tracksSeen:boolean, partial:boolean}} tracks
 */
export function multiAudioVerdict(claim, tracks) {
  const count = tracks.audio.length;
  if (!tracks.tracksSeen || tracks.partial) {
    return { verdict: "unknown", provenance: "claimed", reason: tracks.reason ?? "Tracks not fully inside the head" };
  }
  if (count === 0) {
    return { verdict: "no-audio-track", provenance: "measured-corrected", reason: "the container carries no audio track at all" };
  }
  const langs = [...new Set(tracks.audio.map(trackLanguage))];
  const hasDub = langs.some((l) => ["hi", "hin", "ta", "tam", "te", "tel", "ml", "mal", "kn", "kan", "bn", "ben"].includes(l));
  const hasSource = langs.some((l) => ["ja", "jpn"].includes(l));
  const measuredMulti = count > 1 || langs.includes("mul");
  const claimIsMulti = /multi/i.test(String(claim ?? ""));
  if (claimIsMulti && !measuredMulti) {
    return {
      verdict: "single-audio",
      provenance: "measured-corrected",
      reason: `filename says "${claim}", the container has ${count} audio track (${langs.join("/")})`,
      languages: langs,
    };
  }
  if (measuredMulti && hasDub && hasSource) {
    return { verdict: "multi", provenance: "measured", reason: `${count} audio tracks: dubbed and original both present`, languages: langs };
  }
  if (measuredMulti) {
    return { verdict: "multi", provenance: "measured", reason: `${count} audio tracks (${langs.join("/")})`, languages: langs };
  }
  return {
    verdict: hasDub ? "dub-single" : "sub-single",
    provenance: "measured",
    reason: `one audio track (${langs.join("/")}), no second language in the container`,
    languages: langs,
  };
}

// ----------------------------------------------------------------- download

/**
 * One range, with retries. A SHORT non-final chunk is a fault, not a truncation:
 * everything after it is missing. The final chunk being short is upstream's
 * doing and is reported.
 */
async function fetchRange(terminalUrl, start, end, { referer, signal, timeoutMs = CHUNK_TIMEOUT_MS, onRetry } = {}) {
  let reason = "unknown";
  for (let attempt = 1; attempt <= CHUNK_ATTEMPTS; attempt++) {
    try {
      const res = await getRange(terminalUrl, `bytes=${start}-${end}`, {
        ...(referer ? { referer } : {}),
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
        ...(signal === undefined ? {} : { signal }),
      });
      if (res.status === 206) {
        return { body: res.body, total: res.total, ct: res.ct, short: res.body.length < end - start + 1 };
      }
      reason = `HTTP ${res.status}${res.status === 200 ? " (Range ignored)" : ""}`;
    } catch (error) {
      if (signal?.aborted === true) throw error;
      reason = String(error?.message ?? error).slice(0, 80);
    }
    if (attempt < CHUNK_ATTEMPTS) onRetry?.({ start, attempt, reason });
  }
  throw new ApiError(`terminal range ${start}-${end} failed: ${reason}`, 0, "RANGE_FAILED");
}

/**
 * The MIME to hand a caller for a body whose container we already sniffed.
 *
 * The upstream label wins when it is a video container of its own: Matroska and
 * WebM are the SAME EBML family, so `headContainer` answers `"matroska"` for
 * both, and only the header distinguishes `video/webm` (VP9/Opus) from
 * `video/x-matroska` (H.264/Vorbis). A player that picks its demuxer off a wrong
 * MIME is how a playable file turns into MEDIA_ERR_SRC_NOT_SUPPORTED.
 *
 * Mirrored in the app as `resolveDownstreamContentType("video_matroska", …)` in
 * `src/core/playback/contentTypes.ts`. The app additionally has to classify from
 * the URL alone — its proxy decides the timeout bucket and the per-client stream
 * accounting before any byte arrives — and there the container lives only in the
 * `?name=…mkv` query, because the terminal's pathname is `/`. This module never
 * needs that guess: it ranges the head and reads the magic, which is the same
 * question answered with better evidence.
 *
 * @param {"matroska"|"mp4"|string} container  headContainer() answer
 * @param {string|null} [upstreamContentType]
 */
export function labelForContainer(container, upstreamContentType) {
  const ct = String(upstreamContentType ?? "").toLowerCase();
  if (container === "mp4") return "video/mp4";
  if (container !== "matroska") return ct || "application/octet-stream";
  return /video\/(x-matroska|webm)/.test(ct) ? ct : "video/x-matroska";
}

/**
 * Write one complete .mkv. Ranges are fetched in order and streamed to disk, so
 * `maxBytes` produces a real, short, playable prefix instead of paying for
 * 650 MB — which is what verification uses. Chunk 0 is sniffed before anything
 * is written: a 200-with-HTML would otherwise land as a file whose size checks
 * all pass.
 *
 * @param {string|{terminal?: string, url?: string}} input  terminal URL or a resolve() row
 */
export async function download(input, { outPath, referer, maxBytes, chunkBytes = DEFAULT_CHUNK_BYTES, signal, onProgress, timeoutMs } = {}) {
  const url = typeof input === "string" ? input : input?.terminal ?? input?.url;
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new ApiError("download needs the worker terminal URL", 0, "BAD_REF");
  }
  if (!outPath) throw new ApiError("download needs an outPath", 0, "BAD_REF");
  const origin = new URL(url).origin;
  const opts = {
    referer: referer ?? `${origin}/`,
    ...(signal === undefined ? {} : { signal }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
  const chunk = Math.max(64 * 1024, Number(chunkBytes) || DEFAULT_CHUNK_BYTES);

  // The opening request IS chunk 0: it answers the container question and the
  // declared size in one round trip, and its bytes are the first bytes of the
  // file, so nothing is fetched twice.
  const first = await fetchRange(url, 0, chunk - 1, opts);
  const container = headContainer(first.body);
  if (container !== "matroska" && container !== "mp4") {
    throw Object.assign(new ApiError(`terminal head is ${container}, not a media container`, 0, "DECOY_CDN"), { container });
  }
  const total = first.total;
  if (total === undefined) {
    throw new ApiError("terminal answered 206 without a content-range total", 206, "NO_SIZE");
  }
  const wanted = Number.isSafeInteger(maxBytes) && maxBytes > 0 ? Math.min(maxBytes, total) : total;
  const stream = createWriteStream(String(outPath));
  let written = 0;
  let chunks = 0;
  let shortAt = -1;
  try {
    let pending = first.body;
    let start = 0;
    while (start < wanted) {
      const want = Math.min(chunk, wanted - start);
      let slice = pending;
      if (slice.byteLength < want) {
        const next = await fetchRange(url, start, start + want - 1, opts);
        slice = next.body;
      }
      if (slice.byteLength > want) slice = slice.subarray(0, want);
      await new Promise((done, failed) => stream.write(slice, (err) => (err ? failed(err) : done())));
      written += slice.byteLength;
      chunks += 1;
      onProgress?.({ chunk: chunks, bytes: written, of: Math.ceil(wanted / chunk) });
      if (slice.byteLength < want) {
        shortAt = start;
        break;
      }
      start += slice.byteLength;
      pending = Buffer.alloc(0);
    }
  } finally {
    await new Promise((done, failed) => stream.close((err) => (err ? failed(err) : done())));
  }
  // A chunk that came back short is upstream's truncation; a stop at maxBytes
  // while every chunk was full is the caller's own cut. The two must not share
  // a flag, or a deliberate preview reads as a broken upload.
  const truncatedUpstream = shortAt >= 0;
  return {
    outPath: String(outPath),
    sizeBytes: written,
    mimeType: labelForContainer(container, first.ct),
    container,
    declaredBytes: total,
    chunks,
    totalChunks: Math.ceil(Math.min(wanted, total) / chunk),
    truncatedUpstream,
    truncatedByRequest: !truncatedUpstream && written < total,
    host: origin.replace(/^https:\/\//, ""),
    url,
  };
}

// ------------------------------------------------------------------ chain

export async function search(term, { signal } = {}) {
  const query = normalizeUnicodeToAscii(String(term).trim());
  if (!query) return [];
  const html = await getText(`${ADB_MAIN}/?s=${encodeURIComponent(query)}`, {
    referer: defaultAnimeDubHindiReferer,
    timeoutMs: PAGE_TIMEOUT_MS,
    ...(signal === undefined ? {} : { signal }),
  });
  const seen = new Set();
  const scored = [];
  for (const card of parseSearchCards(ADB_MAIN, html)) {
    if (seen.has(card.slug)) continue;
    seen.add(card.slug);
    scored.push({
      media: { id: `animedubhindi:${card.slug}`, kind: "anime", title: card.title, provider: "animedubhindi", ...(card.coverUrl ? { coverUrl: card.coverUrl } : {}) },
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
    let slug = "";
    try {
      slug = new URL(raw).pathname.split("/").filter(Boolean)[0] ?? "";
    } catch {
      slug = "";
    }
    if (!slug) throw new ApiError(`cannot parse series URL ${raw}`, 0, "BAD_REF");
    return { slug, url: raw.replace(/\/$/, "") };
  }
  const slug = raw.replace(/^animedubhindi:/, "").replace(/^\/+/, "").replace(/\/+$/, "");
  if (!slug) throw new ApiError("series id is empty", 0, "BAD_REF");
  return { slug, url: `${ADB_MAIN}/${slug}/` };
}

/**
 * One fetch of the funnel target is the whole season's guide: every adb post is
 * one season and its adhlinks page lists that season's episodes.
 */
export async function episodes(idOrSlugOrUrl, { signal } = {}) {
  const ref = seriesRef(idOrSlugOrUrl);
  const html = await getText(ref.url, {
    referer: defaultAnimeDubHindiReferer,
    timeoutMs: PAGE_TIMEOUT_MS,
    ...(signal === undefined ? {} : { signal }),
  });
  const funnel = parseFunnelUrl(ADB_MAIN, html);
  if (funnel === null) return [];
  const index = await getText(funnel, {
    referer: defaultAnimeDubHindiReferer,
    timeoutMs: GATE_TIMEOUT_MS,
    ...(signal === undefined ? {} : { signal }),
  });
  return parseAdhlinksEpisodeNumbers(index).map((number) => ({
    id: encodeEpisodeRef({ seriesSlug: ref.slug, number, pageUrl: funnel }),
    mediaId: `animedubhindi:${ref.slug}`,
    seasonNumber: 1,
    number,
    title: `Episode ${number}`,
    url: funnel,
    audioType: "dub",
  }));
}

export async function details(idOrSlugOrUrl, { signal } = {}) {
  const ref = seriesRef(idOrSlugOrUrl);
  const html = await getText(ref.url, {
    referer: defaultAnimeDubHindiReferer,
    timeoutMs: PAGE_TIMEOUT_MS,
    ...(signal === undefined ? {} : { signal }),
  });
  const media = mediaFromPage(ADB_MAIN, ref.slug, html);
  const episodesList = await episodes(idOrSlugOrUrl, { ...(signal === undefined ? {} : { signal }) });
  return { media, episodes: episodesList, provider: "animedubhindi" };
}

/**
 * The fifteen hand-outs of one episode, in site order. Nothing is resolved here
 * — `resolve()` is the hop that costs a round trip, and the caller picks which
 * mirror is worth walking.
 *
 * The audio ask is NOT honoured, and says so: this site publishes no sub group,
 * because every file carries its languages inside the container.
 */
export async function sources(episodeRef, { audioType, signal } = {}) {
  const ref = decodeEpisodeRef(String(episodeRef));
  if (ref === null) throw new ApiError("episode ref is not an animedubhindi ref", 0, "BAD_REF");
  const html = await getText(ref.pageUrl, {
    referer: defaultAnimeDubHindiReferer,
    timeoutMs: GATE_TIMEOUT_MS,
    ...(signal === undefined ? {} : { signal }),
  });
  const mirrors = parseAdhlinksEpisodeMirrors(html, ref.pageUrl, ref.number);
  const available = { sub: 0, dub: mirrors.length };
  if (audioType === "sub") {
    return {
      embeds: [],
      direct: [],
      subtitles: [],
      available,
      audioType: undefined,
      skip: { audioType: "sub", reason: "the site publishes no sub group: each upload is one Multi Audio MKV with both tracks in the container" },
    };
  }
  return {
    embeds: mirrors.map((m) => m.url),
    // Rows carry their quality marker so a caller can pick a rendition without
    // resolving all three terminals (each costs two hops).
    mirrors,
    direct: [],
    subtitles: [],
    available,
    audioType: "dub",
    tier: "RUNTIME_CONFIRMED",
  };
}

/**
 * The one measurement this site makes possible: open the container's header and
 * count its audio tracks. `quality` picks which of the three renditions to read
 * (480/720/1080); the default is the first resolvable mirror at that quality.
 */
export async function audioTruth(episodeRefOrEmbed, { audioType = "dub", quality, signal, headBytes = TRACKS_HEAD_BYTES } = {}) {
  let embed;
  if (/^https?:\/\//i.test(String(episodeRefOrEmbed)) && classifyMirror(String(episodeRefOrEmbed)) !== "other") {
    embed = String(episodeRefOrEmbed);
  } else {
    const ref = decodeEpisodeRef(String(episodeRefOrEmbed));
    if (ref === null) throw new ApiError("audioTruth needs an animedubhindi episode ref or an adhlinks mirror URL", 0, "BAD_REF");
    const html = await getText(ref.pageUrl, {
      referer: defaultAnimeDubHindiReferer,
      timeoutMs: GATE_TIMEOUT_MS,
      ...(signal === undefined ? {} : { signal }),
    });
    const mirrors = parseAdhlinksEpisodeMirrors(html, ref.pageUrl, ref.number)
      .filter((m) => classifyMirror(m.url) === "adhlinks-re");
    const pick = (quality === undefined ? undefined : mirrors.find((m) => m.quality === Number(quality))) ?? mirrors[0];
    if (pick === undefined) throw new ApiError("the episode page lists no resolvable Multi mirror", 200, "EMPTY_STREAM");
    embed = pick.url;
  }
  const { terminal, fileName } = await resolveReTerminal(embed, { ...(signal === undefined ? {} : { signal }) });
  const origin = new URL(terminal).origin;
  const res = await getRange(terminal, `bytes=0-${headBytes - 1}`, {
    referer: `${origin}/`,
    timeoutMs: GATE_TIMEOUT_MS,
    ...(signal === undefined ? {} : { signal }),
  });
  const tracks = readMatroskaHead(res.body);
  const claim = fileNameAudioClaim(fileName ?? terminal);
  const truth = multiAudioVerdict(claim, tracks);
  return {
    ...truth,
    quality: qualityFromName(fileName ?? terminal),
    container: tracks.container,
    doctype: tracks.doctype,
    durationSec: tracks.durationSec,
    declaredBytes: res.total,
    headBytes: res.body.length,
    claim,
    audioTracks: tracks.audio.map((a) => ({ ...a, languageTag: trackLanguage(a), languageName: languageName(trackLanguage(a)) })),
    videoTracks: tracks.video,
    terminal,
  };
}

/** search -> details -> pick episode -> resolve its Multi mirror -> download. */
export async function downloadEpisode(query, episodeNumber, outPath, { signal, onProgress, quality, maxBytes, chunkBytes, audioType = "dub" } = {}) {
  const hits = await search(query, { ...(signal === undefined ? {} : { signal }) });
  if (hits.length === 0) throw new ApiError(`no search hit for "${query}"`, 200, "NO_RESULTS");
  const list = await episodes(hits[0].id, { ...(signal === undefined ? {} : { signal }) });
  const ep = list.find((e) => e.number === Number(episodeNumber)) ?? list[Number(episodeNumber) - 1];
  if (ep === undefined) throw new ApiError(`episode ${episodeNumber} is not in the ${list.length}-episode guide`, 200, "NO_EPISODE");
  const { mirrors } = await sources(ep.id, { audioType, ...(signal === undefined ? {} : { signal }) });
  const walkable = mirrors.filter((m) => classifyMirror(m.url) === "adhlinks-re");
  const ordered = quality === undefined
    ? [...walkable].sort((a, b) => b.quality - a.quality)
    : walkable.filter((m) => m.quality === Number(quality));
  if (ordered.length === 0) throw new ApiError(`no Multi mirror at quality ${quality} for ${ep.title ?? ep.number}`, 200, "EMPTY_STREAM");
  // The renditions are tried best-quality-first and each one is a real walk; a
  // dead token on the 1080p row must not lose the episode when the 720p serves.
  for (const pick of ordered) {
    const { terminal, fileName } = await resolveReTerminal(pick.url, { ...(signal === undefined ? {} : { signal }) });
    const res = await download(terminal, {
      outPath,
      ...(maxBytes === undefined ? {} : { maxBytes }),
      ...(chunkBytes === undefined ? {} : { chunkBytes }),
      ...(signal === undefined ? {} : { signal }),
      ...(onProgress === undefined ? {} : { onProgress }),
    });
    return { ...res, media: hits[0].title, episode: ep.number, quality: pick.quality, fileName, audioClaim: fileNameAudioClaim(fileName ?? terminal) };
  }
  throw new ApiError("no Multi mirror resolved", 0, "EMPTY_STREAM");
}

export const sniffContainer = headContainer;

export const PROVIDER = {
  id: "animedubhindi",
  name: "AnimeDubHindi",
  baseUrl: ADB_MAIN,
  language: "hi",
  mirrorHosts: ["new.adhlinks.com", "filesforever.link", "pro.iqsmartgames.com"],
};
