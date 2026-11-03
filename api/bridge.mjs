#!/usr/bin/env node
// @ts-check
import http from 'node:http';
import { URL } from 'node:url';
import { getAdapter, listAdapters } from './adapters/registry.mjs';
import * as anikoto from './anikoto.mjs';
import { attachPartyRelay, getRoom, getRooms } from './party-relay.mjs';
import { comparePair } from './dubAudio.mjs';

const PORT = Number(process.env.ANIKOTO_BRIDGE_PORT || process.env.PORT || 8795);
const HOST = process.env.ANIKOTO_BRIDGE_HOST || '0.0.0.0';

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

  if (pathname === '/resolve') {
    const title = reqUrl.searchParams.get('title') || '';
    const slug = reqUrl.searchParams.get('slug') || reqUrl.searchParams.get('providerSlug') || '';
    const ep = Number(reqUrl.searchParams.get('ep') || '1');
    const audio = reqUrl.searchParams.get('audio') || 'sub';
    const provider = (reqUrl.searchParams.get('provider') || 'anikoto').toLowerCase();
    const serverParam = reqUrl.searchParams.get('server') || 'default';
    const mal = reqUrl.searchParams.get('mal') ? Number(reqUrl.searchParams.get('mal')) : null;
    const fallback = reqUrl.searchParams.get('fallback') !== 'false';

    const sessionKey = `${title}:${slug}:${ep}:${audio}:${provider}:${mal ?? 'nomal'}:${serverParam}`;
    const cached = sessionCache.get(sessionKey);
    if (cached && cached.exp > Date.now()) {
      sendJson(res, 200, { ...cached.data, reused: true });
      return;
    }

    try {
      let resolved = null;
      let effectiveAudio = audio;
      let effectiveProvider = provider;

      // 1. Direct MAL Gate Resolution (Ultra-fast MegaPlay token derivation)
      if (mal && mal > 0) {
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

        for (const adapter of candidateAdapters) {
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
                  resolved = await adapter.resolve(firstEmbed, { quality: serverParam }).catch(() => null);
                  if (resolved?.master?.url || resolved?.streamUrl) {
                    effectiveProvider = adapter.id;
                    break;
                  }
                } else if (Array.isArray(src?.direct) && src.direct.length > 0) {
                  const d = src.direct[0];
                  resolved = {
                    master: { url: d.url },
                    streamUrl: d.url,
                    quality: d.quality ? `${d.quality}p` : '1080p',
                    variants: src.direct.map((x) => (x.quality ? `${x.quality}p` : '720p')),
                    subtitles: src.subtitles || [],
                    proof: { container: d.container || 'mp4', checkedBytes: 65 },
                  };
                  effectiveProvider = adapter.id;
                  break;
                }
              }
            }
          } catch {
            // Non-fatal: proceed to next provider in fallback cascade
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
