// @ts-check
/**
 * Stream Bridge & Multi-Provider Dispatcher — exposes all supported anime
 * providers to the site with a same-origin playback proxy and real-time
 * latency racing. Binds loopback (127.0.0.1) and is reached by visitors
 * through the Cloudflare tunnel (bridge.<domain> -> this port).
 *
 * Supported providers:
 *   - AniWatch (Fastest Megaplay HLS)
 *   - HiAnime (High-speed JSON API, multi-quality 1080p/360p)
 *   - AniKoto (Rich HLS, intro/outro skip times, 9 subtitle tracks)
 *   - AnimeDubHindi (Progressive Multi-Audio MKV with Hindi dub)
 *   - WatchAnimeWorld (Direct encrypted MP4 stream with Abyss part stitching)
 *   - AnimeWave (Failover mirror)
 *   - AnimeKai (Failover mirror)
 *
 * When provider=auto or provider=fastest, candidate providers race in parallel;
 * the fastest provider that yields a verified playable stream wins the race.
 *
 *   GET /health
 *   GET /search?q=<term>&provider=<name>
 *   GET /resolve?title=<t>&ep=<n>&audio=<sub|dub|hindi>&provider=<auto|aniwatch|hianime|anikoto|animedubhindi|watchanimeworld>
 *   GET /audios?title=<t>&ep=<n>
 *   GET /stream/:sid/master.m3u8
 *   GET /stream/:sid/media.mkv
 *   GET /stream/:sid/media.mp4
 *   GET /stream/:sid/play?u=<b64url>&name=...
 *   GET /stream/:sid/sub/:idx.vtt
 */

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import * as anikoto from './anikoto.mjs';
import * as animedubhindi from './animedubhindi.mjs';
import * as hianime from './hianime.mjs';
import * as aniwatch from './aniwatch.mjs';
import * as animewave from './animewave.mjs';
import * as animekai from './animekai.mjs';
import * as watchanimeworld from './watchanimeworld.mjs';
import {
  sniffContainer,
  buildMegaPlayToken,
  dubPairVerdict,
} from './anikoto.mjs';

const PORT = Number(process.env.ANIKOTO_BRIDGE_PORT ?? 8795);
const HOST = '127.0.0.1';
const UA_REFERER = 'https://anikototv.to/';
const RESOLVE_TIMEOUT_MS = 75_000;
const SNACK_BYTES = 131_072;
const DETAILS_TTL = 12 * 60 * 60 * 1000;
const SESSION_TTL = Number(process.env.ANIKOTO_SESSION_TTL_MS ?? 3 * 60 * 60 * 1000);
const SESSION_CAP = Number(process.env.ANIKOTO_SESSION_CAP ?? 128);
const RECENT_TTL = 6 * 60 * 60 * 1000;
const AUDIO_TTL = 60 * 60 * 1000;

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = { '/resolve': 120, '/audios': 120, '/search': 120 };

const ALLOWED_ORIGIN_HOSTS = new Set([
  'anihubstream.com',
  'app.anihubstream.com',
  'bridge.anihubstream.com',
  'localhost',
  '127.0.0.1',
]);
const ALLOWED_ORIGIN_SUFFIXES = ['.anihubstream.pages.dev'];
const ALLOWED_HOSTS_CAP = 16;

/* ------------------------------------------------------------------ state */

/** @type {Map<string, { at: number, media: any, episodes: any[] }>} */
const providerDetailsCache = new Map();
/** @type {Map<string, any>} */
const sessions = new Map();
/** @type {Map<string, { at: number, sid: string }>} */
const recent = new Map();
/** @type {Map<string, { at: number, meta: any }>} */
const audioCache = new Map();
/** @type {Map<string, { at: number, n: number }>} */
const rateHits = new Map();

const b64url = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

function prune() {
  const now = Date.now();
  for (const [k, v] of sessions) if (now - v.at > SESSION_TTL) sessions.delete(k);
  for (const [k, v] of providerDetailsCache) if (now - v.at > DETAILS_TTL) providerDetailsCache.delete(k);
  for (const [k, v] of recent) if (now - v.at > RECENT_TTL) recent.delete(k);
  for (const [k, v] of audioCache) if (now - v.at > AUDIO_TTL) audioCache.delete(k);
  for (const [k, v] of rateHits) if (now - v.at > RATE_WINDOW_MS) rateHits.delete(k);
  if (sessions.size > SESSION_CAP) {
    const lru = [...sessions.entries()].sort((a, b) => a[1].at - b[1].at);
    for (const [k] of lru.slice(0, sessions.size - SESSION_CAP)) sessions.delete(k);
  }
}

/* ------------------------------------------------------------------- http */

function cors(res, type) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET, OPTIONS');
  res.setHeader('access-control-allow-headers', '*');
  res.setHeader('access-control-allow-private-network', 'true');
  res.setHeader('access-control-expose-headers', 'content-length, content-range, accept-ranges');
  if (type) res.setHeader('content-type', type);
}

const json = (res, status, body) => {
  cors(res, 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.statusCode = status;
  res.end(JSON.stringify(body));
};

const refusalStatus = (upstream) => (upstream >= 400 && upstream < 500 ? upstream : 422);

const clientIp = (req) => {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf.trim()) return cf.trim();
  return req.socket.remoteAddress ?? 'unknown';
};

const fromLoopback = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '');
const operatorLocal = (req) => fromLoopback(req) && !req.headers['cf-connecting-ip'];

function blockedOrigin(req) {
  const raw = req.headers.origin;
  if (typeof raw !== 'string' || !raw || raw === 'null') return null;
  let host;
  try {
    host = new URL(raw).hostname;
  } catch {
    return raw;
  }
  if (ALLOWED_ORIGIN_HOSTS.has(host) || ALLOWED_ORIGIN_SUFFIXES.some((s) => host.endsWith(s))) return null;
  if (operatorLocal(req)) return null;
  return host;
}

function rateTake(path, ip) {
  const max = RATE_MAX[path];
  if (!max) return null;
  const key = `${path}|${ip}`;
  const now = Date.now();
  const hit = rateHits.get(key);
  if (!hit || now - hit.at > RATE_WINDOW_MS) {
    rateHits.set(key, { at: now, n: 1 });
    return null;
  }
  hit.n += 1;
  if (hit.n <= max) return null;
  return Math.max(1, Math.ceil((RATE_WINDOW_MS - (now - hit.at)) / 1000));
}

/* -------------------------------------------------------------- details & helpers */

function rankEmbeds(embeds) {
  const decoy = (u) => /[?&]s=tcdn(?:&|$)/i.test(u);
  return [...embeds].sort((a, b) => Number(decoy(a)) - Number(decoy(b)));
}

