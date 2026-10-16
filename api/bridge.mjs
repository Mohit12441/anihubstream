// @ts-check
/**
 * AniKoto bridge — exposes the api/anikoto.mjs chain to the site with the
 * same-origin playback proxy the README's "Playback contract" requires.
 * Binds loopback (127.0.0.1), so the LAN cannot see it, but visitors reach it
 * through the Cloudflare tunnel (bridge.<domain> -> this port). It serves the
 * public, not only the operator: hence an Origin gate, a per-IP bound on the
 * expensive routes, no upstream URL in any response body, and refusals carried
 * as 4xx so the edge cannot swallow them.  Dependency-free; run with:
 *
 *   node api/bridge.mjs                    # http://127.0.0.1:8795
 *   ANIKOTO_BRIDGE_PORT=9000 node api/bridge.mjs
 *
 *   GET /health
 *   GET /search?q=<term>
 *   GET /resolve?title=<t>&ep=<n>&audio=<sub|dub>
 *   GET /audios?title=<t>&ep=<n>          which audio the episode really carries
 *   GET /stream/:sid/master.m3u8                   the rewired master
 *   GET /stream/:sid/play?u=<b64url&name=...>      playlists (rewritten) and
 *                                                  segment bytes (Range passed)
 *   GET /stream/:sid/sub/:idx.vtt                  subtitle track, proxied
 *
 * Token freshness: the megaplay token signs the CDN *directory* against the
 * unix-seconds clock, so a stored tokenized URL expires.  Every proxied
 * request re-signs from the stored tokenless URL (README: "re-resolve, never
 * cache") — the client never holds an upstream URL at all.
 *
 * Playability: /resolve only hands out a source after one real segment sniffs
 * as mpegts/mp4 (sniffContainer), and the decoy CDN (first-listed `?s=tcdn`
 * embed answers with PNG segments) is tried last, then skipped.
 */

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import {
  search,
  details,
  sources,
  resolve,
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
/* Idle time and how many viewers the process holds, overridable so the eviction path can
   be driven through HTTP in seconds instead of hours, and so the operator can tune a
   machine without editing it. Defaults: 3 h idle, 128 concurrent sessions. */
const SESSION_TTL = Number(process.env.ANIKOTO_SESSION_TTL_MS ?? 3 * 60 * 60 * 1000);
const SESSION_CAP = Number(process.env.ANIKOTO_SESSION_CAP ?? 128);
/* Repeat visits (reload, rewatch, next-episode jumps) reuse the session
   instead of paying a fresh provider resolve; sessions store
   tokenless URLs and re-sign per request, so reuse stays valid. */
const RECENT_TTL = 6 * 60 * 60 * 1000;
/* audio availability (is there a real second audio?) is a property of the episode,
   so it is cached far longer than a session — the byte-pair probe is the costly part */
const AUDIO_TTL = 60 * 60 * 1000;

/* /resolve and /audios drive several provider hops. Limits accommodate
   background prefetching while guarding against abuse. */
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = { '/resolve': 120, '/audios': 120, '/search': 120 };

/* Which pages may drive the bridge. Compared on hostname only — the same site is
   served from several ports (dev servers, the 8787 origin, Pages previews). */
const ALLOWED_ORIGIN_HOSTS = new Set([
  'anihubstream.com',
  'app.anihubstream.com',
  'bridge.anihubstream.com',
  'localhost',
  '127.0.0.1',
]);
const ALLOWED_ORIGIN_SUFFIXES = ['.anihubstream.pages.dev'];

/* A playlist names its own segment hosts, so the allowlist grows from provider data.
   Bounding it keeps a hostile or confused embed from turning the bridge into a
   general proxy; past the bound its extra hosts simply are not admitted. */
const ALLOWED_HOSTS_CAP = 8;

/* ------------------------------------------------------------------ state */

/** @type {Map<string, { at: number, media: any, episodes: any[] }>} */
const detailsCache = new Map();
/** @type {Map<string, any>} */
const sessions = new Map();
/** @type {Map<string, { at: number, sid: string }>} */
const recent = new Map();
/** @type {Map<string, { at: number, meta: any }>} audio availability is stable per episode */
const audioCache = new Map();
/** @type {Map<string, { at: number, n: number }>} route|ip -> requests in the current window */
const rateHits = new Map();

const b64url = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

function prune() {
  const now = Date.now();
  /* session.at is the last PROXIED request, not the create time (see useSession),
     so both of these are least-recently-used: an abandoned tab gives up its slot to
     whoever is actually watching instead of a viewer being dropped mid-episode. */
  for (const [k, v] of sessions) if (now - v.at > SESSION_TTL) sessions.delete(k);
  for (const [k, v] of detailsCache) if (now - v.at > DETAILS_TTL) detailsCache.delete(k);
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

/* Cloudflare's edge replaces any 5xx coming back from a tunnel with its own
   header-less HTML error page: the JSON body and the CORS headers are gone before
   the browser sees them, so the player can only conclude "bridge unreachable".
   Anything the provider refused is therefore answered with a 4xx, which passes
   through intact and carries the reason the viewer needs. */
const refusalStatus = (upstream) => (upstream >= 400 && upstream < 500 ? upstream : 422);

/* Behind the tunnel the socket peer is always cloudflared; the visitor's own
   address is in cf-connecting-ip. A loopback socket with no such header is the
   operator's tooling on this machine. */
const clientIp = (req) => {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf.trim()) return cf.trim();
  return req.socket.remoteAddress ?? 'unknown';
};

const fromLoopback = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '');

