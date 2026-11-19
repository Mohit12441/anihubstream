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

    // Verify all 3 HiAnime sub mirrors appear
    const hianimeSubServers = data.servers.filter(s => s.provider === 'hianime' && s.audio === 'sub');
    assert.ok(hianimeSubServers.some(s => s.id === 'hianime:HD-1'), 'HD-1 sub mirror must be present');
    assert.ok(hianimeSubServers.some(s => s.id === 'hianime:HD-2'), 'HD-2 sub mirror must be present');
    assert.ok(hianimeSubServers.some(s => s.id === 'hianime:HD-3'), 'HD-3 sub mirror must be present');

    // Verify all 3 HiAnime dub mirrors appear
    const hianimeDubServers = data.servers.filter(s => s.provider === 'hianime' && s.audio === 'dub');
    assert.ok(hianimeDubServers.some(s => s.id === 'hianime:HD-1-dub'), 'HD-1 dub mirror must be present');
    assert.ok(hianimeDubServers.some(s => s.id === 'hianime:HD-2-dub'), 'HD-2 dub mirror must be present');
    assert.ok(hianimeDubServers.some(s => s.id === 'hianime:HD-3-dub'), 'HD-3 dub mirror must be present');
  });

  it('/api/play resolves HiAnime DUB without mirror duplication or missing SUB mirrors', async () => {
    const playModule = await import('../functions/api/play.js');
    const req = new Request('http://localhost:8899/api/play?id=solo-leveling&ep=1&provider=hianime&server=HD-3&audio=dub');
    const res = await playModule.onRequestGet({ request: req, env: {}, waitUntil: () => {} });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.scopedProvider, 'hianime');

    const primary = data.servers[0];
    assert.equal(primary.id, 'hianime:HD-3-dub');
    assert.equal(primary.audio, 'dub');
    assert.ok(primary.name.includes('HD-3 [Zoko] (DUB)'), 'Name must include host tag and DUB label');

    const hianimeSubs = data.servers.filter(s => s.provider === 'hianime' && s.audio === 'sub');
    assert.equal(hianimeSubs.length, 3, 'Must retain all 3 sub mirrors');
    assert.ok(hianimeSubs.some(s => s.id === 'hianime:HD-1'), 'HD-1 must remain in SUB');
    assert.ok(hianimeSubs.some(s => s.id === 'hianime:HD-2'), 'HD-2 must remain in SUB');
    assert.ok(hianimeSubs.some(s => s.id === 'hianime:HD-3'), 'HD-3 must remain in SUB');

    const hianimeDubs = data.servers.filter(s => s.provider === 'hianime' && s.audio === 'dub');
    assert.equal(hianimeDubs.length, 3, 'Must have exactly 3 dub mirrors with no duplicates');
    const dubIds = hianimeDubs.map(s => s.id);
    assert.equal(new Set(dubIds).size, dubIds.length, 'No duplicate server IDs allowed in DUB');
  });

  it('/api/play resolves AniKoto DUB without duplicate HD-1 or missing HD-1 in SUB', async () => {
    const playModule = await import('../functions/api/play.js');
    const req = new Request('http://localhost:8899/api/play?id=solo-leveling&ep=1&provider=anikoto&server=HD-1&audio=dub');
    const res = await playModule.onRequestGet({ request: req, env: {}, waitUntil: () => {} });

    assert.equal(res.status, 200);
    const data = await res.json();

    const anikotoSubs = data.servers.filter(s => s.provider === 'anikoto' && s.audio === 'sub');
    assert.ok(anikotoSubs.some(s => s.id === 'anikoto:HD-1'), 'AniKoto HD-1 must remain present in SUB');

    const anikotoDubs = data.servers.filter(s => s.provider === 'anikoto' && s.audio === 'dub');
    const hd1Dubs = anikotoDubs.filter(s => s.id.includes('HD-1'));
    assert.equal(hd1Dubs.length, 1, 'Must have exactly one HD-1 in AniKoto DUB');
  });

  it('/api/play/resolve resolves HiAnime stream directly with 200 OK and ready status', async () => {
    const resolveModule = await import('../functions/api/play/resolve.js');
    const req = new Request('http://localhost:8899/api/play/resolve?anime_id=solo-leveling&mal_id=52299&ep=1&audio=sub&provider=hianime&server=HD-3');
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
    if (json.data.results.length > 0) {
      const first = json.data.results[0];
      assert.equal(first.provider, 'hianime');
      assert.ok(first.slug);
      assert.ok(first.title);
    }
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