function firstSegmentOf(playlistText, baseUrl) {
  for (const raw of playlistText.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    try {
      return new URL(line, baseUrl).toString();
    } catch {
      return undefined;
    }
  }
  return undefined;
}

async function snackPlayable(source, signal) {
  for (const variant of source.variants ?? []) {
    const headers = variant.headers ?? source.master?.headers ?? {};
    try {
      const plRes = await fetch(variant.url, { headers, signal });
      if (!plRes.ok) { await plRes.body?.cancel().catch(() => {}); continue; }
      const text = await plRes.text();
      const seg = firstSegmentOf(text, variant.url);
      if (!seg) continue;
      const segRes = await fetch(seg, { headers: { ...headers, range: `bytes=0-${SNACK_BYTES - 1}` }, signal });
      if (!segRes.ok && segRes.status !== 206) { await segRes.body?.cancel().catch(() => {}); continue; }
      const buf = Buffer.from(await segRes.arrayBuffer());
      const kind = sniffContainer(buf);
      if (kind === 'mpegts' || kind === 'mp4') {
        return { variant, proof: { container: kind, checkedBytes: buf.length } };
      }
    } catch {
      // try next variant
    }
  }
  return undefined;
}

async function detailsForProvider(provider, title) {
  const norm = provider.toLowerCase();
  const key = `${norm}:${title.trim().toLowerCase()}`;
  const hit = providerDetailsCache.get(key);
  if (hit && Date.now() - hit.at < DETAILS_TTL) return hit;

  const signal = AbortSignal.timeout(30_000);
  let mod;
  if (norm === 'anikoto') mod = anikoto;
  else if (norm === 'animedubhindi') mod = animedubhindi;
  else if (norm === 'hianime') mod = hianime;
  else if (norm === 'aniwatch') mod = aniwatch;
  else if (norm === 'animewave') mod = animewave;
  else if (norm === 'animekai') mod = animekai;
  else if (norm === 'watchanimeworld') mod = watchanimeworld;
  else throw new Error(`Unknown provider: ${norm}`);

  const hits = await mod.search(title, { signal });
  if (!hits || !hits.length) throw Object.assign(new Error(`no ${provider} result for "${title}"`), { code: 'NO_MATCH' });
  const picked = hits[0];
  const slug = (picked.id || picked.slug).replace(/^watchanimeworld:/, '');
  const { media, episodes } = await mod.details(slug, { signal });
  const entry = { at: Date.now(), media, episodes };
  providerDetailsCache.set(key, entry);
  return entry;
}

const detailsForAnikoto = (title) => detailsForProvider('anikoto', title);
const detailsForAdb = (title) => detailsForProvider('animedubhindi', title);

function createHlsSession({ provider, media, episode, resolvedResult, sniffed, defaultReferer, skip, audio }) {
  const mediaUrl = typeof resolvedResult.master === 'object' ? resolvedResult.master.url : resolvedResult.master;
  const mediaBase = new URL(mediaUrl);
  const dir = mediaBase.pathname.replace(/\/[^/]*\.m3u8$/i, '');
  const sid = randomUUID();
  const referer = resolvedResult.master?.headers?.referer ?? defaultReferer;

  const session = {
    sid,
    at: Date.now(),
    provider,
    kind: 'hls',
    title: media.title,
    episode: { number: episode.number, title: episode.title },
    audio: resolvedResult.audio ?? audio,
    skip: skip ?? undefined,
    quality: sniffed.variant.quality,
    variants: [...new Set((resolvedResult.variants ?? []).map((v) => v.quality))],
    proof: sniffed.proof,
    referer,
    signed: { host: mediaBase.host, dir },
    mediaUrl,
    episodeRef: episode.id || episode.ref,
    allowedHosts: new Set([mediaBase.host]),
    downloadPage: resolvedResult.downloadPage ?? null,
    subUrls: (resolvedResult.subtitles ?? []).map((t) => ({ url: t.url, referer: t.headers?.referer ?? referer })),
    subtitles: (resolvedResult.subtitles ?? []).map((t, i) => ({
      language: t.language,
      ...(t.name ? { name: t.name } : {}),
      url: `/stream/${sid}/sub/${i}.vtt`,
    })),
  };
  sessions.set(sid, session);

  return {
    session: sid,
    provider,
    kind: 'hls',
    title: media.title,
    episode: session.episode,
    quality: session.quality,
    variants: session.variants,
    audio: session.audio,
    skip: session.skip ?? null,
    proof: session.proof,
    master: `/stream/${sid}/master.m3u8`,
    downloadPage: session.downloadPage,
    downloadUrl: session.downloadPage ?? `/stream/${sid}/master.m3u8`,
    subtitles: session.subtitles,
  };
}

/* ------------------------------------------------------------- provider resolvers */

async function buildSourceAnikoto({ title, ep, audio }) {
  const signal = AbortSignal.timeout(RESOLVE_TIMEOUT_MS);
  const { media, episodes } = await detailsForProvider('anikoto', title);
  const episode = episodes.find((e) => e.number === ep) ?? episodes[ep - 1];
  if (!episode) throw Object.assign(new Error(`episode ${ep} is not in AniKoto list (${episodes.length} listed)`), { code: 'NO_SUCH_EPISODE' });

  const { embeds, skip } = await anikoto.sources(episode.id, { audioType: audio, signal });
  if (!embeds.length) throw Object.assign(new Error(`no ${audio} embeds for episode ${ep}`), { code: 'NO_EMBEDS' });

  const candidates = rankEmbeds(embeds).slice(0, 3);
  for (const embed of candidates) {
    try {
      const r = await anikoto.resolve(embed, { referer: UA_REFERER, signal });
      const sniffed = await snackPlayable(r, signal);
      if (sniffed) {
        return createHlsSession({
          provider: 'anikoto', media, episode, resolvedResult: r, sniffed, defaultReferer: UA_REFERER, skip, audio,
        });
      }
    } catch {
      // try next embed
    }
  }
  throw Object.assign(new Error(`no playable AniKoto variant`), { code: 'RESOLVE_FAILED' });
}

