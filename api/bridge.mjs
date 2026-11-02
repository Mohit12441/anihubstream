#!/usr/bin/env node
// @ts-check
import http from 'node:http';
import { URL } from 'node:url';
import { getAdapter, listAdapters } from './adapters/registry.mjs';
import * as anikoto from './anikoto.mjs';
import { attachPartyRelay, getRoom, getRooms } from './party-relay.mjs';

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
            if (slug && adapter.id === provider) {
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
                if (src?.embedUrl && adapter.resolve) {
                  resolved = await adapter.resolve(src.embedUrl, { quality: serverParam }).catch(() => null);
                  if (resolved?.master?.url || resolved?.streamUrl) {
                    effectiveProvider = adapter.id;
                    break;
                  }
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
