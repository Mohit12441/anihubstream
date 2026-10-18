// @ts-check
/**
 * AniKoto API — one provider, end to end.
 *
 * This is a standalone, dependency-free port of the AniKoto chain that AniVerse
 * v2 proved against the live site:  search -> watch page -> episode list ->
 * server list -> embed -> playable HLS -> downloaded MPEG-TS file.  It runs on
 * plain Node 18+ with the global `fetch` and `node:crypto` only; nothing here
 * imports from AniVerse.  Every endpoint, header and parsing rule below was
 * recovered by live HTTP measurement, not guessed — see README.md for the
 * evidence and the four download defects this code encodes.
 *
 *   search(term)                 -> [{ id, slug, title, coverUrl, ... }]
 *   details(idOrSlugOrUrl)       -> { media, episodes:[{ id, number, title, audioType }] }
 *   sources(episodeId,{audioType})-> { embeds:[url], audioType, skip? }   only the asked
 *                                  group; an absent group answers with zero embeds
 *   resolve(embedUrl, referer)   -> { master, variants:[{url,quality,headers}], subtitles,
 *                                     headers, audio? }  `audio` is what the embed path claims
 *   dubPairVerdict(sub,dub)      -> { verdict:"copy"|"distinct"|"unknown", ... }  is the
 *                                  site's /dub a byte copy of its /sub?
 *   download(signedPlaylistUrl)  -> writes one real MPEG-TS file, returns { sizeBytes, mimeType }
 *   downloadEpisode(ref, ep, out)-> one-call search->resolve->download convenience
 *
 * The AniKoto chain hands out Megaplay embeds; Megaplay answers with a token-
 * bearing HLS master on a rotating CDN host.  A browser cannot reach that host
 * directly (CORS + Referer gate), so AniVerse signs the upstream through its
 * own same-origin `/api/proxy/stream` — see README "Playback contract".  This
 * module resolves to the real upstream URL + required headers so a caller that
 * controls its own HTTP stack (Node, a native player, or a proxy) can use them.
 */

import { createDecipheriv, createHmac } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { once } from "node:events";
import { makeDubPairVerdict } from "./dubAudio.mjs";

const ANIKOTO_MAIN = process.env.ANIKOTO_ORIGIN ?? "https://anikoto.cz";
const MEGAPLAY_HOSTS = [
  "megaplay.buzz", "megaplay-1.buzz",
  "vidwish.live", "vidwish.to",
  "vidtube.site", "vidtube.me",
  "1anime.site", // thin wrapper whose whole body is one megaplay iframe
];

// --------------------------------------------------------------------- HTTP

/**
 * Minimal fetch wrapper.  Referer and X-Requested-With are the two headers the
 * AniKoto ajax endpoints and the Megaplay CDN actually check (measured); a
 * duplicate Referer makes the nexabloom CDN 403, so it is merged, never added
 * twice.  Returns the Response plus a small helper surface.
 */