async function buildSourceAniwatch({ title, ep, audio }) {
  const signal = AbortSignal.timeout(RESOLVE_TIMEOUT_MS);
  const { media, episodes } = await detailsForProvider('aniwatch', title);
  const episode = episodes.find((e) => e.number === ep) ?? episodes[ep - 1];
  if (!episode) throw Object.assign(new Error(`episode ${ep} is not in AniWatch list (${episodes.length} listed)`), { code: 'NO_SUCH_EPISODE' });

  const audioType = audio === 'dub' ? 'dub' : 'sub';
  const { embeds } = await aniwatch.sources(episode.id || episode.ref, { audioType, signal });
  if (!embeds || !embeds.length) throw Object.assign(new Error(`no ${audio} embeds for episode ${ep}`), { code: 'NO_EMBEDS' });

  const candidates = rankEmbeds(embeds).slice(0, 3);
  for (const embed of candidates) {
    try {
      const r = await aniwatch.resolve(embed, { referer: 'https://aniwatch.co.at/', signal });
      const sniffed = await snackPlayable(r, signal);
      if (sniffed) {
        return createHlsSession({
          provider: 'aniwatch', media, episode, resolvedResult: r, sniffed, defaultReferer: 'https://megaplay.buzz/', skip: null, audio,
        });
      }
    } catch {
      // try next embed
    }
  }
  throw Object.assign(new Error(`no playable AniWatch variant`), { code: 'RESOLVE_FAILED' });
}

async function buildSourceHianime({ title, ep, audio }) {
  const signal = AbortSignal.timeout(RESOLVE_TIMEOUT_MS);
  const { media, episodes } = await detailsForProvider('hianime', title);
  const episode = episodes.find((e) => e.number === ep) ?? episodes[ep - 1];
  if (!episode) throw Object.assign(new Error(`episode ${ep} is not in HiAnime list (${episodes.length} listed)`), { code: 'NO_SUCH_EPISODE' });

  const audioType = audio === 'dub' ? 'dub' : 'sub';
  const { embeds } = await hianime.sources(episode.id, { audioType, signal });
  if (!embeds || !embeds.length) throw Object.assign(new Error(`no ${audio} embeds for episode ${ep}`), { code: 'NO_EMBEDS' });

  const candidates = rankEmbeds(embeds).slice(0, 3);
  for (const embed of candidates) {
    try {
      const r = await hianime.resolve(embed, { signal });
      const sniffed = await snackPlayable(r, signal);
      if (sniffed) {
        return createHlsSession({
          provider: 'hianime', media, episode, resolvedResult: r, sniffed, defaultReferer: 'https://zokoanime.video/', skip: r.skip ?? null, audio,
        });
      }
    } catch {
      // try next embed
    }
  }
  throw Object.assign(new Error(`no playable HiAnime variant`), { code: 'RESOLVE_FAILED' });
}

async function buildSourceAdb({ title, ep, audio }) {
  const signal = AbortSignal.timeout(RESOLVE_TIMEOUT_MS);
  const { media, episodes } = await detailsForProvider('animedubhindi', title);
  const episode = episodes.find((e) => e.number === ep) ?? episodes[ep - 1];
  if (!episode) {
    throw Object.assign(new Error(`episode ${ep} is not in AnimeDubHindi list (${episodes.length} listed)`), { code: 'NO_SUCH_EPISODE' });
  }

  const { embeds } = await animedubhindi.sources(episode.id, { audioType: 'dub', signal });
  if (!embeds || !embeds.length) {
    throw Object.assign(new Error(`no embeds for episode ${ep}`), { code: 'NO_EMBEDS' });
  }

  const reMirrors = embeds.filter((u) => animedubhindi.classifyMirror(u) === 'adhlinks-re');
  const candidates = reMirrors.length ? reMirrors : embeds;

  let lastError = null;
  for (const embed of candidates) {
    try {
      const r = await animedubhindi.resolve(embed, { referer: animedubhindi.defaultAnimeDubHindiReferer, signal });
      if (!r || !r.terminal) continue;

      const terminalUrl = r.terminal;
      const terminalBase = new URL(terminalUrl);
      const sid = randomUUID();
      const session = {
        sid,
        at: Date.now(),
        provider: 'animedubhindi',
        kind: 'progressive',
        container: r.master?.container ?? 'matroska',
        title: media.title,
        episode: { number: episode.number, title: episode.title },
        audio: 'dub',
        quality: r.variants?.[0]?.quality ?? 'auto',
        variants: [...new Set((r.variants ?? []).map((v) => v.quality))],
        proof: { container: r.master?.container ?? 'matroska', checkedBytes: r.master?.totalBytes ?? 0 },
        referer: r.master?.headers?.referer ?? `${terminalBase.origin}/`,
        signed: { host: terminalBase.host, dir: '' },
        mediaUrl: terminalUrl,
        episodeRef: episode.id,
        allowedHosts: new Set([terminalBase.host]),
        subUrls: [],
        subtitles: [],
      };
      sessions.set(sid, session);
      const meta = {
        session: sid,
        provider: 'animedubhindi',
        kind: 'progressive',
        container: session.container,
        title: media.title,
        episode: session.episode,
        quality: session.quality,
        variants: session.variants,
        audio: session.audio,
        skip: null,
        proof: session.proof,
        master: `/stream/${sid}/media.mkv`,
        downloadUrl: `/stream/${sid}/media.mkv?download=1`,
        downloadPage: null,
        subtitles: [],
      };
      recent.set(`${title.toLowerCase()}|${ep}|${audio}|animedubhindi`, { at: Date.now(), sid });
      return meta;
    } catch (e) {
      lastError = e;
    }
  }

  throw Object.assign(new Error(`no playable AnimeDubHindi source (${lastError?.message ?? 'mirror resolution failed'})`), { code: 'RESOLVE_FAILED' });
}

