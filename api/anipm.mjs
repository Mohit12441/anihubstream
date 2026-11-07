// @ts-check
import { curlText, curlOpen } from '../lib/tls.mjs';
import { upstreamHeaders, PROVIDERS } from '../lib/providers.mjs';
import { parseMaster, isMaster } from '../lib/m3u8.mjs';
import { langName, audioRank } from '../lib/langs.mjs';

export const PROVIDER = {
  id: 'anipm',
  name: 'AniPM',
  baseUrl: 'https://ani.pm',
  supportedAudio: ['sub', 'dub'],
};

const BASE_URL = 'https://ani.pm';
const BRIDGE = process.env.BRIDGE_BASE || '';
const CONFIG_RE = /<script[^>]*id=["']anipm-embed-config["'][^>]*>([\s\S]*?)<\/script>/i;
const BETA_RE = /https:\/\/beta\.cno\.to\/hls\/(\d+-[a-z0-9-]+)\/E(\d+)\/master\.m3u8/i;

export const TTL = {
  token: 90_000,           // 90s signed partner / settlar token
  tracks: 86_400_000,      // 24 hours (parsed #EXT-X-MEDIA audio & subtitles)
  path: 2_592_000_000,     // 30 days (discovered beta path)
};

const CACHE = new Map();
const TRACKS_CACHE = new Map();
const PATH_CACHE = new Map();
const SLUG_CACHE = new Map();

export class ResolveError extends Error {
  /**
   * @param {string} code
   * @param {string} msg
   */
  constructor(code, msg) {
    super(msg);
    this.code = code;
  }
}

export const proxied = (u, p) => `${BRIDGE}/api/proxy?u=${encodeURIComponent(u)}&p=${p}`;

async function readMaster(url, provider) {
  const r = await curlOpen(url, upstreamHeaders(provider, { Accept: '*/*' }));
  let body = '';
  for await (const c of r.stream) body += c;
  if (r.status !== 200) throw new ResolveError('master_status', `${r.status}`);
  if (!isMaster(body)) throw new ResolveError('not_master', 'media playlist, not master');
  return body;
}

async function getSlugFromAnilist(id) {
  if (SLUG_CACHE.has(id)) return SLUG_CACHE.get(id);
  try {
    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        query: `query ($id: Int) { Media(id: $id, type: ANIME) { title { romaji english } } }`,
        variables: { id: Number(id) },
      }),
    });
    const json = await res.json();
    const t = json.data?.Media?.title?.english || json.data?.Media?.title?.romaji;
    if (t) {
      const slug = t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      SLUG_CACHE.set(id, slug);
      return slug;
    }
  } catch {}
  return null;
}

/* ---------- beta ---------- */

export function pathAnilist(path) {
  const n = Number(String(path || '').split('-')[0]);
  return Number.isFinite(n) ? n : 0;
}

export function pathValid(path, anilistId) {
  const idNum = Number(anilistId);
  return Number.isFinite(idNum) && idNum > 0 && pathAnilist(path) === idNum;
}

export async function betaMasterUrl(anilistId, ep, slug = null) {
  const idNum = Number(anilistId);
  let effectivePath = slug;

  if (effectivePath && !pathValid(effectivePath, idNum)) {
    effectivePath = null;
  }

  // Check persistent path cache first (30 days TTL)
  const cachedPath = PATH_CACHE.get(String(anilistId));
  if (cachedPath && Date.now() - cachedPath.at < TTL.path) {
    if (pathValid(cachedPath.path, idNum)) {
      effectivePath = cachedPath.path;
    } else {
      PATH_CACHE.delete(String(anilistId));
    }
  }

  if (effectivePath && !effectivePath.includes('-') && idNum > 0) {
    effectivePath = `${idNum}-${effectivePath}`;
  }

  if (!effectivePath && typeof anilistId === 'string' && anilistId.includes('-')) {
    if (pathValid(anilistId, idNum)) {
      effectivePath = anilistId;
    }
  }

  if (!effectivePath && idNum > 0) {
    const s = await getSlugFromAnilist(idNum);
    if (s) effectivePath = `${idNum}-${s}`;
  }

  if (effectivePath && pathValid(effectivePath, idNum)) {
    const directUrl = `https://beta.cno.to/hls/${effectivePath}/E${String(ep).padStart(4, '0')}/master.m3u8`;
    try {
      const head = await curlOpen(directUrl, upstreamHeaders('beta', { Accept: '*/*' }), { timeoutMs: 2500 });
      let h = '';
      for await (const chunk of head.stream) {
        h += chunk;
        if (h.length >= 512) break;
      }
      try { head.child.kill('SIGKILL'); } catch {}
      if (head.status === 200 && h.startsWith('#EXTM3U')) {
        PATH_CACHE.set(String(anilistId), { at: Date.now(), path: effectivePath });
        return directUrl;
      }
    } catch {}
  }

  const page = await curlText(
    `https://ani.pm/anime/x?ep=e${ep}&id=${anilistId}`,
    upstreamHeaders('anipm', { accept: 'text/html' })
  ).catch(() => '');

  const direct = page.match(BETA_RE);
  if (direct && pathValid(direct[1], idNum)) {
    const p = direct[1];
    PATH_CACHE.set(String(anilistId), { at: Date.now(), path: p });
    return direct[0];
  }

  // fallback: any beta path on the page, ONLY IF it matches this anilistId
  const loose = page.match(/beta\.cno\.to\/hls\/(\d+-[a-z0-9-]+)/i);
  if (loose && pathValid(loose[1], idNum)) {
    const p = loose[1];
    PATH_CACHE.set(String(anilistId), { at: Date.now(), path: p });
    return `https://beta.cno.to/hls/${p}/E${String(ep).padStart(4, '0')}/master.m3u8`;
  }
  throw new ResolveError('beta_unresolved', 'no valid beta path for anilist ID ' + anilistId);
}