async function request(url, { headers, referer, signal, method = "GET" } = {}) {
  const merged = { ...(referer ? { referer } : {}), ...(headers ?? {}) };
  const res = await fetch(url, { method, ...(signal ? { signal } : {}), headers: merged });
  return res;
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

// ---------------------------------------------------------- AniKoto provider

/** Curly quotes / non-ASCII dashes -> ASCII.  AniKoto's backend 500s otherwise. */
export function normalizeUnicodeToAscii(text) {
  return text
    .replace(/[‘’⁌⁍′']/g, "'")
    .replace(/[“”‟‟″"]/g, '"')
    .replace(/[–—―]/g, "-")
    .replace(/[​-‍﻿]/g, "")
    .trim();
}

/** Primary title before the first colon (fallback when the site 500s on a colon query). */
export function extractPrimaryTitle(term) {
  const i = term.indexOf(":");
  return i > 0 ? term.slice(0, i).trim() : term;
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

function findItemChunks(html) {
  const tagRe = /<div\b[^>]*class="([^"]*)"[^>]*>/gi;
  const starts = [];
  for (const m of html.matchAll(tagRe)) {
    const classes = (m[1] ?? "").split(/\s+/);
    if (classes.includes("flw-item") || classes.includes("item")) starts.push(m.index ?? 0);
  }
  const chunks = [];
  for (const [i, start] of starts.entries()) {
    const chunk = html.slice(start, starts[i + 1] ?? html.length);
    if (/\/watch\/[^"/?#]/i.test(chunk) || /data-id="[^"]*"/i.test(chunk)) chunks.push(chunk);
  }
  return chunks;
}

// Minimal title matching, enough to order search hits.  AniVerse's full
// identity resolver (ambiguity floor, published-name twins) lives server-side;
// here it only ranks, never decides.
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

/** search -> ranked [{ media }]. java.net.URLEncoder parity: space -> '+'. */
async function executeSearch(term, signal) {
  const url = `${ANIKOTO_MAIN}/filter?keyword=${encodeURIComponent(term).replace(/%20/g, "+")}`;
  const { body } = await getText(url, { referer: `${ANIKOTO_MAIN}/`, signal });
  const seen = new Set();
  const scored = [];
  for (const chunk of findItemChunks(body)) {
    const slug = chunk.match(/href="[^"]*\/watch\/([^"/?#]+)/i)?.[1] ?? "";
    const numericId = attr(chunk, /data-tip="(\d+)"/i) ?? attr(chunk, /data-id="([^"]*)"/i) ?? "";
    const id = slug || numericId;
    if (!id) continue;
    const mediaId = `anikoto:${id}`;
    if (seen.has(mediaId)) continue;
    seen.add(mediaId);
    const title =
      clean(chunk.match(/<a\b[^>]*class="[^"]*\bname\b[^"]*"[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? "") ??
      clean(chunk.match(/class="[^"]*\bname\b[^"]*"[^>]*>([\s\S]*?)<\/[^>]*>/i)?.[1] ?? "") ??
      clean(chunk.match(/title="([^"]*)"/i)?.[1] ?? "") ??
      `AniKoto ${id}`;
    const cover = chunk.match(/<img[^>]+src="([^"]*)"/i)?.[1];
    const original = attr(chunk, /data-jp="([^"]*)"/i);
    const media = {
      id: mediaId, slug: id, kind: "anime", title,
      ...(cover ? { coverUrl: fixUrl(ANIKOTO_MAIN, cover) } : {}),
      ...(original && original !== title ? { originalTitle: original } : {}),
    };
    scored.push({ media, score: similarity(term, media.title) });
  }
  // score desc, then shortest title (base series beats spin-off), then id.
  return scored.sort((a, b) =>
    (b.score - a.score) ||
    (normalizeTitle(a.media.title).length - normalizeTitle(b.media.title).length) ||
    a.media.id.localeCompare(b.media.id),
  ).map((s) => s.media);
}

export async function search(term, { signal } = {}) {
  const raw = term.trim();
  if (!raw) return [];
  const normalized = normalizeUnicodeToAscii(raw);
  try {
    return await executeSearch(normalized, signal);
  } catch (error) {
    if (error instanceof ApiError && error.status === 500 && normalized.includes(":")) {
      const fb = extractPrimaryTitle(normalized);
      if (fb && fb.length >= 2 && fb !== normalized) {
        try { return await executeSearch(fb, signal); } catch { /* fall through */ }
      }
    }
    throw error instanceof ApiError ? error : new ApiError(`AniKoto search failed: ${error?.message ?? error}`, 0);
  }
}

function jsonHtml(body) {
  const t = body.trim();
  if (!t.startsWith("{")) return t;
  try {
    const p = JSON.parse(t);
    if (typeof p.html === "string") return p.html;
    if (typeof p.result === "string") return p.result;
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
  const bare = raw.replace(/^anikoto:/, "").replace(/^\/+/, "");
  if (/^\d+$/.test(bare)) throw new ApiError(`AniKoto cannot open a watch page from the numeric id ${bare}; needs /watch/<slug>`, 0);
  if (bare.startsWith("watch/")) return `${ANIKOTO_MAIN}/${bare}`;
  return `${ANIKOTO_MAIN}/watch/${bare}`;
}

function encodeEpisodeRef({ watchId, serverIds, audioType, watchUrl, malId, epSlug, timestamp }) {
  return ["anikoto", watchId, serverIds, audioType, watchUrl || "", malId || "", epSlug || "", timestamp || ""].join("|");
}

function decodeEpisodeRef(id) {
  if (!id.startsWith("anikoto|")) return null;
  const parts = id.split("|");
  if (parts.length < 4) return null;
  const watchUrl = parts[4]?.trim() || undefined;
  const malId = parts[5]?.trim() || undefined;
  const epSlug = parts[6]?.trim() || undefined;
  const timestamp = parts[7]?.trim() || undefined;
  return {
    watchId: parts[1] ?? "",
    serverIds: (parts[2] ?? "").trim(),
    audioType: (parts[3] ?? "sub").trim() || "sub",
    ...(watchUrl ? { watchUrl } : {}),
    ...(malId ? { malId } : {}),
    ...(epSlug ? { epSlug } : {}),
    ...(timestamp ? { timestamp } : {}),
  };
}

const ajaxHeaders = { "x-requested-with": "XMLHttpRequest", accept: "application/json, text/javascript, */*;" };

async function getAjax(url, referer, signal) {
  const { body } = await getText(url, { headers: ajaxHeaders, referer, signal });
  return body;
}

async function fetchMapperData(malId, epSlug, timestamp, signal) {
  if (!malId) return null;
  const slug = epSlug || "1";
  const ts = timestamp || "0";
  try {
    const res = await fetch(`https://mapper.nekostream.site/api/mal/${encodeURIComponent(malId)}/${encodeURIComponent(slug)}/${encodeURIComponent(ts)}`, {
      headers: {
        referer: `${ANIKOTO_MAIN}/`,
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
      },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(4000)]) : AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function episodesFor(watchId, mediaId, watchUrl, signal) {
  const body = await getAjax(`${ANIKOTO_MAIN}/ajax/episode/list/${watchId}?vrf=`, watchUrl, signal);
  const html = jsonHtml(body);
  if (!html) return { episodes: [] };
  const episodes = [];
  let malId;
  for (const m of html.matchAll(/<a\b[^>]*data-ids="[^"]*"[^>]*>[\s\S]*?<\/a>/gi)) {
    const tag = m[0];
    const serverIds = attr(tag, /data-ids="([^"]*)"/i)?.trim() ?? "";
    if (!serverIds) continue;
    const numRaw = attr(tag, /data-num="([^"]*)"/i)?.trim() ?? "";
    const number = /^\d+$/.test(numRaw) ? Number(numRaw) : episodes.length + 1;
    const isSub = attr(tag, /data-sub="([^"]*)"/i) === "1";
    const isDub = attr(tag, /data-dub="([^"]*)"/i) === "1";
    const audioType = isDub && isSub ? "both" : isDub ? "dub" : "sub";
    const title = clean(tag.match(/class="[^"]*d-title[^"]*"[^>]*>([\s\S]*?)<\/[^>]*>/i)?.[1] ?? "") ||
      attr(tag, /data-jp="([^"]*)"/i)?.trim() || `Episode ${number}`;
    const mal = attr(tag, /data-mal="(\d+)"/i);
    const epSlug = attr(tag, /data-slug="([^"]*)"/i)?.trim() || String(number);
    const timestamp = attr(tag, /data-timestamp="([^"]*)"/i)?.trim();
    if (mal && !malId) malId = mal;
    episodes.push({
      id: encodeEpisodeRef({ watchId, serverIds, audioType: audioType === "dub" ? "dub" : "sub", watchUrl, malId: mal, epSlug, timestamp }),
      mediaId, seasonNumber: 1, number, title, url: watchUrl, audioType,
      ...(mal ? { malId: mal } : {}),
      ...(epSlug ? { epSlug } : {}),
      ...(timestamp ? { timestamp } : {}),
    });
  }
  return { episodes, malId };
}

export async function details(idOrSlugOrUrl, { signal } = {}) {
  const url = watchUrlFor(idOrSlugOrUrl);
  const { body: html } = await getText(url, { referer: `${ANIKOTO_MAIN}/`, signal });
  const watchId = attr(html, /<[^>]+\bid="watch-main"[^>]+\bdata-id="([^"]*)"/i) ?? "";
  if (!watchId) throw new ApiError("AniKoto watch page exposed no data-id", 0);
  const canonical = attr(html, /\bdata-url="([^"]*)"/i) ?? url;
  const slug = mediaSlugOf(canonical) ?? mediaSlugOf(url);
  const mediaId = `anikoto:${slug ?? watchId}`;
  const { episodes, malId } = await episodesFor(watchId, mediaId, canonical, signal);
  const media = {
    id: mediaId, kind: "anime",
    title: clean(attr(html, /<[^>]+class="[^"]*heading-name[^"]*"[^>]*>([\s\S]*?)<\/[^>]*>/i)) ??
      clean(attr(html, /<[^>]+\bdata-jp="([^"]*)"/i)) ??
      clean(attr(html, /<title>([\s\S]*?)<\/title>/i))?.replace(/\s*[-–|].*$/, "") ??
      `AniKoto ${watchId}`,
    originalTitle: attr(html, /<[^>]+class="[^"]*name-original[^"]*"[^>]*>([\s\S]*?)<\/[^>]*>/i) ?? attr(html, /<[^>]+\bdata-jp="([^"]*)"/i) ?? undefined,
    coverUrl: fixUrl(ANIKOTO_MAIN, attr(html, /<meta property="og:image" content="([^"]*)"/i)),
    year: Number(attr(html, /<[^>]+itemprop="contentYear"[^>]*content="(\d{4})"/i)) || undefined,
    genres: [...new Set([...html.matchAll(/<a[^>]+href="[^"]*genres[^"]*"[^>]*>([^<]+)<\/a>/gi)].map((m) => clean(m[1] ?? "")).filter(Boolean))],
    ...(malId ? { malId } : {}),
  };
  return { media, episodes };
}