async function buildSourceWatchanimeworld({ title, ep, audio }) {
  const signal = AbortSignal.timeout(RESOLVE_TIMEOUT_MS);
  const { media, episodes } = await detailsForProvider('watchanimeworld', title);
  const episode = episodes.find((e) => e.number === ep) ?? episodes[ep - 1];
  if (!episode) throw Object.assign(new Error(`episode ${ep} is not in WatchAnimeWorld list`), { code: 'NO_SUCH_EPISODE' });

  const src = await watchanimeworld.sources(episode.id, { audioType: audio, signal });
  if (!src.direct || !src.direct.length) {
    throw Object.assign(new Error(`no direct sources for episode ${ep}`), { code: 'NO_EMBEDS' });
  }

  for (const candidate of src.direct) {
    try {
      const valid = await watchanimeworld.probeCopy(candidate.spec, { signal });
      if (!valid) continue;

      const sid = randomUUID();
      const session = {
        sid,
        at: Date.now(),
        provider: 'watchanimeworld',
        kind: 'progressive',
        container: 'mp4',
        spec: candidate.spec,
        title: media.title,
        episode: { number: episode.number, title: episode.title },
        audio: candidate.audio ?? 'dub',
        quality: candidate.quality ?? 'auto',
        variants: [...new Set(src.direct.map((d) => d.quality))],
        proof: { container: 'mp4', checkedBytes: candidate.spec.s },
        referer: 'https://player.abyssplayer.com/',
        signed: { host: `${candidate.spec.h}.sssrr.org`, dir: '' },
        mediaUrl: watchanimeworld.abyssPartUrl(candidate.spec, 0),
        episodeRef: episode.id,
        allowedHosts: new Set([`${candidate.spec.h}.sssrr.org`]),
        subUrls: [],
        subtitles: [],
      };
      sessions.set(sid, session);
      const meta = {
        session: sid,
        provider: 'watchanimeworld',
        kind: 'progressive',
        container: 'mp4',
        title: media.title,
        episode: session.episode,
        quality: session.quality,
        variants: session.variants,
        audio: session.audio,
        skip: null,
        proof: session.proof,
        master: `/stream/${sid}/media.mp4`,
        downloadUrl: `/stream/${sid}/media.mp4?download=1`,
        downloadPage: null,
        subtitles: [],
      };
      recent.set(`${title.toLowerCase()}|${ep}|${audio}|watchanimeworld`, { at: Date.now(), sid });
      return meta;
    } catch {
      // try next candidate
    }
  }
  throw Object.assign(new Error('no playable WatchAnimeWorld rendition'), { code: 'RESOLVE_FAILED' });
}

async function buildSourceAnimewave({ title, ep, audio }) {
  const signal = AbortSignal.timeout(RESOLVE_TIMEOUT_MS);
  const { media, episodes } = await detailsForProvider('animewave', title);
  const episode = episodes.find((e) => e.number === ep) ?? episodes[ep - 1];
  if (!episode) throw Object.assign(new Error(`episode ${ep} is not in AnimeWave list`), { code: 'NO_SUCH_EPISODE' });

  const { embeds } = await animewave.sources(episode.id || episode.ref, { audioType: audio, signal });
  if (!embeds || !embeds.length) throw Object.assign(new Error(`no ${audio} embeds for episode ${ep}`), { code: 'NO_EMBEDS' });

  const candidates = rankEmbeds(embeds).slice(0, 3);
  for (const embed of candidates) {
    try {
      const r = await animewave.resolve(embed, { referer: 'https://animewave.to/', signal });
      const sniffed = await snackPlayable(r, signal);
      if (sniffed) {
        return createHlsSession({
          provider: 'animewave', media, episode, resolvedResult: r, sniffed, defaultReferer: 'https://megaplay.buzz/', skip: null, audio,
        });
      }
    } catch {
      // try next
    }
  }
  throw Object.assign(new Error(`no playable AnimeWave variant`), { code: 'RESOLVE_FAILED' });
}

async function buildSourceAnimekai({ title, ep, audio }) {
  const signal = AbortSignal.timeout(RESOLVE_TIMEOUT_MS);
  const { media, episodes } = await detailsForProvider('animekai', title);
  const episode = episodes.find((e) => e.number === ep) ?? episodes[ep - 1];
  if (!episode) throw Object.assign(new Error(`episode ${ep} is not in AnimeKai list`), { code: 'NO_SUCH_EPISODE' });

  const { embeds } = await animekai.sources(episode.id || episode.ref, { audioType: audio, signal });
  if (!embeds || !embeds.length) throw Object.assign(new Error(`no ${audio} embeds for episode ${ep}`), { code: 'NO_EMBEDS' });

  const candidates = rankEmbeds(embeds).slice(0, 3);
  for (const embed of candidates) {
    try {
      const r = await animekai.resolve(embed, { referer: 'https://animekai.be/', signal });
      const sniffed = await snackPlayable(r, signal);
      if (sniffed) {
        return createHlsSession({
          provider: 'animekai', media, episode, resolvedResult: r, sniffed, defaultReferer: 'https://megaplay.buzz/', skip: null, audio,
        });
      }
    } catch {
      // try next
    }
  }
  throw Object.assign(new Error(`no playable AnimeKai variant`), { code: 'RESOLVE_FAILED' });
}

const providerHandlers = {
  aniwatch: buildSourceAniwatch,
  hianime: buildSourceHianime,
  anikoto: buildSourceAnikoto,
  animedubhindi: buildSourceAdb,
  watchanimeworld: buildSourceWatchanimeworld,
  animewave: buildSourceAnimewave,
  animekai: buildSourceAnimekai,
};

function setProviderHandler(provider, handler) {
  providerHandlers[provider.toLowerCase()] = handler;
}

const searchHandlers = {
  aniwatch: (q, opts) => aniwatch.search(q, opts),
  hianime: (q, opts) => hianime.search(q, opts),
  anikoto: (q, opts) => anikoto.search(q, opts),
  animedubhindi: (q, opts) => animedubhindi.search(q, opts),
  watchanimeworld: (q, opts) => watchanimeworld.search(q, opts),
  animewave: (q, opts) => animewave.search(q, opts),
  animekai: (q, opts) => animekai.search(q, opts),
};

function setSearchHandler(provider, handler) {
  searchHandlers[provider.toLowerCase()] = handler;
}

async function buildSourceProvider(provider, { title, ep, audio }) {
  const norm = provider.toLowerCase();
  const handler = providerHandlers[norm];
  if (!handler) throw new Error(`Unsupported provider: ${provider}`);
  return await handler({ title, ep, audio });
}

/* ------------------------------------------------------------- race dispatcher */

async function raceProviders(candidates, { title, ep, audio }) {
  const startTime = Date.now();
  console.log(`[Bridge Race] Racing [${candidates.join(', ')}] for "${title}" ep ${ep} (${audio})`);
  return new Promise((resolveRace, rejectRace) => {
    let resolved = false;
    let pending = candidates.length;
    const errors = [];

    for (const prov of candidates) {
      buildSourceProvider(prov, { title, ep, audio })
        .then((meta) => {
          if (!resolved) {
            resolved = true;
            const elapsed = Date.now() - startTime;
            console.log(`[Bridge Race] Winner: ${prov} in ${elapsed}ms!`);
            meta.raceMs = elapsed;
            meta.winner = prov;
            recent.set(`${title.toLowerCase()}|${ep}|${audio}|auto`, { at: Date.now(), sid: meta.session });
            recent.set(`${title.toLowerCase()}|${ep}|${audio}|fastest`, { at: Date.now(), sid: meta.session });
            recent.set(`${title.toLowerCase()}|${ep}|${audio}|${prov}`, { at: Date.now(), sid: meta.session });
            resolveRace(meta);
          }
        })
        .catch((err) => {
          errors.push(`${prov}: ${err.message || err.code || err}`);
          pending--;
          if (pending === 0 && !resolved) {
            rejectRace(Object.assign(new Error(`All providers in race failed (${errors.join('; ')})`), { code: 'RESOLVE_FAILED' }));
          }
        });
    }
  });
}