/* Only a process on this machine can arrive on the loopback interface without the
   tunnel's cf-connecting-ip — the bridge binds 127.0.0.1, so nothing remote can.
   That is the operator's own tooling, and it is exempt from the per-IP bound (which
   is there for visitors, not for the harness that checks them). */
const operatorLocal = (req) => fromLoopback(req) && !req.headers['cf-connecting-ip'];

/** The origin a page may drive the bridge from, or null when the request is allowed. */
function blockedOrigin(req) {
  const raw = req.headers.origin;
  /* GETs that are not CORS requests send no Origin at all — curl, the tunnel's own probes. */
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

/** Seconds until the window resets, or null when this route+ip is under its bound. */
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

/* -------------------------------------------------------------- resolution */

async function detailsFor(title) {
  const key = title.trim().toLowerCase();
  const hit = detailsCache.get(key);
  if (hit && Date.now() - hit.at < DETAILS_TTL) return hit;
  const hits = await search(title, { signal: AbortSignal.timeout(30_000) });
  if (!hits.length) throw Object.assign(new Error(`no AniKoto result for "${title}"`), { code: 'NO_MATCH' });
  const picked = hits[0];
  const { media, episodes } = await details(picked.id, { signal: AbortSignal.timeout(30_000) });
  const entry = { at: Date.now(), media, episodes };
  detailsCache.set(key, entry);
  return entry;
}

/** Prefer embeds without the `s=tcdn` selector: measured, that one is the decoy. */
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

/**
 * Fetch the best variant's playlist and sniff its first segment before the
 * source is called playable.  Returns the winning variant + measured proof.
 */
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
      /* try the next variant */
    }
  }
  return undefined;
}

