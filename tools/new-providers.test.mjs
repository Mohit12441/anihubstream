// @ts-check
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startBridge, stopBridge } from '../api/bridge.mjs';
import { getAdapter, listAdapterIds } from '../api/adapters/registry.mjs';
import { isHostAllowed } from '../functions/api/proxy.js';

describe('New Multi-Provider Toolkits Integration Suite (C:\\api -> AniHubStream)', () => {
  let bridgeUrl = '';

  before(async () => {
    process.env.BRIDGE_NO_AUTOSTART = '1';
    const info = await startBridge(0, '127.0.0.1');
    bridgeUrl = `http://127.0.0.1:${info.port}`;
  });

  after(async () => {
    await stopBridge();
  });

  it('1. Registry contains all 7 newly integrated providers alongside original providers', () => {
    const ids = listAdapterIds();
    const expected = [
      'anipm',
      'anidisk',
      'animeflv',
      'hdrezka',
      'jkanime',
      'animedubhindi',
      'desidubanime',
    ];
    for (const exp of expected) {
      assert.ok(ids.includes(exp), `Adapter registry missing expected provider: ${exp}`);
      const adapter = getAdapter(exp);
      assert.ok(adapter, `Adapter definition for ${exp} must exist`);
      assert.ok(Array.isArray(adapter.supportedAudio), `${exp} must specify supportedAudio`);
      assert.ok(typeof adapter.search === 'function', `${exp} must have search function`);
      assert.ok(typeof adapter.details === 'function', `${exp} must have details function`);
      assert.ok(typeof adapter.sources === 'function', `${exp} must have sources function`);
      assert.ok(typeof adapter.resolve === 'function', `${exp} must have resolve function`);
    }
  });

  it('2. AniPM adapter fulfills full contract and resolves Settlar skip intervals', async () => {
    const adapter = getAdapter('anipm');
    assert.ok(adapter);
    const searchRes = await adapter.search('Solo Leveling');
    assert.ok(Array.isArray(searchRes) && searchRes.length > 0);
    assert.ok(searchRes[0].title);

    const detailsRes = await adapter.details(searchRes[0].slug || searchRes[0].id);
    assert.ok(detailsRes && detailsRes.title);
    assert.ok(Array.isArray(detailsRes.episodes) && detailsRes.episodes.length > 0);

    const src = await adapter.sources(detailsRes.episodes[0].id);
    assert.ok(src && (Array.isArray(src.embeds) || Array.isArray(src.direct)));

    const resolved = await adapter.resolve(src.embeds?.[0] || 'https://ani.pm/embed/ani/123/1/sub');
    assert.equal(resolved.provider, 'anipm');
    assert.ok(resolved.master?.url);
    assert.ok(resolved.quality);
  });

  it('3. AniDisk adapter fulfills 15 regional languages contract', async () => {
    const adapter = getAdapter('anidisk');
    assert.ok(adapter);
    assert.ok(adapter.supportedAudio.includes('hindi'));

    const searchRes = await adapter.search('Naruto');
    assert.ok(Array.isArray(searchRes) && searchRes.length > 0);

    const detailsRes = await adapter.details(searchRes[0].slug);
    assert.ok(detailsRes && Array.isArray(detailsRes.episodes));

    const src = await adapter.sources(detailsRes.episodes[0]?.id || 'naruto:1:1');
    assert.ok(src);

    const resolved = await adapter.resolve(src.embeds?.[0] || 'https://anidisk.org/watch/naruto/1/1');
    assert.equal(resolved.provider, 'anidisk');
    assert.ok(resolved.master?.url);
  });

  it('4. AnimeFLV adapter fulfills Spanish / Latino decoupled HLS contract', async () => {
    const adapter = getAdapter('animeflv');
    assert.ok(adapter);
    assert.ok(adapter.supportedAudio.includes('spanish'));

    const searchRes = await adapter.search('Dragon Ball');
    assert.ok(Array.isArray(searchRes) && searchRes.length > 0);

    const detailsRes = await adapter.details('dragon-ball');
    assert.ok(detailsRes && Array.isArray(detailsRes.episodes));

    const src = await adapter.sources('dragon-ball:1');
    assert.ok(src && Array.isArray(src.embeds));

    const resolved = await adapter.resolve(src.embeds[0]);
    assert.equal(resolved.provider, 'animeflv');
    assert.ok(resolved.master?.url);
  });

  it('5. HDRezka adapter fulfills Voidboost CDN multi-quality & multi-voiceover contract', async () => {
    const adapter = getAdapter('hdrezka');
    assert.ok(adapter);
    assert.ok(adapter.supportedAudio.includes('russian'));

    const searchRes = await adapter.search('Attack on Titan');
    assert.ok(Array.isArray(searchRes) && searchRes.length > 0);

    const detailsRes = await adapter.details('12345');
    assert.ok(detailsRes && Array.isArray(detailsRes.episodes));

    const src = await adapter.sources('12345:1:1');
    assert.ok(src);

    const resolved = await adapter.resolve(src.embeds?.[0] || 'https://voidboost.net/embed/anime/12345/1/1');
    assert.equal(resolved.provider, 'hdrezka');
    assert.ok(resolved.variants.length > 1);
  });

  it('6. JKAnime adapter fulfills Spanish Desu / Magi HLS contract', async () => {
    const adapter = getAdapter('jkanime');
    assert.ok(adapter);
    assert.ok(adapter.supportedAudio.includes('spanish'));

    const searchRes = await adapter.search('One Piece');
    assert.ok(Array.isArray(searchRes) && searchRes.length > 0);

    const detailsRes = await adapter.details('one-piece');
    assert.ok(detailsRes && Array.isArray(detailsRes.episodes));

    const src = await adapter.sources('one-piece:1');
    assert.ok(src);

    const resolved = await adapter.resolve(src.embeds?.[0] || 'https://jkanime.net/one-piece/1/');
    assert.equal(resolved.provider, 'jkanime');
    assert.ok(resolved.master?.url);
  });

  it('7. AnimeDubHindi & DesiDubAnime adapters fulfill regional dub and download contracts', async () => {
    for (const provId of ['animedubhindi', 'desidubanime']) {
      const adapter = getAdapter(provId);
      assert.ok(adapter, `${provId} adapter must exist`);
      assert.ok(adapter.supportedAudio.includes('hindi'));

      const searchRes = await adapter.search('Demon Slayer');
      assert.ok(Array.isArray(searchRes) && searchRes.length > 0);

      const detailsRes = await adapter.details(searchRes[0].slug || searchRes[0].id);
      assert.ok(detailsRes && Array.isArray(detailsRes.episodes));

      const resolved = await adapter.resolve('https://mock.stream/video.mp4');
      assert.equal(resolved.provider, provId);
      assert.ok(resolved.master?.url);
    }
  });

  it('8. Live Stream Bridge /providers lists all newly registered adapters', async () => {
    const res = await fetch(`${bridgeUrl}/providers`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.ok);
    assert.ok(Array.isArray(data.providers));
    const provIds = data.providers.map((p) => p.id);
    for (const exp of ['anipm', 'anidisk', 'animeflv', 'hdrezka', 'jkanime', 'animedubhindi', 'desidubanime']) {
      assert.ok(provIds.includes(exp), `Stream Bridge /providers response must contain ${exp}`);
    }
  });

  it('9. Edge Proxy whitelists all upstream streaming domains for new providers', () => {
    const domains = [
      'ani.pm',
      'settlar.io',
      'embed.settlar.io',
      'anidisk.org',
      'deadbase.host',
      'api.deadbase.host',
      'animeflv.com.ua',
      'player.zilla-networks.com',
      'hello-rezka.tv',
      'hdrezka.co',
      'voidboost.net',
      'jkanime.net',
      'cdn.jkdesa.com',
      'animedubhindi.link',
      'new.adhlinks.com',
      'desidubanime.me',
    ];

    for (const d of domains) {
      assert.ok(isHostAllowed(d), `Domain ${d} must be allowed by isHostAllowed in proxy.js`);
    }
  });
});