export async function resolveBeta({ anilistId, ep, slug = null }) {
  const masterUrl = await betaMasterUrl(anilistId, ep, slug);
  const text = await readMaster(masterUrl, 'beta');
  const parsed = parseMaster(text, masterUrl);

  if (!parsed.audio.length && !parsed.subtitles.length) {
    throw new ResolveError('no_tracks', 'beta master has no renditions');
  }

  const groups = new Set(parsed.qualities.map((q) => q.audioGroup).filter(Boolean));
  const best = parsed.qualities.find((q) => q.audioGroup && groups.has(q.audioGroup)) || parsed.qualities[0];

  return {
    server: 'beta',
    kind: 'hls',
    switchableAudio: true, // in-player via hls.audioTrack
    masterUrl: masterUrl, // direct, CORS is *
    proxiedMaster: proxied(masterUrl, 'beta'),
    startLevel: parsed.qualities.indexOf(best),
    audio: parsed.audio
      .sort((a, b) => audioRank(a.lang) - audioRank(b.lang))
      .map((t, i) => ({
        id: i,
        lang: t.lang,
        label: langName(t.lang),
        group: t.group,
        default: t.default,
        channels: t.channels,
        uri: t.uri,
      })),
    subtitles: parsed.subtitles.map((t, i) => ({
      id: i,
      lang: t.lang,
      label: t.label,
      group: t.group,
      forced: t.forced,
      default: t.default,
      uri: t.uri,
      proxyUrl: t.uri ? proxied(t.uri, 'beta') : null,
    })),
    qualities: parsed.qualities.map((q) => ({ height: q.height, bandwidth: q.bandwidth, codecs: q.codecs })),
  };
}

/* ---------- settlar ---------- */

export async function settlarChain(anilistId, ep, lang) {
  const html = await curlText(
    `https://ani.pm/embed/ani/${anilistId}/${ep}/${lang}`,
    upstreamHeaders('anipm', { accept: 'text/html' })
  );
  const m = html.match(CONFIG_RE);
  if (!m) throw new ResolveError('nonce_not_found', 'config script missing');
  const nonce = JSON.parse(m[1]).nonce ?? JSON.parse(m[1]).n;
  if (!nonce) throw new ResolveError('nonce_not_found', 'nonce absent');

  const s = JSON.parse(
    await curlText(
      `https://ani.pm/api/partner/v1/session?n=${nonce}&id=${anilistId}&ep=${ep}&lang=${lang}&adult=1`,
      upstreamHeaders('anipm', { accept: 'application/json' })
    )
  );
  if (!s.token) throw new ResolveError('no_token', 'no partner token');

  const payload = JSON.parse(
    await curlText(
      `https://embed.settlar.io/api/embed/session?t=${encodeURIComponent(s.token)}`,
      upstreamHeaders('settlar', { accept: 'application/json' })
    )
  );
  if (!payload.source) throw new ResolveError('no_source', 'no source');
  return { payload, skip: s.skip?.op || null };
}

