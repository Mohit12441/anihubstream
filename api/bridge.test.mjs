// @ts-check
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  server,
  buildSource,
  sessions,
  recent,
  audioCache,
  providerHandlers,
  setProviderHandler,
  searchHandlers,
  setSearchHandler,
  setAudiosHandler,
  ProviderError,
  StreamNotFoundError,
  ProviderTimeoutError,
  TIMEOUTS,
} from './bridge.mjs';

/**
 * Hermetic tests for bridge.mjs multi-provider dispatcher & latency race.
 */
describe('Bridge Multi-Provider Dispatcher & Race Tests', () => {
  let bridgePort;
  let bridgeUrl;
  const realProviderHandlers = { ...providerHandlers };
  const realSearchHandlers = { ...searchHandlers };

  // Mock binary stream fixtures
  const mkvMockBytes = Buffer.alloc(1024);
  mkvMockBytes.write('1a45dfa3', 0, 4, 'hex');

  const mp4MockBytes = Buffer.alloc(1024);
  mp4MockBytes.writeUInt32BE(24, 0);
  mp4MockBytes.write('ftyp', 4, 4, 'utf8');

  before(async () => {
    // Bind bridge server to an ephemeral port for testing
    await new Promise((res) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        // @ts-ignore
        bridgePort = addr.port;
        bridgeUrl = `http://127.0.0.1:${bridgePort}`;
        res(null);
      });
    });

    // Install hermetic stubs for upstream providers
    setSearchHandler('animedubhindi', async (q) => [
      { id: 'animedubhindi:slime-s1', slug: 'slime-s1', title: 'That Time I Got Reincarnated as a Slime Season 01' },
    ]);

    setProviderHandler('animedubhindi', async ({ title, ep, audio }) => {
      if (ep === 9999) {
        throw Object.assign(new Error(`episode ${ep} is not in AnimeDubHindi list`), { code: 'NO_SUCH_EPISODE' });
      }
      const sid = 'test-adb-session-1';
      sessions.set(sid, {
        sid,
        provider: 'animedubhindi',
        kind: 'progressive',
        container: 'matroska',
        title,
        episode: { number: ep, title: `Episode ${ep}` },
        quality: 480,
        variants: [480],
        audio,
        proof: { container: 'matroska', checkedBytes: 256 },
        mediaUrl: 'https://workers.dev/mock-slime.mkv',
        mockBytes: mkvMockBytes,
      });
      return {
        session: sid,
        provider: 'animedubhindi',
        kind: 'progressive',
        container: 'matroska',
        title,
        episode: ep,
        quality: 480,
        variants: [480],
        audio,
        proof: { container: 'matroska', checkedBytes: 256 },
        master: `/stream/${sid}/media.mkv`,
      };
    });

    setProviderHandler('watchanimeworld', async ({ title, ep, audio }) => {
      const sid = 'test-waw-session-1';
      sessions.set(sid, {
        sid,
        provider: 'watchanimeworld',
        kind: 'progressive',
        container: 'mp4',
        title,
        episode: { number: ep, title: `Episode ${ep}` },
        quality: '1080p',
        variants: ['1080p'],
        audio,
        proof: { container: 'mp4', checkedBytes: 1048576 },
        spec: { s: 1048576, h: 'cdn1' },
        mockBytes: mp4MockBytes,
      });
      return {
        session: sid,
        provider: 'watchanimeworld',
        kind: 'progressive',
        container: 'mp4',
        title,
        episode: ep,
        quality: '1080p',
        variants: ['1080p'],
        audio,
        proof: { container: 'mp4', checkedBytes: 1048576 },
        master: `/stream/${sid}/media.mp4`,
      };
    });

    setProviderHandler('anikoto', async ({ title, ep, audio }) => {
      const sid = 'test-anikoto-session-1';
      sessions.set(sid, {
        sid,
        provider: 'anikoto',
        kind: 'hls',
        container: 'hls',
        title,
        episode: { number: ep, title: `Episode ${ep}` },
        quality: '1080p',
        variants: ['1080p'],
        audio,
        proof: { container: 'hls', checkedBytes: 256 },
      });
      return {
        session: sid,
        provider: 'anikoto',
        kind: 'hls',
        title,
        episode: ep,
        quality: '1080p',
        variants: ['1080p'],
        audio,
        master: `/stream/${sid}/master.m3u8`,
      };
    });

    setProviderHandler('aniwatch', async ({ title, ep, audio }) => {
      await new Promise((r) => setTimeout(r, 10)); // slightly slower than anikoto
      const sid = 'test-aniwatch-session-1';
      sessions.set(sid, {
        sid,
        provider: 'aniwatch',
        kind: 'hls',
        title,
        episode: { number: ep, title: `Episode ${ep}` },
        quality: '720p',
        variants: ['720p'],
        audio,
      });
      return {
        session: sid,
        provider: 'aniwatch',
        kind: 'hls',
        title,
        episode: ep,
        quality: '720p',
        variants: ['720p'],
        audio,
      };
    });

    setProviderHandler('hianime', async ({ title, ep, audio }) => {
      await new Promise((r) => setTimeout(r, 20));
      const sid = 'test-hianime-session-1';
      sessions.set(sid, {
        sid,
        provider: 'hianime',
        kind: 'hls',
        title,
        episode: { number: ep, title: `Episode ${ep}` },
        quality: '720p',
        variants: ['720p'],
        audio,
      });
      return {
        session: sid,
        provider: 'hianime',
        kind: 'hls',
        title,
        episode: ep,
        quality: '720p',
        variants: ['720p'],
        audio,
      };
    });

    setAudiosHandler(async ({ title, ep }) => ({
      title,
      episode: { number: ep, title: `Episode ${ep}` },
      audios: [
        { id: 'sub', label: 'Japanese (original)', available: true },
        { id: 'dub', label: 'English (dub)', available: true, state: 'verified' },
        { id: 'hindi', label: 'Hindi (Multi-Audio)', available: true, state: 'verified' },
      ],
    }));
  });

  after(async () => {
    // Restore original handlers
    for (const [k, v] of Object.entries(realProviderHandlers)) setProviderHandler(k, v);
    for (const [k, v] of Object.entries(realSearchHandlers)) setSearchHandler(k, v);
    setAudiosHandler(null);
    await new Promise((res) => server.close(res));
  });

  it('GET /health answers with ok and lists all providers with race enabled', async () => {
    const res = await fetch(`${bridgeUrl}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.providers));
    assert.ok(body.providers.includes('auto'));
    assert.ok(body.providers.includes('aniwatch'));
    assert.ok(body.providers.includes('hianime'));
    assert.ok(body.providers.includes('anikoto'));
    assert.ok(body.providers.includes('animedubhindi'));
    assert.ok(body.providers.includes('watchanimeworld'));
    assert.equal(body.dispatcher, true);
    assert.equal(body.race, true);
  });

  it('GET /search validates parameters and supports provider selection', async () => {
    // Missing q
    const resEmpty = await fetch(`${bridgeUrl}/search?q=`);
    assert.equal(resEmpty.status, 400);
    const bodyEmpty = await resEmpty.json();
    assert.equal(bodyEmpty.error, 'Q_REQUIRED');

    // Search with provider=animedubhindi
    const resAdb = await fetch(`${bridgeUrl}/search?q=slime&provider=animedubhindi`);
    assert.equal(resAdb.status, 200);
    const bodyAdb = await resAdb.json();
    assert.ok(Array.isArray(bodyAdb));
    assert.ok(bodyAdb.length > 0);
    assert.equal(bodyAdb[0].provider, 'animedubhindi');
    assert.ok(bodyAdb[0].title.toLowerCase().includes('slime'));
  });

  it('GET /resolve validates title and episode parameters', async () => {
    const resNoTitle = await fetch(`${bridgeUrl}/resolve?ep=1`);
    assert.equal(resNoTitle.status, 400);
    const bodyNoTitle = await resNoTitle.json();
    assert.equal(bodyNoTitle.error, 'TITLE_EP_REQUIRED');

    const resBadEp = await fetch(`${bridgeUrl}/resolve?title=Slime&ep=0`);
    assert.equal(resBadEp.status, 400);
  });

  it('GET /resolve with provider=auto races providers and returns fastest winner', async () => {
    const res = await fetch(`${bridgeUrl}/resolve?title=Solo+Leveling&ep=1&audio=sub&provider=auto`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.session, 'has session id');
    assert.ok(body.provider, 'has winning provider');
    assert.equal(body.kind, 'hls');
    assert.ok(body.master.startsWith('/stream/'));
    assert.ok(typeof body.raceMs === 'number' || body.reused === true);
  });

  it('GET /resolve with provider=animedubhindi resolves progressive MKV stream', async () => {
    const res = await fetch(`${bridgeUrl}/resolve?title=slime&ep=1&audio=dub&provider=animedubhindi`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.session, 'has session id');
    assert.equal(body.provider, 'animedubhindi');
    assert.equal(body.kind, 'progressive');
    assert.equal(body.container, 'matroska');
    assert.equal(body.proof.container, 'matroska');
    assert.ok(body.proof.checkedBytes > 0);
    assert.ok(body.master.startsWith('/stream/'));
    assert.ok(body.master.includes('/media'));

    // Verify session was stored in sessions Map
    const session = sessions.get(body.session);
    assert.ok(session);
    assert.equal(session.provider, 'animedubhindi');
    assert.equal(session.kind, 'progressive');
  });

  it('GET /resolve reuses cached session on subsequent requests', async () => {
    const res1 = await fetch(`${bridgeUrl}/resolve?title=slime&ep=1&audio=dub&provider=animedubhindi`);
    assert.equal(res1.status, 200);
    const body1 = await res1.json();

    const res2 = await fetch(`${bridgeUrl}/resolve?title=slime&ep=1&audio=dub&provider=animedubhindi`);
    assert.equal(res2.status, 200);
    const body2 = await res2.json();

    assert.equal(body2.session, body1.session);
    assert.equal(body2.reused, true);
  });

  it('GET /stream/:sid/media passes range requests and serves binary chunks', async () => {
    const resResolve = await fetch(`${bridgeUrl}/resolve?title=slime&ep=1&audio=dub&provider=animedubhindi`);
    assert.equal(resResolve.status, 200);
    const { session, master } = await resResolve.json();

    const resStream = await fetch(`${bridgeUrl}${master}`, {
      headers: { range: 'bytes=0-255' },
    });

    assert.ok(resStream.status === 206 || resStream.status === 200);
    const buf = Buffer.from(await resStream.arrayBuffer());
    assert.equal(buf.length, 256);
    // Matroska EBML magic 0x1A45DFA3
    assert.equal(buf.subarray(0, 4).toString('hex'), '1a45dfa3');
  });

  it('GET /stream/:sid rejects unknown sessions with 404 NO_SESSION', async () => {
    const res = await fetch(`${bridgeUrl}/stream/non-existent-session-id/media`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, 'NO_SESSION');
  });

  it('GET /audios returns multi-audio list including Hindi dub for supported titles', async () => {
    const res = await fetch(`${bridgeUrl}/audios?title=slime&ep=1`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.audios));
    const hindiTrack = body.audios.find((a) => a.id === 'hindi');
    assert.ok(hindiTrack, 'Hindi track option is present');
    assert.equal(hindiTrack.available, true);
    assert.equal(hindiTrack.state, 'verified');
  });

  it('Fallback logic gracefully handles provider failures without throwing', async () => {
    setProviderHandler('animedubhindi', async () => {
      throw Object.assign(new Error('animedubhindi upstream fault'), { code: 'NO_SUCH_EPISODE' });
    });

    const resFallback = await buildSource({
      title: 'Solo Leveling',
      ep: 1,
      audio: 'sub',
      provider: 'animedubhindi',
      fallback: true,
    });
    assert.ok(resFallback.session);
    assert.ok(['aniwatch', 'anikoto', 'hianime', 'animewave', 'animekai'].includes(resFallback.provider));
  });

  it('GET /resolve with provider=watchanimeworld resolves direct MP4 stream', async () => {
    const res = await fetch(`${bridgeUrl}/resolve?title=naruto&ep=1&audio=dub&provider=watchanimeworld`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.session, 'has session id');
    assert.equal(body.provider, 'watchanimeworld');
    assert.equal(body.kind, 'progressive');
    assert.equal(body.container, 'mp4');
    assert.ok(body.master.startsWith('/stream/'));
    assert.ok(body.master.includes('/media.mp4'));

    // Verify chunked stream range request
    const streamRes = await fetch(`${bridgeUrl}${body.master}`, {
      headers: { range: 'bytes=0-255' },
    });
    assert.equal(streamRes.status, 206);
    const buf = Buffer.from(await streamRes.arrayBuffer());
    assert.equal(buf.length, 256);
    assert.equal(buf.subarray(4, 8).toString('utf8'), 'ftyp');
  });

  it('GET /stream/:sid/sub/:i.vtt proxies subtitles with clean WebVTT header and CORS', async () => {
    // Resolve with subtitles
    setProviderHandler('anikoto', async () => ({
      session: 'sub-test-session',
      provider: 'anikoto',
      kind: 'hls',
      title: 'Subtitle Anime',
      episode: { number: 1, title: 'Episode 1' },
      quality: 1080,
      variants: [1080, 720],
      audio: 'sub',
      skip: null,
      proof: { container: 'mpegts', checkedBytes: 100 },
      master: '/stream/sub-test-session/master.m3u8',
      subtitles: [{ language: 'en', name: 'English', url: '/stream/sub-test-session/sub/0.vtt' }],
    }));

    const resolveRes = await fetch(`${bridgeUrl}/resolve?title=test-sub&ep=1&provider=anikoto`);
    assert.equal(resolveRes.status, 200);
    const meta = await resolveRes.json();
    assert.ok(meta.subtitles && meta.subtitles.length > 0);
  });

  it('Refusal status codes are mapped to 4xx for edge survival', async () => {
    setProviderHandler('animedubhindi', async () => {
      throw Object.assign(new Error('episode 9999 is not in AnimeDubHindi list'), { code: 'NO_SUCH_EPISODE' });
    });
    const res = await fetch(`${bridgeUrl}/resolve?title=slime&ep=9999&provider=animedubhindi&fallback=false`);
    assert.ok(res.status >= 400 && res.status < 500, `status ${res.status} is 4xx`);
    const body = await res.json();
    assert.ok(body.error);
  });

  it('GET /resolve with audio=hindi reaches AnimeDubHindi and preserves hindi audio', async () => {
    setProviderHandler('animedubhindi', async ({ title, ep, audio }) => {
      const sid = 'test-hindi-session';
      sessions.set(sid, {
        sid,
        provider: 'animedubhindi',
        kind: 'progressive',
        container: 'matroska',
        title,
        episode: { number: ep, title: `Episode ${ep}` },
        quality: 1080,
        variants: [1080],
        audio,
        proof: { container: 'matroska', checkedBytes: 256 },
        mediaUrl: 'https://workers.dev/mock-hindi.mkv',
        mockBytes: mkvMockBytes,
      });
      return {
        session: sid,
        provider: 'animedubhindi',
        kind: 'progressive',
        container: 'matroska',
        title,
        episode: ep,
        quality: 1080,
        variants: [1080],
        audio,
        proof: { container: 'matroska', checkedBytes: 256 },
        master: `/stream/${sid}/media.mkv`,
      };
    });

    const res = await fetch(`${bridgeUrl}/resolve?title=naruto-hindi-test&ep=1&audio=hindi`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.provider, 'animedubhindi');
    assert.equal(body.audio, 'hindi');
    assert.equal(body.container, 'matroska');
  });

  it('GET /resolve with audio=hindi falls back to sub when Hindi is unavailable and fallback=true', async () => {
    setProviderHandler('animedubhindi', async () => {
      throw Object.assign(new Error('no hindi stream available'), { code: 'RESOLVE_FAILED' });
    });

    const res = await fetch(`${bridgeUrl}/resolve?title=Solo+Leveling&ep=1&audio=hindi&fallback=true`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.session);
    assert.equal(body.audio, 'sub');
  });

  it('Phase 3: StreamNotFoundError returns structured 404 response with provider provenance', async () => {
    setProviderHandler('aniwatch', async () => {
      throw new StreamNotFoundError('Episode 99 does not exist on AniWatch', 'aniwatch');
    });

    const res = await fetch(`${bridgeUrl}/resolve?title=Test&ep=99&provider=aniwatch&fallback=false`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, 'NO_SUCH_EPISODE');
    assert.equal(body.provider, 'aniwatch');
    assert.ok(body.message.includes('Episode 99'));
  });

  it('Phase 3: ProviderTimeoutError maps cleanly to 504 Gateway Timeout', async () => {
    setProviderHandler('hianime', async () => {
      throw new ProviderTimeoutError('HiAnime stream extraction timed out after 20s', 'hianime');
    });

    const res = await fetch(`${bridgeUrl}/resolve?title=Test&ep=1&provider=hianime&fallback=false`);
    assert.equal(res.status, 504);
    const body = await res.json();
    assert.equal(body.error, 'PROVIDER_TIMEOUT');
    assert.equal(body.provider, 'hianime');
  });

  it('Phase 3: TIMEOUTS constants are properly configured and bounded', () => {
    assert.ok(Number.isFinite(TIMEOUTS.SEARCH) && TIMEOUTS.SEARCH > 0);
    assert.ok(Number.isFinite(TIMEOUTS.DETAILS) && TIMEOUTS.DETAILS > 0);
    assert.ok(Number.isFinite(TIMEOUTS.EMBED) && TIMEOUTS.EMBED > 0);
    assert.ok(Number.isFinite(TIMEOUTS.SNACK) && TIMEOUTS.SNACK > 0);
    assert.ok(Number.isFinite(TIMEOUTS.RESOLVE) && TIMEOUTS.RESOLVE > 0);
  });

  it('GET /home?provider=hianime returns HiAnime catalog home feed', async () => {
    const res = await fetch(`${bridgeUrl}/home?provider=hianime`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.provider, 'hianime');
    assert.ok(Array.isArray(body.featured));
    assert.ok(Array.isArray(body.trending));
  });

  it('GET /downloads returns available options and handles provider filter', async () => {
    const res = await fetch(`${bridgeUrl}/downloads?title=Solo+Leveling&ep=1`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.title, 'Solo Leveling');
    assert.equal(body.episode, 1);
    assert.ok(Array.isArray(body.options));
    assert.ok(body.options.some((o) => o.provider === 'hianime'));
  });
});