async function buildSource({ title, ep, audio, provider = 'auto', fallback = true }) {
  const normProvider = (provider || 'auto').toLowerCase();

  // If a specific provider is requested:
  if (normProvider !== 'auto' && normProvider !== 'fastest') {
    try {
      return await buildSourceProvider(normProvider, { title, ep, audio });
    } catch (e) {
      if (!fallback) throw e;
      console.warn(`[Bridge] Specific provider "${normProvider}" failed, falling back to race:`, e.message);
    }
  }

  // Auto / Fastest race mode:
  let candidates;
  if (audio === 'hindi') {
    candidates = ['animedubhindi'];
  } else if (audio === 'dub') {
    candidates = ['aniwatch', 'anikoto', 'hianime', 'animewave', 'animekai', 'watchanimeworld', 'animedubhindi'];
  } else {
    candidates = ['aniwatch', 'anikoto', 'hianime', 'animewave', 'animekai'];
  }

  try {
    return await raceProviders(candidates, { title, ep, audio });
  } catch (err) {
    if (audio === 'dub' && fallback) {
      return await buildSource({ title, ep, audio: 'sub', provider: 'auto', fallback: false });
    }
    throw err;
  }
}

/* ------------------------------------------------------- audio availability */

async function buildAudiosAnikoto({ title, ep }) {
  const signal = AbortSignal.timeout(RESOLVE_TIMEOUT_MS);
  const { media, episodes } = await detailsForProvider('anikoto', title);
  const episode = episodes.find((e) => e.number === ep) ?? episodes[ep - 1];
  if (!episode) throw Object.assign(new Error(`episode ${ep} is not in this title's list (${episodes.length} listed)`), { code: 'NO_SUCH_EPISODE' });

  const subEmbeds = rankEmbeds((await anikoto.sources(episode.id, { audioType: 'sub', signal })).embeds);
  const dubEmbeds = rankEmbeds((await anikoto.sources(episode.id, { audioType: 'dub', signal })).embeds);

  const audios = [{ id: 'sub', label: 'Japanese (original)', available: subEmbeds.length > 0 }];

  let state = 'absent';
  let reason;
  if (!dubEmbeds.length) {
    reason = 'This title lists no dubbed source.';
  } else if (!subEmbeds.length) {
    state = 'unknown';
    reason = 'The original could not be read to compare the dub against.';
  } else {
    let sawCopy = false;
    for (const dEmbed of dubEmbeds.slice(0, 2)) {
      for (const sEmbed of subEmbeds.slice(0, 2)) {
        try {
          const verdict = await dubPairVerdict({ subEmbedUrl: sEmbed, dubEmbedUrl: dEmbed, signal });
          if (verdict.verdict === 'distinct') {
            state = 'verified';
            break;
          }
          if (verdict.verdict === 'copy') sawCopy = true;
        } catch {
          // try next pair
        }
      }
      if (state === 'verified') break;
    }
    if (state !== 'verified' && sawCopy) {
      state = 'copy';
      reason = 'The site-labeled dub was measured to be identical to the original audio.';
    }
  }

  audios.push({
    id: 'dub',
    label: 'English (dub)',
    available: state === 'verified',
    state,
    ...(reason ? { reason } : {}),
  });

  return { title: media.title, episode: { number: episode.number, title: episode.title }, audios };
}

let customAudiosHandler = null;
function setAudiosHandler(handler) {
  customAudiosHandler = handler;
}

async function buildAudios({ title, ep }) {
  if (customAudiosHandler) {
    return await customAudiosHandler({ title, ep });
  }
  let anikotoRes = null;
  try {
    anikotoRes = await buildAudiosAnikoto({ title, ep });
  } catch {
    // anikoto error
  }

  const audios = anikotoRes ? [...anikotoRes.audios] : [
    { id: 'sub', label: 'Japanese (original)', available: true },
    { id: 'dub', label: 'English (dub)', available: false, state: 'unknown', reason: 'Provider check unavailable.' },
  ];

  // If dub is not yet verified from anikoto, check other providers
  const dubEntry = audios.find((a) => a.id === 'dub');
  if (dubEntry && !dubEntry.available) {
    for (const prov of ['aniwatch', 'hianime', 'animewave', 'animekai']) {
      try {
        const { episodes } = await detailsForProvider(prov, title);
        const epObj = episodes.find((e) => e.number === ep) ?? episodes[ep - 1];
        if (epObj) {
          const mod = prov === 'aniwatch' ? aniwatch : prov === 'hianime' ? hianime : prov === 'animewave' ? animewave : animekai;
          const s = await mod.sources(epObj.id || epObj.ref, { audioType: 'dub', signal: AbortSignal.timeout(4000) });
          if (s && s.embeds && s.embeds.length > 0) {
            dubEntry.available = true;
            dubEntry.state = 'verified';
            delete dubEntry.reason;
            break;
          }
        }
      } catch {
        // try next
      }
    }
  }

  try {
    const { episodes } = await detailsForProvider('animedubhindi', title);
    const hasEp = episodes.some((e) => e.number === ep);
    if (hasEp) {
      audios.push({
        id: 'hindi',
        label: 'Hindi (Multi-Audio)',
        available: true,
        state: 'verified',
      });
    }
  } catch {
    // not on animedubhindi
  }

  return {
    title: anikotoRes?.title ?? title,
    episode: anikotoRes?.episode ?? { number: ep, title: `Episode ${ep}` },
    audios,
  };
}

/* ----------------------------------------------------------- stream proxy */

function freshSignedUrl(session, target) {
  if (session.kind === 'progressive' || session.provider === 'animedubhindi' || session.provider === 'hianime' || session.provider === 'watchanimeworld') {
    return target;
  }
  const u = new URL(target);
  if (u.host === session.signed.host && session.signed.dir && u.pathname.startsWith(`${session.signed.dir}/`)) {
    u.searchParams.delete('token');
    const token = buildMegaPlayToken(session.mediaUrl);
    if (token) u.searchParams.set('token', token);
  }
  return u.toString();
}

function admitHost(session, host) {
  if (session.allowedHosts.has(host) || session.allowedHosts.size < ALLOWED_HOSTS_CAP) {
    session.allowedHosts.add(host);
    return true;
  }
  session.hostsCapped = true;
  return false;
}

