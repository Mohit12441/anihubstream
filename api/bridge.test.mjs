// @ts-check
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  server,
  buildSource,
  buildSourceAnikoto,
  buildSourceAdb,
  buildSourceAniwatch,
  buildSourceHianime,
  buildAudios,
  sessions,
  recent,
  audioCache,
} from './bridge.mjs';

/**
 * Hermetic tests for bridge.mjs multi-provider dispatcher & latency race.
 */
describe('Bridge Multi-Provider Dispatcher & Race Tests', () => {
  let bridgePort;
  let bridgeUrl;

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
  });

  after(async () => {
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
    assert.ok(session.mediaUrl.startsWith('https://'));
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
    const resFallback = await buildSource({
      title: 'Solo Leveling',
      ep: 1,
      audio: 'sub',
      provider: 'animedubhindi',
      fallback: true,
    });
    assert.ok(resFallback.session);
    assert.ok(['aniwatch', 'anikoto', 'hianime'].includes(resFallback.provider));
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

  it('Refusal status codes are mapped to 4xx for edge survival', async () => {
    const res = await fetch(`${bridgeUrl}/resolve?title=slime&ep=9999&provider=animedubhindi&fallback=false`);
    assert.ok(res.status >= 400 && res.status < 500, `status ${res.status} is 4xx`);
    const body = await res.json();
    assert.ok(body.error);
  });
});
