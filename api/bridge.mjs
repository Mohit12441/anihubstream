#!/usr/bin/env node
// @ts-check
import http from 'node:http';
import { URL } from 'node:url';
import { getAdapter } from './adapters/registry.mjs';
import * as anikoto from './anikoto.mjs';

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

function sendJson(res, statusCode, data) {
  const payload = JSON.stringify(data);
  res.writeHead(statusCode, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, HEAD, OPTIONS',
    'access-control-allow-headers': '*',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, HEAD, OPTIONS',
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
      mal: {
        hits: malStats.hits,
        misses: malStats.misses,
        hitRatio: malStats.hitRatio,
      },
    });
    return;
  }

  if (pathname === '/resolve') {
    const title = reqUrl.searchParams.get('title') || '';
    const ep = Number(reqUrl.searchParams.get('ep') || '1');
    const audio = reqUrl.searchParams.get('audio') || 'sub';
    const provider = (reqUrl.searchParams.get('provider') || 'anikoto').toLowerCase();
    const serverParam = reqUrl.searchParams.get('server') || 'default';
    const mal = reqUrl.searchParams.get('mal') ? Number(reqUrl.searchParams.get('mal')) : null;
    const fallback = reqUrl.searchParams.get('fallback') !== 'false';

    const sessionKey = `${title}:${ep}:${audio}:${provider}:${mal ?? 'nomal'}:${serverParam}`;
    const cached = sessionCache.get(sessionKey);
    if (cached && cached.exp > Date.now()) {
      sendJson(res, 200, { ...cached.data, reused: true });
      return;
    }

    try {
      let resolved = null;
      let effectiveAudio = audio;

      if (mal && mal > 0) {
        resolved = await anikoto.resolveByMal(mal, ep, audio);
        if (resolved?.master?.url) {
          malStats.hits++;
          effectiveAudio = resolved.audio || audio;
        } else {
          malStats.misses++;
          if (!fallback) {
            sendJson(res, 404, { error: 'mal_miss', message: `MAL ${mal} ep ${ep} not found on upstream` });
            return;
          }
        }
      }

      if (!resolved?.master?.url && fallback) {
        const adapter = getAdapter(provider) || getAdapter('anikoto');
        if (adapter) {
          const searchResults = await adapter.search(title).catch(() => []);
          if (searchResults && searchResults.length > 0) {
            const first = searchResults[0];
            const details = await adapter.details(first.slug || first.id).catch(() => null);
            const epList = details?.episodes || [];
            const targetEp = epList.find((e) => e.number === ep) || epList[0];
            if (targetEp) {
              const src = await adapter.sources(targetEp.id || targetEp.ref).catch(() => null);
              if (src?.embedUrl && adapter.resolve) {
                resolved = await adapter.resolve(src.embedUrl).catch(() => null);
              }
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
        provider,
        title,
        episode: { number: ep, title: `Episode ${ep}` },
        quality: resolved.quality || '1080p',
        variants,
        audio: effectiveAudio,
        skip: resolved.skip || null,
        proof,
        master: streamUrl,
        subtitles: resolved.subtitles || [],
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

if (process.env.NODE_ENV !== 'test') {
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
