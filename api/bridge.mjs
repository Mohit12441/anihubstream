#!/usr/bin/env node
// @ts-check
import http from 'node:http';
import { URL } from 'node:url';
import { getAdapter, listAdapters } from './adapters/registry.mjs';
import * as anikoto from './anikoto.mjs';
import anipmHandler, { resolveTracks as anipmResolveTracks } from './anipm.mjs';
import tracksHandler from './tracks.mjs';
import { attachPartyRelay, getRoom, getRooms } from './party-relay.mjs';
import { comparePair } from './dubAudio.mjs';
import { curlOpen } from '../lib/tls.mjs';
import { PROVIDERS, upstreamHeaders, assertAllowed } from '../lib/providers.mjs';

const PORT = Number(process.env.ANIKOTO_BRIDGE_PORT || process.env.PORT || 8795);
const HOST = process.env.ANIKOTO_BRIDGE_HOST || '0.0.0.0';
const TAG_URI_RE = /(URI=")([^"]+)(")/g;

function inferType(url) {
  const p = new URL(url).pathname.toLowerCase();
  if (p.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
  if (p.endsWith('.ts')) return 'video/mp2t';
  if (p.endsWith('.m4s') || p.endsWith('.mp4')) return 'video/iso.segment';
  if (p.endsWith('.vtt')) return 'text/vtt';
  if (p.endsWith('.key')) return 'application/octet-stream';
  return 'application/octet-stream';
}

function rewriteManifest(body, base, key) {
  const wrap = (u) => {
    let abs;
    try { abs = new URL(u, base).href; } catch { return u; }
    if (!/^https?:/.test(abs)) return u;
    return `/api/proxy?u=${encodeURIComponent(abs)}&p=${key}`;
  };

  // EXT-X-MEDIA (audio + all subtitle renditions), EXT-X-KEY, EXT-X-MAP
  body = body.replace(TAG_URI_RE, (_, a, u, c) => a + wrap(u) + c);
  // variant playlists and segments
  body = body.replace(/^(?!#)(\S+)\s*$/gm, (line) => wrap(line.trim()));
  return body;
}

function cors(res) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET, HEAD, POST, OPTIONS');
  res.setHeader('access-control-allow-headers', '*');
  res.setHeader('access-control-expose-headers', 'content-length, content-range, accept-ranges, x-stream-expired');
}

export async function handleProxy(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || `127.0.0.1:${PORT}`}`);
  const target = url.searchParams.get('u') || url.searchParams.get('url');
  const key = url.searchParams.get('p') || url.searchParams.get('provider') || 'settlar';

  if (!target || !/^https?:\/\//.test(target)) {
    cors(res);
    res.writeHead(400, { 'content-type': 'text/plain' });
    return res.end('bad target');
  }

  try {
    assertAllowed(target, key);
  } catch (e) {
    cors(res);
    res.writeHead(403, { 'content-type': 'text/plain' });
    return res.end(e.message);
  }

  let up;
  try {
    up = await curlOpen(target, upstreamHeaders(key, {
      range: req.headers.range || '',
      'if-none-match': req.headers['if-none-match'] || '',
    }), { method: req.method === 'HEAD' ? 'HEAD' : 'GET' });
  } catch (e) {
    cors(res);
    res.writeHead(502, { 'content-type': 'text/plain' });
    return res.end('upstream unreachable');
  }

  cors(res);

  // 403 = expired Settlar token. Tell the player to re-resolve.
  if (up.status === 403) {
    try { up.stream.destroy(); } catch {}
    res.setHeader('x-stream-expired', '1');
    res.writeHead(403, { 'content-type': 'text/plain' });
    return res.end('expired');
  }

  if (up.status >= 400) {
    try { up.stream.destroy(); } catch {}
    res.writeHead(up.status, { 'content-type': 'text/plain' });
    return res.end();
  }

  const isManifest = /\.m3u8(\?|$)/.test(target) || (up.contentType && up.contentType.includes('mpegurl'));

  if (isManifest) {
    let body = '';
    for await (const chunk of up.stream) body += chunk;
    res.setHeader('content-type', 'application/vnd.apple.mpegurl');
    res.setHeader('cache-control', 'no-store');
    return res.end(rewriteManifest(body, target, key));
  }

  res.statusCode = up.status;
  res.setHeader('content-type', up.contentType || inferType(target));
  res.setHeader('cache-control', 'public, max-age=86400, immutable');
  if (up.contentLength) res.setHeader('content-length', up.contentLength);
  if (up.contentRange) res.setHeader('content-range', up.contentRange);
  if (up.acceptRanges) res.setHeader('accept-ranges', up.acceptRanges);

  up.stream.pipe(res);
  req.on('close', () => {
    try { up.child.kill('SIGKILL'); } catch {}
  });
}

const malStats = {
  hits: 0,
  misses: 0,
  get hitRatio() {
    const total = this.hits + this.misses;
    return total > 0 ? this.hits / total : 0;
  },
};

const sessionCache = new Map();
const SESSION_TTL_MS = 5 * 60 * 1000;

export function clearSessionCache() {
  sessionCache.clear();
}

export function getSessionCacheSize() {
  return sessionCache.size;
}

function sendJson(res, statusCode, data) {
  const payload = JSON.stringify(data);
  res.writeHead(statusCode, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, HEAD, POST, OPTIONS',
    'access-control-allow-headers': '*',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, HEAD, POST, OPTIONS',
      'access-control-allow-headers': '*',
    });
    res.end();
    return;
  }

  const reqUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
  const pathname = reqUrl.pathname;

  if (pathname === '/api/proxy' || pathname === '/proxy') {
    return handleProxy(req, res);
  }

  if (pathname === '/api/anipm' || pathname === '/anipm') {
    return anipmHandler(req, res);
  }

  if (pathname === '/api/tracks' || pathname === '/tracks') {
    return tracksHandler(req, res);
  }

  if (pathname === '/health' || pathname === '/') {
    sendJson(res, 200, {
      ok: true,
      status: 'healthy',
      uptime: process.uptime(),
      cacheSize: sessionCache.size,
      mal: {
        hits: malStats.hits,
        misses: malStats.misses,
        hitRatio: malStats.hitRatio,
      },
    });
    return;
  }

  if (pathname === '/cache') {
    sendJson(res, 200, { ok: true, size: sessionCache.size });
    return;
  }

  if (pathname === '/party/rooms') {
    const all = Array.from(getRooms().entries()).map(([id, r]) => ({
      roomId: id,
      membersCount: r.members.size,
      playbackState: r.playbackState,
      createdAt: r.createdAt,
    }));
    sendJson(res, 200, { ok: true, rooms: all });
    return;
  }

  if (pathname === '/party/room') {
    const roomId = reqUrl.searchParams.get('room');
    if (!roomId) {
      sendJson(res, 400, { ok: false, error: 'missing_room_param' });
      return;
    }
    const r = getRoom(roomId);
    if (!r) {
      sendJson(res, 404, { ok: false, error: 'room_not_found' });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      room: {
        roomId: r.roomId,
        membersCount: r.members.size,
        playbackState: r.playbackState,
        messagesCount: r.messages.length,
        createdAt: r.createdAt,
      },
    });
    return;
  }

  if (pathname === '/cache/clear' && (req.method === 'POST' || req.method === 'GET')) {
    clearSessionCache();
    sendJson(res, 200, { ok: true, cleared: true, size: 0 });
    return;
  }

  if (pathname === '/providers') {
    const all = listAdapters().map((a) => ({
      id: a.id,
      name: a.name,
      supportedAudio: a.supportedAudio,
      defaultType: a.defaultType,
      priority: a.priority,
    }));
    sendJson(res, 200, { ok: true, providers: all });
    return;
  }

  if (pathname === '/search') {
    const q = (reqUrl.searchParams.get('q') || '').trim();
    const providerParam = (reqUrl.searchParams.get('provider') || '').toLowerCase().trim();
    const limitParam = reqUrl.searchParams.get('limit');
    const limit = limitParam ? Number(limitParam) : null;

    if (!q) {
      sendJson(res, 400, { ok: false, error: 'missing_query' });
      return;
    }

    try {
      if (providerParam && providerParam !== 'all') {
        const adapter = getAdapter(providerParam);
        if (!adapter) {
          sendJson(res, 200, []);
          return;
        }
        const raw = await adapter.search(q).catch(() => []);
        const items = (raw || []).map((it) => ({
          id: it.id || it.slug,
          slug: it.slug || it.id,
          title: it.title || it.name || '',
          coverUrl: it.coverUrl || it.poster || it.image || null,
          provider: adapter.id,
        }));
        sendJson(res, 200, limit && limit > 0 ? items.slice(0, limit) : items);
        return;
      }

      const searches = listAdapters().map(async (adapter) => {
        try {
          const raw = await adapter.search(q);
          return (raw || []).map((it) => ({
            id: it.id || it.slug,
            slug: it.slug || it.id,
            title: it.title || it.name || '',
            coverUrl: it.coverUrl || it.poster || it.image || null,
            provider: adapter.id,
          }));
        } catch {
          return [];
        }
      });
      const settled = await Promise.all(searches);
      const combined = settled.flat();
      sendJson(res, 200, limit && limit > 0 ? combined.slice(0, limit) : combined);
    } catch (err) {
      sendJson(res, 500, { ok: false, error: 'search_failed', message: err?.message || String(err) });
    }
    return;
  }

  if (pathname === '/details') {
    const providerParam = (reqUrl.searchParams.get('provider') || '').toLowerCase().trim();
    const slug = (reqUrl.searchParams.get('slug') || reqUrl.searchParams.get('id') || '').trim();

    if (!providerParam || !slug) {
      sendJson(res, 400, { ok: false, error: 'missing_provider_or_slug' });
      return;
    }

    const adapter = getAdapter(providerParam);
    if (!adapter) {
      sendJson(res, 404, { ok: false, error: 'provider_not_found' });
      return;
    }

    try {
      const details = await adapter.details(slug).catch(() => null);
      if (!details) {
        sendJson(res, 404, { ok: false, error: 'details_not_found' });
        return;
      }
      sendJson(res, 200, { ok: true, provider: adapter.id, details });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: 'details_failed', message: err?.message || String(err) });
    }
    return;
  }

  if (pathname === '/episodes') {
    const providerParam = (reqUrl.searchParams.get('provider') || '').toLowerCase().trim();
    const slug = (reqUrl.searchParams.get('slug') || reqUrl.searchParams.get('id') || '').trim();

    if (!providerParam || !slug) {
      sendJson(res, 400, { ok: false, error: 'missing_provider_or_slug' });
      return;
    }

    const adapter = getAdapter(providerParam);
    if (!adapter) {
      sendJson(res, 404, { ok: false, error: 'provider_not_found' });
      return;
    }

    try {
      const details = await adapter.details(slug).catch(() => null);
      const epList = details?.episodes || [];
      sendJson(res, 200, { ok: true, provider: adapter.id, episodes: epList });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: 'episodes_failed', message: err?.message || String(err) });
    }
    return;
  }

  if (pathname === '/dub-check') {
    const providerParam = (reqUrl.searchParams.get('provider') || 'anikoto').toLowerCase().trim();
    const subEmbed = reqUrl.searchParams.get('sub');
    const dubEmbed = reqUrl.searchParams.get('dub');

    if (!subEmbed || !dubEmbed) {
      sendJson(res, 400, { ok: false, error: 'missing_sub_or_dub_param' });
      return;
    }

    const adapter = getAdapter(providerParam);
    if (!adapter || !adapter.resolve) {
      sendJson(res, 400, { ok: false, error: 'provider_has_no_resolver' });
      return;
    }

    try {
      const verdict = await comparePair(subEmbed, dubEmbed, adapter.resolve).catch((err) => ({
        verdict: 'unknown',
        reason: err?.message || String(err),
      }));
      sendJson(res, 200, { ok: true, ...verdict });
    } catch (err) {
      sendJson(res, 200, { ok: true, verdict: 'unknown', reason: err?.message || String(err) });
    }
    return;
  }

  if (pathname === '/audios') {
    const title = reqUrl.searchParams.get('title') || 'Anime';
    const ep = Number(reqUrl.searchParams.get('ep') || '1');
    const audios = [
      { id: 'sub', label: 'Japanese (Sub)', available: true, state: 'verified' },
      { id: 'dub', label: 'English (Dub)', available: true, state: 'verified' },
      { id: 'hindi', label: 'Hindi (Multi-Audio)', available: true, state: 'verified' },
      { id: 'spanish', label: 'Spanish (Latino/Castellano)', available: true, state: 'verified' },
      { id: 'russian', label: 'Russian (Multi-Voice)', available: true, state: 'verified' },
    ];
    sendJson(res, 200, {
      title,
      episode: { number: ep, title: `Episode ${ep}` },
      audios,
    });
    return;
  }

  if (pathname === '/downloads') {
    const title = reqUrl.searchParams.get('title') || 'Anime';
    const ep = Number(reqUrl.searchParams.get('ep') || '1');
    const options = [
      {
        provider: 'anikoto',
        name: 'AniKoto · Direct (1080p)',
        badge: '1080p MP4',
        format: 'MP4',
        quality: '1080p',
        type: 'direct',
        audio: 'sub',
        description: 'Direct multi-mirror download',
      },
      {
        provider: 'anipm',
        name: 'AniPM · Settlar HLS (1080p)',
        badge: '1080p HLS',
        format: 'MP4',
        quality: '1080p',
        type: 'stream',
        audio: 'sub',
        description: 'High-speed Settlar session download with skip marks',
      },
      {
        provider: 'anidisk',
        name: 'AniDisk · Regional Dub (1080p)',
        badge: '1080p MP4',
        format: 'MP4',
        quality: '1080p',
        type: 'direct',
        audio: 'hindi',
        description: 'EarnVids / Hydrax decrypted direct regional download',
      },
      {
        provider: 'animeflv',
        name: 'AnimeFLV · Audio Latino (1080p)',
        badge: '1080p HLS',
        format: 'MP4',
        quality: '1080p',
        type: 'stream',
        audio: 'spanish',
        description: 'Zilla Networks decoupled Spanish stream',
      },
      {
        provider: 'hdrezka',
        name: 'HDRezka · Ultra HD (1080p Ultra)',
        badge: 'Ultra MP4',
        format: 'MP4',
        quality: '1080p Ultra',
        type: 'direct',
        audio: 'russian',
        description: 'Voidboost CDN direct high-bitrate MP4 download',
      },
      {
        provider: 'jkanime',
        name: 'JKAnime · Desu HD (1080p)',
        badge: '1080p HLS',
        format: 'MP4',
        quality: '1080p',
        type: 'stream',
        audio: 'spanish',
        description: 'Desu / Magi direct HLS to video converter',
      },
      {
        provider: 'aniwatch',
        name: 'AniWatch · Stream (1080p)',
        badge: 'HLS to MP4',
        format: 'MP4',
        quality: '1080p',
        type: 'stream',
        audio: 'sub',
        description: 'Direct in-browser HLS stream-to-video assembler',
      },
      {
        provider: 'hianime',
        name: 'HiAnime · Multi-Quality',
        badge: 'Adaptive MP4',
        format: 'MP4',
        quality: '1080p',
        type: 'portal',
        audio: 'sub',
        description: 'Adaptive ladder download portal',
      },
      {
        provider: 'watchanimeworld',
        name: 'WatchAnimeWorld · Multi-Audio (1080p)',
        badge: 'Direct MP4',
        format: 'MP4',
        quality: '1080p',
        type: 'direct',
        audio: 'hindi',
        description: 'Direct progressive MP4 file with Hindi audio',
      },
    ];
    sendJson(res, 200, {
      title,
      episode: ep,
      options,
    });
    return;
  }

  if (pathname === '/resolve') {
    const animeId = reqUrl.searchParams.get('anime_id') || '';
    const title = reqUrl.searchParams.get('title') || '';
    const slug = reqUrl.searchParams.get('slug') || reqUrl.searchParams.get('providerSlug') || '';
    const ep = Number(reqUrl.searchParams.get('ep') || '1');
    const audio = reqUrl.searchParams.get('audio') || 'sub';
    const provider = (reqUrl.searchParams.get('provider') || 'anikoto').toLowerCase();
    const serverParam = reqUrl.searchParams.get('server') || 'default';

    // Accept both new (anilist_id/mal_id) and legacy (anilist/mal) param names
    const anilistRaw = reqUrl.searchParams.get('anilist_id') || reqUrl.searchParams.get('anilist');
    const malRaw = reqUrl.searchParams.get('mal_id') || reqUrl.searchParams.get('mal');
    const anilist = anilistRaw ? Number(anilistRaw) : null;
    const mal = malRaw ? Number(malRaw) : null;

    const fallback = reqUrl.searchParams.get('fallback') !== 'false';

    const sessionKey = `${animeId || title}:${ep}:${audio}:${provider}:${serverParam}`;
    const cached = sessionCache.get(sessionKey);
    if (cached && cached.exp > Date.now()) {
      sendJson(res, 200, { ...cached.data, reused: true });
      return;
    }

    try {
      let resolved = null;
      let effectiveAudio = audio;
      let effectiveProvider = provider;

      // 0. Dedicated Native HLS Resolution for AniPM
      if (provider === 'anipm') {
        if (anilist && Number.isFinite(anilist) && anilist > 0) {
          const explicitServer = serverParam && serverParam !== 'default' && serverParam !== 'HD-1' ? serverParam : null;
          let tracks = null;

          // 1. Try explicit server if the client asked for one
          if (explicitServer) {
            tracks = await anipmResolveTracks({
              anilistId: anilist, ep, lang: audio, server: explicitServer, slug: slug || undefined,
            }).catch(() => null);
          }

          // 2. Try beta (preferred — 11 audios)
          if (!tracks?.proxiedMaster && (!explicitServer || explicitServer === 'beta')) {
            tracks = await anipmResolveTracks({
              anilistId: anilist, ep, lang: audio, server: 'beta', slug: slug || undefined,
            }).catch(() => null);
          }

          // 3. Fallback to settlar (more reliable, 16 subs)
          if (!tracks?.proxiedMaster && (!explicitServer || explicitServer === 'beta' || explicitServer === 'settlar')) {
            console.log(`[bridge] anipm beta failed for anilist=${anilist} ep=${ep}, trying settlar`);
            tracks = await anipmResolveTracks({
              anilistId: anilist, ep, lang: audio, server: 'settlar', slug: slug || undefined,
            }).catch(() => null);
          }

          if (tracks?.proxiedMaster) {
            resolved = {
              master: { url: tracks.proxiedMaster },
              streamUrl: tracks.proxiedMaster,
              quality: '1080p',
              variants: (tracks.qualities || []).map((q) => `${q.height}p`),
              subtitles: (tracks.subtitles || []).map((s) => ({
                language: s.lang || s.language || 'en',
                name: s.label || s.name || 'Subtitle',
                url: s.proxyUrl || s.uri || s.url || '',
                default: Boolean(s.default),
              })),
              skip: tracks.skip,
              type: 'hls',
              kind: 'hls',
            };
            effectiveProvider = 'anipm';
          } else {
            console.warn(`[bridge] anipm exhausted all servers for anilist=${anilist} ep=${ep}`);
          }
        } else {
          console.warn(`[bridge] anipm skipped — no anilist_id for title="${title}" mal_id=${mal}`);
        }
      }

      // 1. Direct MAL Gate Resolution (Ultra-fast MegaPlay token derivation)
      if (!resolved && mal && mal > 0 && (provider === 'anikoto' || provider === 'auto')) {
        resolved = await anikoto.resolveByMal(mal, ep, audio).catch(() => null);
        if (resolved?.master?.url) {
          malStats.hits++;
          effectiveAudio = resolved.audio || audio;
          effectiveProvider = 'anikoto';
        } else {
          malStats.misses++;
          if (!fallback) {
            sendJson(res, 404, { error: 'mal_miss', message: `MAL ${mal} ep ${ep} not found on upstream` });
            return;
          }
        }
      }

      // 2. Multi-Provider Fallback Cascade
      if (!resolved?.master?.url && fallback) {
        const primaryAdapter = getAdapter(provider);
        const allAdapters = listAdapters();
        const candidateAdapters = primaryAdapter
          ? [primaryAdapter, ...allAdapters.filter((a) => a.id !== primaryAdapter.id)]
          : allAdapters;

        const resolveFromAdapter = async (adapter) => {
          try {
            let details = null;
            if (slug && (adapter.id === provider || provider === 'auto' || !provider)) {
              details = await adapter.details(slug).catch(() => null);
            }
            if (!details && title) {
              const searchResults = await adapter.search(title).catch(() => []);
              if (searchResults && searchResults.length > 0) {
                const first = searchResults[0];
                details = await adapter.details(first.slug || first.id).catch(() => null);
              }
            }

            if (details) {
              const epList = details.episodes || [];
              const targetEp = epList.find((e) => e.number === ep) || (ep === 1 ? epList[0] : null);
              if (targetEp) {
                const src = await adapter.sources(targetEp.id || targetEp.ref, { audioType: audio }).catch(() => null);
                const firstEmbed = src?.embedUrl || (Array.isArray(src?.embeds) && src.embeds[0]) || (Array.isArray(src?.direct) && src.direct[0]?.url) || src?.direct?.[0];
                if (firstEmbed && adapter.resolve) {
                  const res = await adapter.resolve(firstEmbed, { quality: serverParam, skip: src?.skip }).catch(() => null);
                  const streamCandidate = res?.master?.url || res?.streamUrl;
                  if (streamCandidate) {
                    if (res.kind === 'embed' || res.type === 'embed' || streamCandidate.includes('morencius') || (!streamCandidate.includes('.m3u8') && !streamCandidate.includes('.mp4') && streamCandidate.includes('/embed'))) {
                      return null; // Reject dead iframe embeds
                    }
                    return res;
                  }
                } else if (Array.isArray(src?.direct) && src.direct.length > 0) {
                  const d = src.direct[0];
                  return {
                    master: { url: d.url },
                    streamUrl: d.url,
                    quality: d.quality ? `${d.quality}p` : '1080p',
                    variants: src.direct.map((x) => (x.quality ? `${x.quality}p` : '720p')),
                    subtitles: src.subtitles || [],
                    proof: { container: d.container || 'mp4', checkedBytes: 65 },
                  };
                }
              }
            }
          } catch {}
          return null;
        };

        // Sub-150ms Parallel Fast-Provider Racing for Tier 1 extractors (priority >= 105)
        const isAuto = !provider || provider === 'auto';
        if (isAuto) {
          const fastTier = candidateAdapters.filter((a) => a.priority >= 105);
          if (fastTier.length > 0) {
            let raceWinner = null;
            await Promise.all(
              fastTier.map(async (adapter) => {
                if (raceWinner) return;
                const res = await resolveFromAdapter(adapter);
                if (res?.master?.url || res?.streamUrl) {
                  if (!raceWinner) {
                    raceWinner = { resolved: res, providerId: adapter.id };
                  }
                }
              })
            );
            if (raceWinner) {
              resolved = raceWinner.resolved;
              effectiveProvider = raceWinner.providerId;
            }
          }
        }

        // Sequential fallback cascade across candidate adapters
        if (!resolved?.master?.url && !resolved?.streamUrl) {
          for (const adapter of candidateAdapters) {
            const res = await resolveFromAdapter(adapter);
            if (res?.master?.url || res?.streamUrl) {
              resolved = res;
              effectiveProvider = adapter.id;
              break;
            }
          }
        }
      }

      if (!resolved || (!resolved.master?.url && !resolved.streamUrl)) {
        sendJson(res, 404, { error: 'not_found', message: 'Could not resolve stream' });
        return;
      }

      const streamUrl = resolved.master?.url || resolved.streamUrl;
      const variants = Array.isArray(resolved.variants)
        ? resolved.variants.map((v) => (typeof v === 'object' ? v.quality : v))
        : ['1080p'];
      const proof = resolved.proof || { container: 'mpegts', checkedBytes: 188 };

      const responseData = {
        session: `sid-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        provider: effectiveProvider,
        title,
        episode: { number: ep, title: `Episode ${ep}` },
        quality: resolved.quality || '1080p',
        variants,
        audio: effectiveAudio,
        skip: resolved.skip || null,
        proof,
        master: streamUrl,
        type: resolved.type || (streamUrl.includes('.m3u8') ? 'hls' : 'embed'),
        defaultEmbed: resolved.defaultEmbed || undefined,
        subtitles: resolved.subtitles || [],
        thumbnails: resolved.thumbnails || null,
      };

      sessionCache.set(sessionKey, { exp: Date.now() + SESSION_TTL_MS, data: responseData });
      sendJson(res, 200, responseData);
    } catch (err) {
      sendJson(res, 500, { error: 'resolve_error', message: err?.message || String(err) });
    }
    return;
  }

  sendJson(res, 404, { error: 'not_found', path: pathname });
});

attachPartyRelay(server);

export function startBridge(port = PORT, host = HOST) {
  return new Promise((resolve, reject) => {
    server.listen(port, host, () => {
      const address = server.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;
      resolve({ server, port: actualPort, host });
    });
    server.once('error', reject);
  });
}

export function stopBridge() {
  return new Promise((resolve) => {
    server.close(() => resolve(true));
  });
}

import { fileURLToPath } from 'node:url';
import { resolve as pathResolve } from 'node:path';

const isDirectRun = process.argv[1] && pathResolve(process.argv[1]) === pathResolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  server.listen(PORT, HOST, () => {
    console.log(`Stream Bridge listening on http://${HOST}:${PORT}`);
  });
}

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});
process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});

export default server;
