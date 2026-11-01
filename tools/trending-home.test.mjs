// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';

const BASE_URL = 'http://127.0.0.1:8899';

test('Home API & Trending Verification Suite', async (t) => {
  await t.test('1. GET /api/home returns valid contract with 20 trending items', async () => {
    const res = await fetch(`${BASE_URL}/api/home?bypass=1`);
    assert.equal(res.status, 200, 'API returns 200');
    
    const body = await res.json();
    assert.equal(body.provider, 'all');
    assert.ok(Array.isArray(body.trending), 'trending is an array');
    assert.equal(body.trending.length, 20, 'returns exactly 20 trending items');
    assert.ok(Array.isArray(body.ongoing), 'ongoing is an array');
    assert.ok(Array.isArray(body.topRated), 'topRated is an array');
    assert.ok(Array.isArray(body.fresh), 'fresh is an array');
    assert.ok(Array.isArray(body.added), 'added is an array');
    assert.ok(body.providers && typeof body.providers === 'object', 'providers is an object');
  });

  await t.test('2. Trending items are sorted monotonically by trendRank', async () => {
    const res = await fetch(`${BASE_URL}/api/home?bypass=1`);
    const body = await res.json();
    
    let prevRank = 0;
    for (const item of body.trending) {
      if (item.trendRank !== null && item.trendRank !== undefined) {
        assert.ok(item.trendRank >= prevRank, `trendRank ${item.trendRank} is >= ${prevRank}`);
        prevRank = item.trendRank;
      }
    }
  });

  await t.test('3. Trending items have required fields and valid artwork', async () => {
    const res = await fetch(`${BASE_URL}/api/home?bypass=1`);
    const body = await res.json();
    
    for (const item of body.trending) {
      assert.ok(item.id, 'item has id');
      assert.ok(item.title, 'item has title');
      assert.ok(item.art || item.keyArt, `${item.id} has artwork`);
      assert.ok(item.status, `${item.id} has status`);
      
      // If upcoming, episodeCount must be 0
      if (item.status === 'Upcoming' || item.status === 'NOT_YET_RELEASED') {
        assert.equal(item.episodeCount, 0, `Upcoming anime ${item.id} must have 0 released episodes`);
      }
    }
  });

  await t.test('4. GET /api/home respects Zero-Read Edge caching', async () => {
    const res1 = await fetch(`${BASE_URL}/api/home`);
    assert.equal(res1.status, 200);
    const cacheHeader = res1.headers.get('cache-control');
    assert.ok(cacheHeader && cacheHeader.includes('public'), 'Cache-Control must be public');
    assert.ok(cacheHeader.includes('max-age'), 'Cache-Control must include max-age');
    assert.ok(cacheHeader.includes('s-maxage'), 'Cache-Control must include s-maxage');
    assert.equal(res1.headers.get('set-cookie'), null, 'Set-Cookie must be stripped on public home cache');
  });

  await t.test('5. Multi-provider streams shelf is populated', async () => {
    const res = await fetch(`${BASE_URL}/api/home?bypass=1`);
    const body = await res.json();
    
    assert.ok(Array.isArray(body.providers.anikoto), 'anikoto provider shelf is an array');
    assert.ok(Array.isArray(body.providers.hianime), 'hianime provider shelf is an array');
    assert.ok(Array.isArray(body.providers.aniwatch), 'aniwatch provider shelf is an array');
    
    assert.ok(body.providers.anikoto.length > 0, 'anikoto has items');
    assert.ok(body.providers.hianime.length > 0, 'hianime has items');
    assert.ok(body.providers.aniwatch.length > 0, 'aniwatch has items');
  });
});