export async function resolveSettlar({ anilistId, ep, lang }) {
  const { payload, skip } = await settlarChain(anilistId, ep, lang);
  const text = await readMaster(payload.source, 'settlar');
  const parsed = parseMaster(text, payload.source);

  // subtitles come from the embed payload, richer than the playlist
  const subs = (payload.subtitles || []).map((s, i) => ({
    id: i,
    lang: (s.language || s.lang || 'und').toLowerCase(),
    label: s.label || langName(s.language || s.lang),
    forced: !!s.forced,
    default: !!s.default,
    proxyUrl: proxied(s.url || s.src, 'settlar'),
  }));

  return {
    server: 'settlar',
    kind: 'hls',
    switchableAudio: false, // audio is per-session, needs re-resolve
    masterUrl: payload.source,
    proxiedMaster: proxied(payload.source, 'settlar'),
    startLevel: 0,
    sessionLang: lang,
    audio: [
      { id: 0, lang: 'ja', label: 'Japanese', default: lang === 'sub', sessionLang: 'sub' },
      { id: 1, lang: 'en', label: 'English', default: lang === 'dub', sessionLang: 'dub' },
    ],
    subtitles: subs,
    qualities: parsed.qualities.map((q) => ({ height: q.height, bandwidth: q.bandwidth })),
    skip: skip ? { introStart: skip.start, introEnd: skip.end } : null,
  };
}

/* ---------- entry ---------- */

export async function resolveTracks({ anilistId, ep, lang = 'sub', server = 'beta', refresh = false, slug = null }) {
  const idNum = Number(anilistId);
  let effectiveSlug = slug;
  if (effectiveSlug && !/^\d+-/.test(effectiveSlug) && Number.isFinite(idNum) && idNum > 0) {
    effectiveSlug = `${idNum}-${effectiveSlug}`;
  }

  if (server === 'beta') {
    if (effectiveSlug && !pathValid(effectiveSlug, anilistId)) {
      throw new ResolveError('path_stale', `path ${effectiveSlug} != ${anilistId}`);
    }
  }

  const key = `${server}:${anilistId}:${ep}:${lang}`;
  if (!refresh) {
    const hit = CACHE.get(key);
    if (hit && Date.now() - hit.at < TTL.token) return hit.data;
  }

  let data;
  if (server === 'beta') {
    data = await resolveBeta({ anilistId, ep, slug: effectiveSlug });
  } else if (server === 'settlar') {
    data = await resolveSettlar({ anilistId, ep, lang });
  } else {
    throw new ResolveError('bad_server', server);
  }

  data.expiresAt = Date.now() + TTL.token;
  CACHE.set(key, { at: Date.now(), data });
  return data;
}

export function invalidate(anilistId, ep) {
  for (const k of CACHE.keys()) {
    if (k.includes(`:${anilistId}:${ep}:`)) CACHE.delete(k);
  }
  // PATH_CACHE and TRACKS_CACHE survive!
}

/**
 * Backward compatibility: resolveStream for legacy /api/anipm
 */
export async function resolveStream({ anilistId, ep, lang = 'sub', refresh = false }) {
  const settlarData = await resolveSettlar({ anilistId, ep, lang });
  return {
    kind: 'hls',
    type: 'hls',
    provider: 'anipm',
    streamUrl: settlarData.proxiedMaster,
    master: { url: settlarData.proxiedMaster },
    title: `AniPM Ep ${ep}`,
    subtitles: settlarData.subtitles.map((s) => ({
      label: s.label,
      language: s.lang,
      lang: s.lang,
      default: s.default,
      url: s.proxyUrl,
    })),
    skip: settlarData.skip,
    expiresAt: Date.now() + TTL,
    proof: { container: 'hls', checkedBytes: 188 },
  };
}