async function buildSource({ title, ep, audio }) {
  const signal = AbortSignal.timeout(RESOLVE_TIMEOUT_MS);
  const { media, episodes } = await detailsFor(title);
  const episode = episodes.find((e) => e.number === ep) ?? episodes[ep - 1];
  if (!episode) throw Object.assign(new Error(`episode ${ep} is not in this title's list (${episodes.length} listed)`), { code: 'NO_SUCH_EPISODE' });

  const { embeds, skip } = await sources(episode.id, { audioType: audio, signal });
  if (!embeds.length) throw Object.assign(new Error(`no ${audio} embeds for episode ${ep}`), { code: 'NO_EMBEDS' });

  const candidates = rankEmbeds(embeds).slice(0, 3);
  const STAGGER_MS = 3000;

  async function resolveSingleEmbed(embed) {
    const r = await resolve(embed, { referer: UA_REFERER, signal });
    const sniffed = await snackPlayable(r, signal);
    if (!sniffed) throw new Error(`${embed.split('/').slice(0, 3).join('/')}: no playable variant`);

    const mediaUrl = r.master.url;
    const mediaBase = new URL(mediaUrl);
    const dir = mediaBase.pathname.replace(/\/[^/]*\.m3u8$/i, '');
    const sid = randomUUID();
    const session = {
      sid,
      at: Date.now(),
      title: media.title,
      episode: { number: episode.number, title: episode.title },
      audio: r.audio ?? audio,
      skip: skip ?? undefined,
      quality: sniffed.variant.quality,
      variants: [...new Set((r.variants ?? []).map((v) => v.quality))],
      proof: sniffed.proof,
      referer: r.master.headers?.referer ?? UA_REFERER,
      signed: { host: mediaBase.host, dir },
      mediaUrl,
      episodeRef: episode.id,
      allowedHosts: new Set([mediaBase.host]),
      subUrls: (r.subtitles ?? []).map((t) => ({ url: t.url, referer: t.headers?.referer ?? r.master.headers?.referer ?? UA_REFERER })),
      subtitles: (r.subtitles ?? []).map((t, i) => ({
        language: t.language,
        ...(t.name ? { name: t.name } : {}),
        url: `/stream/${sid}/sub/${i}.vtt`,
      })),
    };
    sessions.set(sid, session);
    const meta = {
      session: sid,
      title: media.title,
      episode: session.episode,
      quality: session.quality,
      variants: session.variants,
      audio: session.audio,
      skip: session.skip ?? null,
      proof: session.proof,
      master: `/stream/${sid}/master.m3u8`,
      subtitles: session.subtitles,
    };
    return meta;
  }

  return new Promise((resolveAll, rejectAll) => {
    let resolved = false;
    let pending = 0;
    const failures = [];
    const timers = [];

    const cleanup = () => {
      timers.forEach((t) => clearTimeout(t));
    };

    const runCandidate = (index) => {
      if (resolved || index >= candidates.length) return;
      const embed = candidates[index];
      pending++;

      resolveSingleEmbed(embed)
        .then((meta) => {
          if (!resolved) {
            resolved = true;
            cleanup();
            recent.set(`${title.toLowerCase()}|${ep}|${audio}`, { at: Date.now(), sid: meta.session });
            resolveAll(meta);
          }
        })
        .catch((e) => {
          failures.push(`${embed.split('/').slice(0, 3).join('/')}: ${e?.code ?? e?.message ?? e}`);
          pending--;
          if (!resolved && pending === 0 && index >= candidates.length - 1) {
            cleanup();
            rejectAll(Object.assign(new Error(`no playable source (${failures.join('; ')})`), { code: 'RESOLVE_FAILED' }));
          }
        });

      if (index + 1 < candidates.length) {
        const timer = setTimeout(() => {
          if (!resolved) runCandidate(index + 1);
        }, STAGGER_MS);
        timers.push(timer);
      }
    };

    runCandidate(0);
  });
}

/* ------------------------------------------------------- audio availability */

/**
 * Which audio tracks this episode ACTUALLY carries, decided by evidence — not the
 * site's `/dub` label.  The dub is offered only when a byte comparison against the
 * sub proves a second audio (dubPairVerdict "distinct"); a "copy" verdict means the
 * site's dub file is the original again, and "unknown" means we could not measure
 * it — neither becomes a selectable option, because offering a dub that plays
 * Japanese audio mislabeled as English is the exact fabrication this site refuses.
 */