function useSession(id) {
  const session = sessions.get(id);
  if (session) session.at = Date.now();
  return session;
}

function rewritePlaylist(session, text, baseUrl) {
  const mapUri = (uri) => {
    try {
      const abs = new URL(uri, baseUrl).toString();
      admitHost(session, new URL(abs).host);
      return `/stream/${session.sid}/play?u=${b64url(abs)}&name=${encodeURIComponent(new URL(abs).pathname.split('/').pop() ?? 'u')}`;
    } catch {
      return uri;
    }
  };
  return text
    .split(/\r?\n/)
    .map((raw) => {
      const line = raw.trim();
      if (!line) return line;
      if (line.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/g, (_m, uri) => `URI="${mapUri(uri)}"`);
      }
      return mapUri(line);
    })
    .join('\n');
}

async function serveWawStream(req, res, session, signal) {
  const reqUrl = new URL(req.url, 'http://127.0.0.1');
  const isDownload = reqUrl.searchParams.get('download') === '1';

  if (session.mockBytes) {
    const rangeHeader = req.headers.range;
    let start = 0;
    let end = session.mockBytes.length - 1;
    let status = 200;
    if (rangeHeader && rangeHeader.startsWith('bytes=')) {
      const parts = rangeHeader.slice(6).split('-');
      start = parseInt(parts[0], 10) || 0;
      if (parts[1]) end = Math.min(parseInt(parts[1], 10), session.mockBytes.length - 1);
      status = 206;
    }
    const chunk = session.mockBytes.subarray(start, end + 1);
    cors(res);
    res.statusCode = status;
    res.setHeader('cache-control', 'no-store');
    res.setHeader('accept-ranges', 'bytes');
    res.setHeader('content-length', String(chunk.length));
    if (status === 206) {
      res.setHeader('content-range', `bytes ${start}-${end}/${session.mockBytes.length}`);
    }
    if (isDownload) {
      const cleanTitle = (session.title || 'video').replace(/[^a-zA-Z0-9_-]/g, '_');
      res.setHeader('content-disposition', `attachment; filename="${cleanTitle}_EP${session.episode?.number || 1}.mp4"`);
    }
    res.setHeader('content-type', 'video/mp4');
    res.end(chunk);
    return;
  }

  const spec = session.spec;
  const rangeHeader = req.headers.range;
  const parsedRange = watchanimeworld.parseAbyssRange(rangeHeader, spec.s);
  if (parsedRange === 'unsatisfiable') {
    cors(res);
    res.statusCode = 416;
    res.setHeader('content-range', `bytes */${spec.s}`);
    res.end();
    return;
  }

  const start = parsedRange ? parsedRange.start : 0;
  const requestedEnd = parsedRange ? parsedRange.end : spec.s - 1;
  const end = Math.min(requestedEnd, start + 8 * 1024 * 1024 - 1);

  cors(res);
  res.statusCode = parsedRange ? 206 : 200;
  res.setHeader('cache-control', 'no-store');
  res.setHeader('accept-ranges', 'bytes');
  res.setHeader('content-length', String(end - start + 1));
  if (parsedRange) {
    res.setHeader('content-range', `bytes ${start}-${end}/${spec.s}`);
  }
  if (isDownload) {
    const cleanTitle = (session.title || 'video').replace(/[^a-zA-Z0-9_-]/g, '_');
    res.setHeader('content-disposition', `attachment; filename="${cleanTitle}_EP${session.episode?.number || 1}.mp4"`);
  }
  res.setHeader('content-type', 'video/mp4');

  const chunkLen = watchanimeworld.ABYSS_PART_SIZE;
  const startPart = Math.floor(start / chunkLen);
  const endPart = Math.floor(end / chunkLen);

  for (let p = startPart; p <= endPart; p++) {
    if (res.writableEnded || res.destroyed) break;
    const pStart = p === startPart ? (start % chunkLen) : 0;
    const pEnd = p === endPart ? (end % chunkLen) : (watchanimeworld.abyssPartLength(spec.s, p) - 1);
    const partUrl = watchanimeworld.abyssPartUrl(spec, p);
    try {
      const partRes = await fetch(partUrl, {
        headers: {
          referer: 'https://player.abyssplayer.com/',
          range: `bytes=${pStart}-${pEnd}`,
        },
        signal,
      });
      if (!partRes.ok && partRes.status !== 206) break;
      const body = partRes.body;
      if (body) {
        for await (const chunk of body) {
          if (!res.write(chunk)) await new Promise((r) => res.once('drain', r));
        }
      }
    } catch {
      break;
    }
  }
  res.end();
}

async function serveStream(req, res, session, target, signal) {
  const reqUrl = new URL(req.url, 'http://127.0.0.1');
  const isDownload = reqUrl.searchParams.get('download') === '1';

  if (session.mockBytes) {
    const rangeHeader = req.headers.range;
    let start = 0;
    let end = session.mockBytes.length - 1;
    let status = 200;
    if (rangeHeader && rangeHeader.startsWith('bytes=')) {
      const parts = rangeHeader.slice(6).split('-');
      start = parseInt(parts[0], 10) || 0;
      if (parts[1]) end = Math.min(parseInt(parts[1], 10), session.mockBytes.length - 1);
      status = 206;
    }
    const chunk = session.mockBytes.subarray(start, end + 1);
    cors(res);
    res.statusCode = status;
    res.setHeader('cache-control', 'no-store');
    res.setHeader('accept-ranges', 'bytes');
    res.setHeader('content-length', String(chunk.length));
    if (status === 206) {
      res.setHeader('content-range', `bytes ${start}-${end}/${session.mockBytes.length}`);
    }
    if (isDownload) {
      const cleanTitle = (session.title || 'video').replace(/[^a-zA-Z0-9_-]/g, '_');
      const ext = session.container === 'matroska' ? 'mkv' : 'mp4';
      res.setHeader('content-disposition', `attachment; filename="${cleanTitle}_EP${session.episode?.number || 1}.${ext}"`);
    }
    res.setHeader('content-type', session.container === 'matroska' ? 'video/x-matroska' : 'video/mp4');
    res.end(chunk);
    return;
  }

  if (session.provider === 'watchanimeworld' && session.spec) {
    return await serveWawStream(req, res, session, signal);
  }

  const upstream = freshSignedUrl(session, target);
  const res2 = await fetch(upstream, {
    headers: { referer: session.referer, ...(req.headers.range ? { range: req.headers.range } : {}) },
    signal,
  });
  if (!res2.ok && res2.status !== 206) {
    await res2.body?.cancel().catch(() => {});
    return json(res, refusalStatus(res2.status), { error: 'UPSTREAM', status: res2.status, path: new URL(upstream).pathname });
  }
  const type = res2.headers.get('content-type') ?? '';
  const path = new URL(upstream).pathname.toLowerCase();
  const looksPlaylist = (/mpegurl/i.test(type) || path.endsWith('.m3u8')) && session.kind !== 'progressive';
  cors(res);
  res.statusCode = res2.status;
  res.setHeader('cache-control', 'no-store');
  if (res2.headers.get('accept-ranges')) res.setHeader('accept-ranges', res2.headers.get('accept-ranges'));
  if (res2.headers.get('content-length')) res.setHeader('content-length', res2.headers.get('content-length'));
  if (res2.headers.get('content-range')) res.setHeader('content-range', res2.headers.get('content-range'));
  if (looksPlaylist) {
    res.setHeader('content-type', 'application/vnd.apple.mpegurl');
    const text = await res2.text();
    res.end(rewritePlaylist(session, text, upstream));
    return;
  }
  if (isDownload) {
    const cleanTitle = (session.title || 'video').replace(/[^a-zA-Z0-9_-]/g, '_');
    const ext = session.container === 'matroska' ? 'mkv' : 'mp4';
    res.setHeader('content-disposition', `attachment; filename="${cleanTitle}_EP${session.episode?.number || 1}.${ext}"`);
  }
  res.setHeader('content-type', type || (session.container === 'matroska' ? 'video/x-matroska' : 'video/mp4'));
  const body = res2.body;
  if (!body) { res.end(); return; }
  for await (const chunk of body) {
    if (!res.write(chunk)) await new Promise((r) => res.once('drain', r));
  }
  res.end();
}