export async function episodes(idOrSlugOrUrl, { signal } = {}) {
  return (await details(idOrSlugOrUrl, { signal })).episodes;
}

function parseServerLinks(html) {
  const out = [];
  const scopeRe = /data-type="([^"]*)"/gi;
  for (const m of html.matchAll(/<li\b[^>]*data-link-id="([^"]*)"[^>]*>([\s\S]*?)<\/li>/gi)) {
    const linkId = m[1]?.trim() ?? "";
    if (!linkId) continue;
    let type = "";
    for (const scope of html.slice(0, m.index).matchAll(scopeRe)) type = (scope[1] ?? "").trim().toLowerCase();
    out.push({ linkId, type, name: clean((m[2] ?? "").match(/class="name"[^>]*>([\s\S]*?)<\/[^>]*>/i)?.[1] ?? m[2] ?? "") ?? "" });
  }
  return out;
}

/** episode id (opaque ref) -> embed URLs + skip marks, scoped to the audio asked for. */
export async function sources(episodeId, { audioType, signal } = {}) {
  const ref = decodeEpisodeRef(episodeId);
  if (!ref?.serverIds) throw new ApiError("AniKoto episode id carries no server set", 0);
  const referer = ref.watchUrl ?? `${ANIKOTO_MAIN}/`;
  if (!/^[A-Za-z0-9+/=_-]{1,1024}$/.test(ref.serverIds)) throw new ApiError("AniKoto server set is not a valid opaque token", 0);
  const serverHtml = jsonHtml(await getAjax(`${ANIKOTO_MAIN}/ajax/server/list?servers=${encodeURIComponent(ref.serverIds)}`, referer, signal));
  if (!serverHtml) return { embeds: [], subtitles: [], skip: undefined, downloads: [], servers: [] };
  const entries = parseServerLinks(serverHtml);
  // The caller's ask wins; the ref's label (encoded from the listing row) is the
  // default for callers who did not ask.  Hardsubs ("hsub") count as sub.
  const requested = audioType === "dub" || audioType === "sub" ? audioType : ref.audioType;
  const wanted = requested === "dub" ? ["dub"] : ["sub", "hsub"];
  const typed = entries.filter((e) => e.type !== "");
  const scoped = typed.filter((e) => wanted.includes(e.type));
  const usable = typed.length === 0 ? entries : scoped;
  const embeds = [];
  const seenLink = new Set();
  const published = new Set();
  let skip;
  for (const entry of usable) {
    if (!entry.linkId || seenLink.has(entry.linkId)) continue;
    seenLink.add(entry.linkId);
    try {
      const linkBody = await getAjax(`${ANIKOTO_MAIN}/ajax/server?get=${encodeURIComponent(entry.linkId)}`, referer, signal);
      const embedUrl = jsonResultUrl(linkBody);
      if (!embedUrl?.trim()) continue;
      const resolved = fixUrl(ANIKOTO_MAIN, embedUrl);
      if (published.has(resolved)) continue;
      published.add(resolved);
      embeds.push(resolved);
      skip ??= jsonResultSkip(linkBody);
    } catch (e) {
      if (e?.name === "AbortError") break;
    }
  }

  // Mapper downloads & servers discovery:
  const downloads = [];
  const mappedServers = [];
  if (ref.malId) {
    const mapData = await fetchMapperData(ref.malId, ref.epSlug, ref.timestamp, signal);
    if (mapData && typeof mapData === "object") {
      for (const [providerName, provData] of Object.entries(mapData)) {
        const langOrder = requested === "dub" ? ["dub", "sub"] : ["sub", "dub"];
        for (const lang of langOrder) {
          const langData = provData[lang];
          if (!langData) continue;
          if (langData.download && typeof langData.download === "object") {
            for (const [quality, dlUrl] of Object.entries(langData.download)) {
              if (dlUrl && typeof dlUrl === "string") {
                downloads.push({
                  name: `${providerName} (${lang.toUpperCase()}) ${quality}`,
                  quality,
                  url: dlUrl,
                  provider: providerName.toLowerCase(),
                  audio: lang,
                });
              }
            }
          }
          if (langData.url && typeof langData.url === "string") {
            mappedServers.push({
              name: `${providerName} (${lang.toUpperCase()})`,
              linkId: langData.url,
              type: lang,
            });
          }
        }
      }
    }
  }

  return {
    embeds,
    subtitles: [],
    audioType: requested,
    ...(skip ? { skip } : {}),
    downloads,
    servers: [...usable, ...mappedServers],
  };
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
 * Which audio the embed serves, read off its own path.  This chain hands out two
 * shapes: `…/stream/s-2/<id>/{sub,dub}`, which names the audio, and
 * `/embed/html/<id>`, which names nothing — so this returns `undefined` there and
 * the caller must not invent an audio.  A site claim, not a fact about the bytes:
 * `dubPairVerdict` measures the bytes.
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
    provider: "anikoto", extractor: "megaplay",
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
 * Measured 2026-10-12 on the same episode: AniKoto lists three embeds, and the
 * FIRST one (`…/sub?s=tcdn`) resolves through MegaPlay to `megap.shiora.top`,
 * whose "segments" are PNG files — 626,292 bytes starting `89 50 4E 47`, a
 * decoy CDN that passes every size check while containing no video.  The plain
 * embed (`…/sub`, no selector) resolves to `fetch.nexabloom.top` and answers
 * 626,040 bytes starting `47` with 0x47 on every 188-byte stride: real MPEG-TS.
 * So the container must be sniffed before a download is believed, and the
 * caller must be able to fall through to the next embed.
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
 * Download an HLS hand-out into ONE real MPEG-TS (or MP4) file.
 *
 * This is defect #4 fixed: piping the playlist to disk saved 43,839 bytes of
 * TEXT and called it the video.  A download must read the playlist the way a
 * player does — pick the best rendition, then concatenate its segments (init
 * first for fMP4, honouring #EXT-X-BYTERANGE), refuse a keyed stream rather
 * than write ciphertext that passes every size check, and sniff the first
 * segment's container so a decoy CDN's PNGs are reported, not "completed".
 */
export async function download(signedPlaylistUrl, {
  headers, referer, outPath, signal, onProgress, maxSegments,
} = {}) {
  const reqHeaders = { ...(referer ? { referer } : {}), ...(headers ?? {}) };
  const first = await request(signedPlaylistUrl, { headers: reqHeaders, signal });
  if (!first.ok) { await drain(first); throw new ApiError(`playlist ${first.status}`, first.status); }
  const ct = first.headers.get("content-type") ?? "";
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
      // Segment 1 is buffered whole so its container can be proven before the
      // rest of the episode is transferred.  A decoy CDN's PNGs are otherwise
      // indistinguishable from a real download until playback fails.
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
    // Node reports a bad path (missing dir) on `open`, one tick late.  Awaiting
    // it is what turns ENOENT into an honest error instead of counted bytes with
    // no file — defect #3, which the reference downloader had exactly here.
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

/** search -> details -> sources -> resolve the first embed -> download it. */
export async function downloadEpisode(query, episodeNumber, outPath, { signal, onProgress, audioType = "sub", maxSegments } = {}) {
  const results = await search(query, { signal });
  const hit = results[0];
  if (!hit) throw new ApiError(`search for "${query}" returned nothing on AniKoto`, 0);
  const { media, episodes } = await details(hit.id, { signal });
  const ep = episodes.find((e) => e.number === Number(episodeNumber)) ?? episodes[Number(episodeNumber) - 1];
  if (!ep) throw new ApiError(`episode ${episodeNumber} not listed for ${media.title}`, 0);
  const { embeds } = await sources(ep.id, { ...(audioType ? { audioType } : {}), signal });
  if (!embeds.length) throw new ApiError(`no ${audioType ?? "sub"} embeds for ${media.title} ep ${episodeNumber}`, 0);
  // Try each embed until one downloads a real media container.  The first
  // listed embed can be the decoy CDN (see sniffContainer), so "playable" is
  // proven by the written bytes, not by the embed URL resolving.
  let lastError = null;
  for (const embed of embeds) {
    try {
      const resolved = await resolve(embed, { referer: `${ANIKOTO_MAIN}/`, signal });
      const pick = resolved.variants[0];
      const result = await download(pick.url, { referer: pick.headers?.referer, outPath, signal, onProgress, maxSegments });
      return { media: media.title, episode: ep.number, embed, cdn: new URL(pick.url).host, ...result };
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

export const PROVIDER = { id: "anikoto", name: "AniKoto", baseUrl: ANIKOTO_MAIN, language: "en" };
export const defaultAniKotoReferer = `${ANIKOTO_MAIN}/`;

/**
 * Is THIS site's `/dub` file its own bytes or a copy of its `/sub`?  Measures the
 * first media segment of both (see `dubAudio.mjs` for the 14-pair census behind the
 * rule); `audio`/`audioType` above is only the site's claim.
 */
export const dubPairVerdict = makeDubPairVerdict(resolve, defaultAniKotoReferer);