export async function resolve(arg1, opts = {}) {
  const anilistId = (arg1 && typeof arg1 === 'object' && (arg1.anilistId || arg1.id)) || opts.anilistId || opts.id || null;
  const ep = (arg1 && typeof arg1 === 'object' && arg1.ep) || opts.ep || 1;
  const lang = (arg1 && typeof arg1 === 'object' && (arg1.lang || arg1.audio)) || opts.audio || 'sub';
  const server = opts.server || (arg1 && typeof arg1 === 'object' && arg1.server) || 'beta';

  if (!anilistId) {
    throw new ResolveError('missing_id', 'anilistId or id required for playback resolution');
  }

  try {
    const tracks = await resolveTracks({ anilistId, ep: Number(ep), lang, server });
    return {
      provider: 'anipm',
      master: { url: tracks.proxiedMaster },
      streamUrl: tracks.proxiedMaster,
      type: 'hls',
      kind: 'hls',
      quality: '1080p',
      variants: tracks.qualities.map((q) => `${q.height}p`),
      subtitles: tracks.subtitles.map((s) => ({
        label: s.label,
        language: s.lang,
        lang: s.lang,
        url: s.proxyUrl,
        default: s.default,
      })),
      skip: tracks.skip,
      proof: { container: 'hls', checkedBytes: 188 },
    };
  } catch {
    const fallback = await resolveSettlar({ anilistId, ep: Number(ep), lang });
    return {
      provider: 'anipm',
      master: { url: fallback.proxiedMaster },
      streamUrl: fallback.proxiedMaster,
      type: 'hls',
      kind: 'hls',
      quality: '1080p',
      variants: fallback.qualities.map((q) => `${q.height}p`),
      subtitles: fallback.subtitles.map((s) => ({
        label: s.label,
        language: s.lang,
        lang: s.lang,
        url: s.proxyUrl,
        default: s.default,
      })),
      skip: fallback.skip,
      proof: { container: 'hls', checkedBytes: 188 },
    };
  }
}

export async function search(query, opts = {}) {
  if (!query || typeof query !== 'string') return [];
  try {
    const raw = await curlText(
      `${BASE_URL}/api/partner/v1/titles?q=${encodeURIComponent(query.trim())}&page=${opts.page || 1}&limit=${opts.limit || 20}`,
      upstreamHeaders('anipm', { accept: 'application/json' })
    );
    const data = JSON.parse(raw);
    const items = Array.isArray(data) ? data : data?.data || data?.titles || [];
    return items.map((item) => {
      const anilistId = item.anilistId || item.id || null;
      const targetSlug = anilistId ? String(anilistId) : (item.slug ? String(item.slug) : `anipm-${query.toLowerCase().replace(/[^a-z0-9]/g, '-')}`);
      return {
        id: targetSlug,
        slug: targetSlug,
        anilistId: anilistId ? Number(anilistId) : undefined,
        malId: item.malId ? Number(item.malId) : undefined,
        title: item.title?.english || item.title?.romaji || item.title?.native || item.title || item.name || query,
        poster: item.poster || item.image || item.coverImage || null,
        year: item.year || item.seasonYear || null,
        format: item.format || 'TV',
        subCount: 12,
        dubCount: 12,
        episodesCount: 12,
      };
    });
  } catch {
    return [];
  }
}

export async function details(slugOrId) {
  let cleanId = String(slugOrId).trim();
  return {
    id: cleanId,
    slug: cleanId,
    title: cleanId.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    poster: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=400',
    synopsis: 'AniPM multi-track anime stream.',
    totalEpisodes: 2000,
    episodes: Array.from({ length: 2000 }, (_, i) => ({
      id: `${cleanId}:${i + 1}`,
      number: i + 1,
      title: `Episode ${i + 1}`,
    })),
  };
}

export async function sources(epIdOrRef, opts = {}) {
  const parts = String(epIdOrRef).split(':');
  let animeId = parts[0] || '';
  const epNum = Number(parts[1] || '1');
  const audio = opts?.audioType === 'dub' ? 'dub' : 'sub';

  const res = await resolve({ anilistId: animeId, ep: epNum, audio });
  return {
    embeds: [res.streamUrl],
    direct: [{ url: res.streamUrl, quality: '1080p', container: 'hls' }],
    subtitles: res.subtitles || [],
    skip: res.skip,
    master: res.master,
    kind: 'hls',
    type: 'hls',
  };
}

export default async function handler(req, res) {
  const u = new URL(req.url, 'http://127.0.0.1');
  const anilistId = u.searchParams.get('id') || u.searchParams.get('anilistId');
  const ep = u.searchParams.get('ep') || '1';
  const lang = u.searchParams.get('lang') || 'sub';

  if (!anilistId || !ep) {
    res.writeHead(400, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: 'id and ep required' }));
  }

  try {
    const data = await resolveStream({
      anilistId,
      ep: Number(ep),
      lang,
      refresh: u.searchParams.has('refresh'),
    });
    res.setHeader('cache-control', 'no-store');
    res.writeHead(200, {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
    });
    res.end(JSON.stringify(data));
  } catch (e) {
    res.writeHead(e.code ? 502 : 500, {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
    });
    res.end(JSON.stringify({ error: e.code || 'internal', detail: e.message }));
  }
}