/* ------------------------------------------------------------------ router */

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { cors(res); res.statusCode = 204; res.end(); return; }
  if (req.method !== 'GET') return json(res, 405, { error: 'METHOD' });
  const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`);
  prune();

  if (url.pathname !== '/health') {
    const blocked = blockedOrigin(req);
    if (blocked) return json(res, 403, { error: 'ORIGIN_NOT_ALLOWED', origin: blocked });
    const wait = operatorLocal(req) ? null : rateTake(url.pathname, clientIp(req));
    if (wait !== null) {
      res.setHeader('retry-after', String(wait));
      return json(res, 429, { error: 'RATE_LIMITED', retry_after: wait });
    }
  }

  try {
    if (url.pathname === '/health') {
      return json(res, 200, {
        ok: true,
        providers: ['auto', 'aniwatch', 'hianime', 'anikoto', 'animedubhindi', 'watchanimeworld', 'animewave', 'animekai'],
        dispatcher: true,
        race: true,
        bridge: 'api/bridge.mjs',
        role: 'stream bridge & multi-provider dispatcher with real-time latency racing',
      });
    }

    if (url.pathname === '/search') {
      const q = url.searchParams.get('q') ?? '';
      const prov = (url.searchParams.get('provider') ?? 'auto').toLowerCase();
      if (!q.trim()) return json(res, 400, { error: 'Q_REQUIRED' });
      const targetProv = prov === 'auto' ? 'aniwatch' : prov;
      const searchFn = searchHandlers[targetProv] || ((q, opts) => anikoto.search(q, opts));
      const hits = await searchFn(q, { signal: AbortSignal.timeout(30_000) });
      return json(res, 200, (hits ?? []).map((h) => ({
        id: h.id, slug: h.slug ?? h.id, title: h.title, coverUrl: h.coverUrl ?? null, provider: targetProv,
      })));
    }

    if (url.pathname === '/resolve') {
      const title = url.searchParams.get('title') ?? '';
      const ep = Number(url.searchParams.get('ep') ?? '0');
      const audioParam = url.searchParams.get('audio') ?? 'sub';
      const audio = audioParam === 'dub' || audioParam === 'hindi' ? 'dub' : 'sub';
      const requestedProvider = url.searchParams.get('provider') ?? (audioParam === 'hindi' ? 'animedubhindi' : 'auto');
      const fallback = url.searchParams.get('fallback') !== 'false';
      if (!title.trim() || !Number.isInteger(ep) || ep < 1) return json(res, 400, { error: 'TITLE_EP_REQUIRED' });
      const key = `${title.toLowerCase()}|${ep}|${audio}|${requestedProvider}`;
      const reuse = recent.get(key);
      if (reuse && sessions.has(reuse.sid)) {
        const s = useSession(reuse.sid);
        return json(res, 200, {
          session: reuse.sid, provider: s.provider ?? 'anikoto', kind: s.kind ?? 'hls', container: s.container,
          title: s.title, episode: s.episode, quality: s.quality,
          variants: s.variants, audio: s.audio, skip: s.skip ?? null, proof: s.proof,
          master: s.kind === 'progressive' ? `/stream/${reuse.sid}/media.${s.container === 'matroska' ? 'mkv' : 'mp4'}` : `/stream/${reuse.sid}/master.m3u8`,
          downloadUrl: s.kind === 'progressive' ? `/stream/${reuse.sid}/media.${s.container === 'matroska' ? 'mkv' : 'mp4'}?download=1` : (s.downloadPage ?? `/stream/${reuse.sid}/master.m3u8`),
          downloadPage: s.downloadPage ?? null,
          subtitles: s.subtitles, reused: true,
        });
      }
      const meta = await buildSource({ title, ep, audio, provider: requestedProvider, fallback });
      recent.set(key, { at: Date.now(), sid: meta.session });
      return json(res, 200, meta);
    }

    if (url.pathname === '/audios') {
      const title = url.searchParams.get('title') ?? '';
      const ep = Number(url.searchParams.get('ep') ?? '0');
      if (!title.trim() || !Number.isInteger(ep) || ep < 1) return json(res, 400, { error: 'TITLE_EP_REQUIRED' });
      const key = `${title.toLowerCase()}|${ep}`;
      const hit = audioCache.get(key);
      if (hit && Date.now() - hit.at < AUDIO_TTL) return json(res, 200, hit.meta);
      const meta = await buildAudios({ title, ep });
      audioCache.set(key, { at: Date.now(), meta });
      return json(res, 200, meta);
    }

    if (url.pathname === '/downloads') {
      const title = url.searchParams.get('title') ?? '';
      const ep = Number(url.searchParams.get('ep') ?? '0');
      if (!title.trim() || !Number.isInteger(ep) || ep < 1) return json(res, 400, { error: 'TITLE_EP_REQUIRED' });

      const options = [
        {
          provider: 'animedubhindi',
          name: 'AnimeDubHindi',
          badge: 'Hindi Dub',
          format: 'MKV (Multi-Audio: Hindi + Jap)',
          quality: '1080p / 720p',
          type: 'direct',
          audio: 'hindi',
          description: 'Direct progressive MKV download with dual Hindi and Japanese audio tracks.',
        },
        {
          provider: 'watchanimeworld',
          name: 'WatchAnimeWorld',
          badge: 'Multi-Audio',
          format: 'MP4 (Hindi / Eng / Jap)',
          quality: '1080p / 720p',
          type: 'direct',
          audio: 'dub',
          description: 'Direct progressive MP4 file with multi-audio selection.',
        },
        {
          provider: 'hianime',
          name: 'HiAnime Portal',
          badge: 'Multi-Quality',
          format: 'MP4 Download Portal',
          quality: '1080p / 720p / 480p / 360p',
          type: 'portal',
          audio: 'sub',
          description: 'HiAnime download portal with individual quality MP4 downloads.',
        },
        {
          provider: 'aniwatch',
          name: 'AniWatch Stream',
          badge: 'Sub / Dub',
          format: 'HLS Master Stream (.m3u8)',
          quality: '1080p HD',
          type: 'stream',
          audio: 'sub',
          description: 'HLS stream master URL for offline downloaders, VLC, and mpv.',
        },
        {
          provider: 'anikoto',
          name: 'AniKoto Stream',
          badge: 'Sub / Dub',
          format: 'HLS Master Stream (.m3u8)',
          quality: '1080p / 720p',
          type: 'stream',
          audio: 'sub',
          description: 'Adaptive HLS master playlist.',
        },
      ];
      return json(res, 200, { title, episode: ep, options });
    }

    const mkv = url.pathname.match(/^\/stream\/([\w-]+)\/(media(?:\.[\w]+)?)$/);
    if (mkv) {
      const session = useSession(mkv[1]);
      if (!session) return json(res, 404, { error: 'NO_SESSION' });
      return await serveStream(req, res, session, session.mediaUrl, AbortSignal.timeout(60_000));
    }

    const master = url.pathname.match(/^\/stream\/([\w-]+)\/master\.m3u8$/);
    if (master) {
      const session = useSession(master[1]);
      if (!session) return json(res, 404, { error: 'NO_SESSION' });
      return await serveStream(req, res, session, session.mediaUrl, AbortSignal.timeout(60_000));
    }

    const play = url.pathname.match(/^\/stream\/([\w-]+)\/play$/);
    if (play) {
      const session = useSession(play[1]);
      if (!session) return json(res, 404, { error: 'NO_SESSION' });
      let target;
      try { target = unb64url(url.searchParams.get('u') ?? ''); } catch { target = ''; }
      let parsed;
      try { parsed = new URL(target); } catch { parsed = undefined; }
      if (!parsed || !/^https?:$/.test(parsed.protocol) || !session.allowedHosts.has(parsed.host)) {
        return json(res, 403, { error: 'HOST_NOT_ALLOWED' });
      }
      return await serveStream(req, res, session, parsed.toString(), AbortSignal.timeout(60_000));
    }

    const sub = url.pathname.match(/^\/stream\/([\w-]+)\/sub\/(\d+)\.vtt$/);
    if (sub) {
      const session = useSession(sub[1]);
      if (!session) return json(res, 404, { error: 'NO_SESSION' });
      const track = session.subUrls[Number(sub[2])];
      if (!track) return json(res, 404, { error: 'NO_TRACK' });
      const referer = track.referer || session.referer || 'https://megaplay.buzz/';
      let origin;
      try { origin = new URL(referer).origin; } catch {}
      const headers = {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'accept': 'text/vtt,text/plain,*/*',
        'accept-language': 'en-US,en;q=0.9',
        ...(referer ? { referer } : {}),
        ...(origin ? { origin } : {}),
      };
      const up = await fetch(track.url, { headers, signal: AbortSignal.timeout(30_000) });
      if (!up.ok) {
        await up.body?.cancel().catch(() => {});
        return json(res, refusalStatus(up.status), { error: 'UPSTREAM', status: up.status, track: Number(sub[2]) });
      }
      let rawText = await up.text();
      // Strip UTF-8 BOM if present
      if (rawText.charCodeAt(0) === 0xFEFF) rawText = rawText.slice(1);
      // Ensure WEBVTT header is present so browsers and players parse it reliably
      if (!rawText.trimStart().startsWith('WEBVTT')) {
        rawText = 'WEBVTT\n\n' + rawText;
      }
      cors(res, 'text/vtt; charset=utf-8');
      res.statusCode = 200;
      res.end(rawText);
      return;
    }

    return json(res, 404, {
      error: 'NOT_FOUND',
      endpoints: ['/health', '/search?q=&provider=', '/resolve?title=&ep=&audio=&provider=', '/audios?title=&ep=', '/downloads?title=&ep=', '/stream/:sid/media.mkv', '/stream/:sid/media.mp4', '/stream/:sid/master.m3u8', '/stream/:sid/play?u=', '/stream/:sid/sub/:i.vtt'],
    });
  } catch (e) {
    const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    const refusal = {
      NO_MATCH: 404, NO_SUCH_EPISODE: 404, NO_EMBEDS: 404, RESOLVE_FAILED: 422,
      ...(timedOut ? { BRIDGE_TIMEOUT: 422 } : {}),
    };
    const code = timedOut ? 'BRIDGE_TIMEOUT' : (e?.code ?? 'BRIDGE_ERROR');
    if (!refusal[code]) console.error(`bridge fault: ${e?.stack ?? e}`);
    return json(res, refusal[code] ?? 502, { error: code, message: e?.message ?? String(e) });
  }
});

export {
  server,
  buildSource,
  buildSourceProvider,
  raceProviders,
  buildSourceAnikoto,
  buildSourceAniwatch,
  buildSourceHianime,
  buildSourceAdb,
  buildSourceWatchanimeworld,
  buildSourceAnimewave,
  buildSourceAnimekai,
  buildAudios,
  buildAudiosAnikoto,
  detailsForProvider,
  detailsForAnikoto,
  providerHandlers,
  setProviderHandler,
  searchHandlers,
  setSearchHandler,
  setAudiosHandler,
  sessions,
  recent,
  audioCache,
};

if (process.argv[1] && process.argv[1].endsWith('bridge.mjs')) {
  server.listen(PORT, HOST, () => {
    console.log(`stream bridge & multi-provider dispatcher on http://${HOST}:${PORT} — loopback bind; visitors arrive through tunnel`);
    console.log('endpoints: /health /search?q=&provider= /resolve?title=&ep=&audio=&provider= /audios?title=&ep= /stream/:sid/...');
  });
}
