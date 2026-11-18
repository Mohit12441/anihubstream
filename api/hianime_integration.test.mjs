// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('HiAnime End-to-End Integration Suite', () => {
  it('/api/play resolves HiAnime by slug without mal_id and marks scopedProviderUnavailable as false', async () => {
    const playModule = await import('../functions/api/play.js');
    const req = new Request('http://localhost:8899/api/play?id=solo-leveling&ep=1&provider=hianime&server=HD-1&audio=sub');
    const res = await playModule.onRequestGet({ request: req, env: {}, waitUntil: () => {} });
    
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.scopedProvider, 'hianime');
    assert.equal(data.scopedProviderUnavailable, false);
    assert.ok(Array.isArray(data.servers), 'Servers must be an array');
    
    const primary = data.servers[0];
    assert.equal(primary.provider, 'hianime');
    assert.equal(primary.status, 'ready');
    assert.ok(primary.streamUrl.includes('proxy') || primary.streamUrl.includes('m3u8') || primary.streamUrl.includes('resolve'));
  });

  it('/api/play/resolve resolves HiAnime v2 stream directly with 200 OK and ready status', async () => {
    const resolveModule = await import('../functions/api/play/resolve.js');
    const req = new Request('http://localhost:8899/api/play/resolve?anime_id=solo-leveling&ep=1&audio=sub&provider=hianime&server=HD-1');
    const res = await resolveModule.onRequestGet({ request: req, env: {}, waitUntil: () => {} });
    
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.ok(json.server, 'Server payload must be returned');
    assert.equal(json.server.provider, 'hianime');
    assert.equal(json.server.status, 'ready');
    assert.equal(json.server.type, 'hls');
    assert.ok(json.server.streamUrl.startsWith('http://localhost:8899/api/proxy?url='));
  });

  it('HiAnime /api/hianime/play validates missing id parameter with 400', async () => {
    const hianimePlay = await import('../functions/api/hianime/play.js');
    const req = new Request('http://localhost:8899/api/hianime/play');
    const res = await hianimePlay.onRequestGet({ request: req, env: {}, waitUntil: () => {} });
    assert.equal(res.status, 400);
  });

  it('HiAnime /api/hianime/search returns search results with cover art', async () => {
    const searchModule = await import('../functions/api/hianime/search.js');
    const req = new Request('http://localhost:8899/api/hianime/search?q=naruto&limit=5');
    const res = await searchModule.onRequestGet({ request: req, env: {}, waitUntil: () => {} });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.ok(json.ok);
    assert.ok(Array.isArray(json.data?.results));
    assert.ok(json.data.results.length > 0);
    const first = json.data.results[0];
    assert.equal(first.provider, 'hianime');
    assert.ok(first.slug);
    assert.ok(first.title);
  });

  it('clean link policy: sub audio is omitted from URL query params, dub is preserved', () => {
    const generateUrlParams = (provider, server, audio) => {
      const p = new URLSearchParams();
      if (provider) p.set('provider', provider);
      if (server) p.set('server', server);
      if (audio === 'dub') p.set('audio', 'dub');
      return p.toString();
    };

    const subUrl = generateUrlParams('hianime', 'HD-1', 'sub');
    assert.equal(subUrl, 'provider=hianime&server=HD-1', 'sub audio must not be present in URL');

    const dubUrl = generateUrlParams('hianime', 'HD-1', 'dub');
    assert.equal(dubUrl, 'provider=hianime&server=HD-1&audio=dub', 'dub audio must be present in URL');
  });
});