async function buildAudios({ title, ep }) {
  const signal = AbortSignal.timeout(RESOLVE_TIMEOUT_MS);
  const { media, episodes } = await detailsFor(title);
  const episode = episodes.find((e) => e.number === ep) ?? episodes[ep - 1];
  if (!episode) throw Object.assign(new Error(`episode ${ep} is not in this title's list (${episodes.length} listed)`), { code: 'NO_SUCH_EPISODE' });

  const subEmbeds = rankEmbeds((await sources(episode.id, { audioType: 'sub', signal })).embeds);
  const dubEmbeds = rankEmbeds((await sources(episode.id, { audioType: 'dub', signal })).embeds);

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
    for (const du of dubEmbeds.slice(0, 3)) {
      if (du === subEmbeds[0]) continue;
      const v = await dubPairVerdict(subEmbeds[0], du, { signal });
      if (v.verdict === 'distinct') { state = 'verified'; break; }
      if (v.verdict === 'copy') { sawCopy = true; reason = v.reason; }
      else reason = v.reason;
    }
    if (state !== 'verified') {
      state = sawCopy ? 'copy' : 'unknown';
      reason = sawCopy
        ? "The source's dub file is byte-identical to its original — it carries no second audio."
        : `A second audio could not be measured on this source${reason ? ` (${reason})` : ''}.`;
    }
  }
  audios.push({ id: 'dub', label: 'English (dub)', available: state === 'verified', state, ...(reason ? { reason } : {}) });

  return { title: media.title, episode: { number: episode.number, title: episode.title }, audios };
}

/* ----------------------------------------------------------- stream proxy */

function freshSignedUrl(session, target) {
  const u = new URL(target);
  if (u.host === session.signed.host && u.pathname.startsWith(`${session.signed.dir}/`)) {
    u.searchParams.delete('token');
    const token = buildMegaPlayToken(session.mediaUrl);
    if (token) u.searchParams.set('token', token);
  }
  return u.toString();
}

/** Marks a host the playlist named as proxyable, up to ALLOWED_HOSTS_CAP. */
function admitHost(session, host) {
  if (session.allowedHosts.has(host) || session.allowedHosts.size < ALLOWED_HOSTS_CAP) {
    session.allowedHosts.add(host);
    return true;
  }
  session.hostsCapped = true;
  return false;
}

/**
 * Every proxied request — segments, playlists, caption fetches — refreshes the
 * session's timestamp, which is what makes SESSION_TTL an idle timeout and
 * SESSION_CAP an eviction of the least recently used viewer rather than whoever
 * happened to be resolved first. Without it a long rewatch is dropped mid-episode.
 */
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

