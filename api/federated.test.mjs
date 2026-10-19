// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet as resolveServer } from '../functions/api/play/resolve.js';
import { onRequest as proxyHandler } from '../functions/api/proxy.js';
import { onRequestGet as searchFederated } from '../functions/api/search.js';

describe('Federated Architecture: Edge Services & Proxy Tests', () => {
  describe('functions/api/play/resolve.js', () => {
    it('rejects requests without title parameter with 400', async () => {
      const req = new Request('http://localhost/api/play/resolve?ep=1');
      const env = { STREAM_BRIDGE_URL: 'http://127.0.0.1:8795' };
      const res = await resolveServer({ request: req, env });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.error, 'bad_request');
    });

    it('resolves individual secondary server cleanly', async () => {
      const originalFetch = globalThis.fetch;
      // @ts-ignore
      globalThis.fetch = async (url) => {
        const u = url.toString();
        if (u.includes('/resolve')) {
          return new Response(JSON.stringify({
            session: 'sid-lazy-1',
            provider: 'hianime',
            kind: 'hls',
            title: 'Frieren',
            quality: '1080p',
            master: '/stream/sid-lazy-1/master.m3u8',
            subtitles: [
              { language: 'en', name: 'English', url: '/stream/sid-lazy-1/sub/0.vtt' },
            ],
            downloads: [],
          }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return originalFetch(url);
      };

      try {
        const req = new Request('http://localhost/api/play/resolve?title=Frieren&ep=1&provider=hianime&server=server-2');
        const env = { STREAM_BRIDGE_URL: 'http://127.0.0.1:8795' };
        const res = await resolveServer({ request: req, env });
        assert.strictEqual(res.status, 200);

        const data = await res.json();
        assert.ok(data.server);
        assert.strictEqual(data.server.provider, 'hianime');
        assert.strictEqual(data.server.name, 'HiAnime · server-2');
        assert.strictEqual(data.server.status, 'ready');
        assert.strictEqual(data.server.streamUrl, 'http://127.0.0.1:8795/stream/sid-lazy-1/master.m3u8');
        assert.strictEqual(data.server.subtitles.length, 1);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('functions/api/proxy.js', () => {
    it('handles CORS preflight OPTIONS request with 204 and open headers', async () => {
      const req = new Request('http://localhost/api/proxy?url=https://example.com/stream.m3u8', {
        method: 'OPTIONS',
      });
      const res = await proxyHandler({ request: req });
      assert.strictEqual(res.status, 204);
      assert.strictEqual(res.headers.get('access-control-allow-origin'), '*');
      assert.ok(res.headers.get('access-control-allow-methods')?.includes('GET'));
    });

    it('rejects requests missing url with 400', async () => {
      const req = new Request('http://localhost/api/proxy');
      const res = await proxyHandler({ request: req });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.error, 'bad_request');
    });

    it('rewrites .m3u8 playlist URIs and key tags through the proxy', async () => {
      const originalFetch = globalThis.fetch;
      // @ts-ignore
      globalThis.fetch = async (url) => {
        return new Response(
          `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-KEY:METHOD=AES-128,URI="enc.key"\n#EXTINF:6.000,\nseg-0.ts\n#EXTINF:6.000,\nseg-1.ts\n#EXT-X-ENDLIST\n`,
          {
            status: 200,
            headers: {
              'content-type': 'application/vnd.apple.mpegurl',
            },
          }
        );
      };

      try {
        const req = new Request('http://localhost/api/proxy?url=https://cdn.example.com/live/playlist.m3u8');
        const res = await proxyHandler({ request: req });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.headers.get('content-type'), 'application/vnd.apple.mpegurl; charset=utf-8');
        assert.strictEqual(res.headers.get('access-control-allow-origin'), '*');

        const body = await res.text();
        assert.ok(body.includes('/api/proxy?url=https%3A%2F%2Fcdn.example.com%2Flive%2Fenc.key'));
        assert.ok(body.includes('/api/proxy?url=https%3A%2F%2Fcdn.example.com%2Flive%2Fseg-0.ts'));
        assert.ok(body.includes('/api/proxy?url=https%3A%2F%2Fcdn.example.com%2Flive%2Fseg-1.ts'));
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('functions/api/search.js', () => {
    it('rejects search queries missing q with 400', async () => {
      const req = new Request('http://localhost/api/search');
      const env = { STREAM_BRIDGE_URL: 'http://127.0.0.1:8795' };
      const res = await searchFederated({ request: req, env });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.error, 'bad_request');
    });

    it('fans out queries across providers and groups results', async () => {
      const originalFetch = globalThis.fetch;
      // @ts-ignore
      globalThis.fetch = async (url) => {
        const u = new URL(url.toString());
        const prov = u.searchParams.get('provider') || '';
        return new Response(JSON.stringify([
          { id: `${prov}-item-1`, slug: `${prov}-item-1`, title: `Naruto (${prov})`, coverUrl: 'https://example.com/cover.jpg' },
        ]), { status: 200, headers: { 'content-type': 'application/json' } });
      };

      try {
        const req = new Request('http://localhost/api/search?q=naruto');
        const env = { STREAM_BRIDGE_URL: 'http://127.0.0.1:8795' };
        const res = await searchFederated({ request: req, env });
        assert.strictEqual(res.status, 200);

        const data = await res.json();
        assert.strictEqual(data.query, 'naruto');
        assert.strictEqual(data.count, 5);
        assert.ok(data.providers.anikoto);
        assert.ok(data.providers.hianime);
        assert.ok(data.providers.aniwatch);
        assert.strictEqual(data.providers.anikoto[0].title, 'Naruto (anikoto)');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
