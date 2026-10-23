// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet as resolveServer } from '../functions/api/play/resolve.js';
import { onRequest as proxyHandler, rewriteM3u8 } from '../functions/api/proxy.js';
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

    it('rejects unauthorized destination domains with 403', async () => {
      const req = new Request('http://localhost/api/proxy?url=https://malicious-unauthorized-domain.com/stream.m3u8');
      const res = await proxyHandler({ request: req });
      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.strictEqual(data.error, 'forbidden');
      assert.ok(data.message.includes('not authorized'));
    });

    it('rejects private IP addresses and loopback destinations with 403', async () => {
      const loopbackReq = new Request('http://localhost/api/proxy?url=http://127.0.0.1:8080/secret');
      const loopbackRes = await proxyHandler({ request: loopbackReq });
      assert.strictEqual(loopbackRes.status, 403);

      const metaReq = new Request('http://localhost/api/proxy?url=http://169.254.169.254/latest/meta-data/');
      const metaRes = await proxyHandler({ request: metaReq });
      assert.strictEqual(metaRes.status, 403);

      const lanReq = new Request('http://localhost/api/proxy?url=http://192.168.1.1/admin');
      const lanRes = await proxyHandler({ request: lanReq });
      assert.strictEqual(lanRes.status, 403);
    });

    it('preserves ad cue tags (#EXT-X-CUE-OUT/IN) and discontinuities without stripping them', async () => {
      const originalFetch = globalThis.fetch;
      // @ts-ignore
      globalThis.fetch = async () => {
        return new Response(
          `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-CUE-OUT:DURATION=30\n#EXT-X-DISCONTINUITY\n#EXTINF:6.000,\nad-seg-1.ts\n#EXT-X-CUE-IN\n#EXTINF:6.000,\nseg-2.ts\n#EXT-X-ENDLIST\n`,
          { status: 200, headers: { 'content-type': 'application/vnd.apple.mpegurl' } }
        );
      };

      try {
        const req = new Request('http://localhost/api/proxy?url=https://cdn.example.com/playlist.m3u8');
        const res = await proxyHandler({ request: req });
        assert.strictEqual(res.status, 200);
        const body = await res.text();
        assert.ok(body.includes('#EXT-X-CUE-OUT:DURATION=30'), 'Must preserve #EXT-X-CUE-OUT tag');
        assert.ok(body.includes('#EXT-X-DISCONTINUITY'), 'Must preserve #EXT-X-DISCONTINUITY tag');
        assert.ok(body.includes('#EXT-X-CUE-IN'), 'Must preserve #EXT-X-CUE-IN tag');
        assert.ok(body.includes('ad-seg-1.ts'), 'Must preserve ad segment line with proxy rewriting');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('caches immutable video segments in Cache API and returns X-Edge-Cache: HIT on subsequent requests', async () => {
      const originalFetch = globalThis.fetch;
      const originalCaches = globalThis.caches;

      const cacheStore = new Map();
      // @ts-ignore
      globalThis.caches = {
        default: {
          match: async (req) => {
            const url = req.url || req;
            const item = cacheStore.get(url);
            return item ? item.clone() : null;
          },
          put: async (req, res) => {
            const url = req.url || req;
            cacheStore.set(url, res.clone());
          },
        },
      };

      let fetchCount = 0;
      // @ts-ignore
      globalThis.fetch = async () => {
        fetchCount++;
        return new Response(new Uint8Array([0x00, 0x01, 0x02, 0x03]), {
          status: 200,
          headers: {
            'content-type': 'video/mp2t',
            'content-length': '4',
          },
        });
      };

      try {
        const segmentUrl = 'http://localhost/api/proxy?url=https://cdn.example.com/stream/seg-100.ts';

        // 1st request: Cache MISS -> fetch called
        const req1 = new Request(segmentUrl);
        let waitPromise = null;
        const res1 = await proxyHandler({
          request: req1,
          waitUntil: (p) => { waitPromise = p; },
        });
        if (waitPromise) await waitPromise;

        assert.strictEqual(res1.status, 200);
        assert.strictEqual(res1.headers.get('X-Edge-Cache'), 'MISS');
        assert.strictEqual(fetchCount, 1);

        // 2nd request: Cache HIT -> fetch not called
        const req2 = new Request(segmentUrl);
        const res2 = await proxyHandler({ request: req2 });

        assert.strictEqual(res2.status, 200);
        assert.strictEqual(res2.headers.get('X-Edge-Cache'), 'HIT');
        assert.strictEqual(fetchCount, 1, 'Upstream fetch should not be called on cache HIT');
      } finally {
        globalThis.fetch = originalFetch;
        // @ts-ignore
        globalThis.caches = originalCaches;
      }
    });

    it('bypasses Cache API and sets X-Edge-Cache: BYPASS for Range requests', async () => {
      const originalFetch = globalThis.fetch;
      const originalCaches = globalThis.caches;

      let putCalled = false;
      // @ts-ignore
      globalThis.caches = {
        default: {
          match: async () => null,
          put: async () => { putCalled = true; },
        },
      };

      // @ts-ignore
      globalThis.fetch = async () => {
        return new Response(new Uint8Array([0x00, 0x01]), {
          status: 206,
          headers: {
            'content-type': 'video/mp2t',
            'content-range': 'bytes 0-1/100',
            'content-length': '2',
            'accept-ranges': 'bytes',
          },
        });
      };

      try {
        const req = new Request('http://localhost/api/proxy?url=https://cdn.example.com/stream/seg-range.ts', {
          headers: { Range: 'bytes=0-1' },
        });
        const res = await proxyHandler({ request: req });

        assert.strictEqual(res.status, 206);
        assert.strictEqual(res.headers.get('X-Edge-Cache'), 'BYPASS');
        assert.strictEqual(res.headers.get('Content-Range'), 'bytes 0-1/100');
        assert.strictEqual(putCalled, false, 'Must never put 206 Partial Content into caches.default');
      } finally {
        globalThis.fetch = originalFetch;
        // @ts-ignore
        globalThis.caches = originalCaches;
      }
    });

    it('serves manifest cleanly in raw mode (raw=1) with 0ms CPU rewrite overhead', async () => {
      const rawManifest = '#EXTM3U\n#EXTINF:6.0,\nseg1.ts\n#EXT-X-ENDLIST';
      const originalFetch = globalThis.fetch;
      // @ts-ignore
      globalThis.fetch = async () => {
        return new Response(rawManifest, {
          status: 200,
          headers: { 'content-type': 'application/vnd.apple.mpegurl' },
        });
      };

      try {
        const req = new Request('http://localhost/api/proxy?url=https://cdn.example.com/stream.m3u8&raw=1');
        const res = await proxyHandler({ request: req });

        assert.strictEqual(res.status, 200);
        const text = await res.text();
        assert.strictEqual(text, rawManifest, 'Raw mode must return manifest untouched');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('block-based parser excises ad URIs and #EXTINF while preserving #EXT-X-DISCONTINUITY integrity', () => {
      const sample = [
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        '#EXTINF:6.000,',
        'video-0.ts',
        '#EXT-X-DISCONTINUITY',
        '#EXTINF:3.000,',
        'https://googleads.doubleclick.net/ad-0.ts',
        '#EXTINF:3.000,',
        'https://googleads.doubleclick.net/ad-1.ts',
        '#EXT-X-DISCONTINUITY',
        '#EXTINF:6.000,',
        'video-1.ts',
        '#EXT-X-ENDLIST',
      ].join('\n');

      const parsed = rewriteM3u8(sample, 'https://cdn.example.com/playlist.m3u8', '', '/api/proxy', { filterAds: true });

      // Must not contain ad URLs
      assert.ok(!parsed.includes('googleads.doubleclick.net'), 'Ad URLs must be removed');
      // Must not have duplicate adjacent discontinuities
      assert.ok(!parsed.includes('#EXT-X-DISCONTINUITY\n#EXT-X-DISCONTINUITY'), 'Must collapse duplicate discontinuities');
      // Must contain video segments
      assert.ok(parsed.includes('video-0.ts'), 'Must preserve video 0');
      assert.ok(parsed.includes('video-1.ts'), 'Must preserve video 1');
      // Must contain exactly one discontinuity separating the two video segments
      const discontCount = (parsed.match(/#EXT-X-DISCONTINUITY/g) || []).length;
      assert.strictEqual(discontCount, 1, 'Must have exactly one discontinuity between non-ad segments');
    });

    it('Audio Track Safety: explicitly preserves #EXT-X-MEDIA audio/subtitle tags and only strips video .ts blocks', () => {
      const sample = [
        '#EXTM3U',
        '#EXT-X-VERSION:4',
        '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio-main",NAME="Japanese",DEFAULT=YES,AUTOSELECT=YES,LANGUAGE="ja",URI="https://cdn.example.com/audio/ja.m3u8"',
        '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio-main",NAME="English",DEFAULT=NO,AUTOSELECT=YES,LANGUAGE="en",URI="https://cdn.example.com/audio/en.m3u8"',
        '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",DEFAULT=YES,LANGUAGE="en",URI="https://cdn.example.com/subs/en.vtt"',
        '#EXTINF:6.000,',
        'video-01.ts',
        '#EXT-X-DISCONTINUITY',
        '#EXTINF:3.000,',
        'https://googleads.doubleclick.net/ad-video.ts',
        '#EXTINF:6.000,',
        'video-02.ts',
      ].join('\n');

      const parsed = rewriteM3u8(sample, 'https://cdn.example.com/master.m3u8', '', '/api/proxy', { filterAds: true });

      // All #EXT-X-MEDIA audio and subtitle tags must be retained with rewritten URIs
      assert.ok(parsed.includes('#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio-main",NAME="Japanese"'), 'Japanese audio track preserved');
      assert.ok(parsed.includes('#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio-main",NAME="English"'), 'English audio track preserved');
      assert.ok(parsed.includes('#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English"'), 'English subtitle track preserved');
      assert.ok(parsed.includes('/api/proxy?url=' + encodeURIComponent('https://cdn.example.com/audio/ja.m3u8')), 'Audio URI rewritten to proxy');

      // Ad video .ts segment stripped, non-ad video segments retained
      assert.ok(!parsed.includes('ad-video.ts'), 'Ad video .ts segment stripped');
      assert.ok(parsed.includes('video-01.ts'), 'Video segment 1 retained');
      assert.ok(parsed.includes('video-02.ts'), 'Video segment 2 retained');
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
        assert.strictEqual(data.count, 4);
        assert.ok(data.providers.anikoto);
        assert.ok(data.providers.hianime);
        assert.ok(data.providers.aniwatch);
        assert.ok(!data.providers.animedubhindi);
        assert.strictEqual(data.providers.anikoto[0].title, 'Naruto (anikoto)');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('Universal Server Fetching & Sub/Dub Filtering', () => {
    it('functions/api/play/resolve.js resolves dub server cleanly and sets audio to dub', async () => {
      const originalFetch = globalThis.fetch;
      let requestedUrl = '';
      // @ts-ignore
      globalThis.fetch = async (url) => {
        requestedUrl = url.toString();
        return new Response(JSON.stringify({
          master: '/stream/hianime-dub-session/master.m3u8',
          provider: 'hianime',
          audio: 'dub',
          kind: 'hls',
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      };

      try {
        const req = new Request('http://localhost/api/play/resolve?title=Attack%20on%20Titan&ep=1&provider=hianime&server=HD-1-dub');
        const env = { STREAM_BRIDGE_URL: 'http://127.0.0.1:8795' };
        const res = await resolveServer({ request: req, env });
        assert.strictEqual(res.status, 200);

        const data = await res.json();
        assert.strictEqual(data.server.provider, 'hianime');
        assert.strictEqual(data.server.audio, 'dub');
        assert.strictEqual(data.server.name, 'HiAnime · HD-1');
        assert.ok(requestedUrl.includes('audio=dub'));
        assert.ok(requestedUrl.includes('server=HD-1'));
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