async function serveStream(req, res, session, target, signal) {
  const upstream = freshSignedUrl(session, target);
  const res2 = await fetch(upstream, {
    headers: { referer: session.referer, ...(req.headers.range ? { range: req.headers.range } : {}) },
    signal,
  });
  if (!res2.ok && res2.status !== 206) {
    await res2.body?.cancel().catch(() => {});
    /* The CDN refusing a segment (expired token, object gone) is a 4xx the site can act
       on and the edge passes through; its 5xx is reported as 422 so the reason survives.
       Never the upstream URL itself — the client is not given one to hold. */
    return json(res, refusalStatus(res2.status), { error: 'UPSTREAM', status: res2.status, path: new URL(upstream).pathname });
  }
  const type = res2.headers.get('content-type') ?? '';
  const path = new URL(upstream).pathname.toLowerCase();
  const looksPlaylist = /mpegurl/i.test(type) || path.endsWith('.m3u8');
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
  res.setHeader('content-type', type || 'application/octet-stream');
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

  /* /health is what the site probes to decide whether real playback exists at all, so
     it answers whoever asks. Everything that costs the provider a request does not:
     the origin of the page must be one of ours, and a single caller gets a bounded
     number of the expensive routes per minute. */
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
        provider: 'anikoto',
        bridge: 'api/bridge.mjs',
        role: 'stream bridge — resolves and relays real playback; binds loopback and is reached by visitors through the tunnel',
      });
    }

    if (url.pathname === '/search') {
      const q = url.searchParams.get('q') ?? '';
      if (!q.trim()) return json(res, 400, { error: 'Q_REQUIRED' });
      const hits = await search(q, { signal: AbortSignal.timeout(30_000) });
      return json(res, 200, hits.map((h) => ({ id: h.id, slug: h.slug, title: h.title, coverUrl: h.coverUrl ?? null })));
    }

    if (url.pathname === '/resolve') {
      const title = url.searchParams.get('title') ?? '';
      const ep = Number(url.searchParams.get('ep') ?? '0');
      const audio = url.searchParams.get('audio') === 'dub' ? 'dub' : 'sub';
      if (!title.trim() || !Number.isInteger(ep) || ep < 1) return json(res, 400, { error: 'TITLE_EP_REQUIRED' });
      const key = `${title.toLowerCase()}|${ep}|${audio}`;
      const reuse = recent.get(key);
      if (reuse && sessions.has(reuse.sid)) {
        const s = useSession(reuse.sid);
        return json(res, 200, {
          session: reuse.sid, title: s.title, episode: s.episode, quality: s.quality,
          variants: s.variants, audio: s.audio, skip: s.skip ?? null, proof: s.proof,
          master: `/stream/${reuse.sid}/master.m3u8`, subtitles: s.subtitles, reused: true,
        });
      }
      const meta = await buildSource({ title, ep, audio });
      return json(res, 200, meta);
    }

    if (url.pathname === '/audios') {
      const title = url.searchParams.get('title') ?? '';
      const ep = Number(url.searchParams.get('ep') ?? '0');
      if (!title.trim() || !Number.isInteger(ep) || ep < 1) return json(res, 400, { error: 'TITLE_EP_REQUIRED' });
      const key = `${title.trim().toLowerCase()}|${ep}`;
      const hit = audioCache.get(key);
      if (hit && Date.now() - hit.at < AUDIO_TTL) return json(res, 200, hit.meta);
      const meta = await buildAudios({ title, ep });
      audioCache.set(key, { at: Date.now(), meta });
      return json(res, 200, meta);
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
      const up = await fetch(track.url, { headers: { referer: track.referer }, signal: AbortSignal.timeout(30_000) });
      if (!up.ok) {
        await up.body?.cancel().catch(() => {});
        return json(res, refusalStatus(up.status), { error: 'UPSTREAM', status: up.status, track: Number(sub[2]) });
      }
      cors(res, 'text/vtt; charset=utf-8');
      res.statusCode = 200;
      res.end(await up.text());
      return;
    }

    return json(res, 404, {
      error: 'NOT_FOUND',
      endpoints: ['/health', '/search?q=', '/resolve?title=&ep=&audio=', '/audios?title=&ep=', '/stream/:sid/master.m3u8', '/stream/:sid/play?u=', '/stream/:sid/sub/:i.vtt'],
    });
  } catch (e) {
    /* A refusal from the provider is not a bridge fault. Anything in 5xx coming back through
       the tunnel is replaced by Cloudflare's own edge page — no body, no CORS headers — so the
       reason the viewer needs ("episode 8 is not in this title's list") never reaches the
       browser and the player can only call the bridge unreachable. Refusals travel as 4xx.
       A genuine bridge fault stays 5xx: "the bridge broke" is the honest report there. */
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

server.listen(PORT, HOST, () => {
  console.log(`anikoto bridge on http://${HOST}:${PORT} — loopback bind; visitors arrive through the tunnel`);
  console.log('endpoints: /health /search?q= /resolve?title=&ep=&audio= /stream/:sid/...');
});
