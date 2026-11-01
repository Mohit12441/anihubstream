import assert from 'node:assert';
import test from 'node:test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

test('Zero-Read Edge Shield Verification Suite', async (t) => {
  const libUrl = pathToFileURL(path.resolve('functions/api/_lib.js')).href;
  const { withEdgeCache, clearEdgeMemoryCache } = await import(libUrl);

  t.beforeEach(() => {
    clearEdgeMemoryCache();
  });

  const createMockCompute = () => {
    let count = 0;
    const fn = async () => {
      count++;
      return new Response(JSON.stringify({ success: true, count }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'set-cookie': 'secret_session=12345; Path=/',
        },
      });
    };
    fn.getCount = () => count;
    return fn;
  };

  await t.test('1. First request fetches fresh from D1 (1-d1-fresh)', async () => {
    const mock = createMockCompute();
    const req1 = new Request('http://localhost:8899/api/home?provider=all&utm_source=twitter');
    const res1 = await withEdgeCache(req1, {}, 3600, mock, { allowedParams: ['provider'] });
    assert.strictEqual(res1.status, 200);
    assert.strictEqual(res1.headers.get('X-D1-Read'), '1-d1-fresh');
    assert.strictEqual(mock.getCount(), 1);
  });

  await t.test('2. Repeated requests hit in-memory/edge cache with ZERO D1 reads', async () => {
    const mock = createMockCompute();
    const req1 = new Request('http://localhost:8899/api/home?provider=all&utm_source=twitter');
    const res1 = await withEdgeCache(req1, {}, 3600, mock, { allowedParams: ['provider'] });
    assert.strictEqual(res1.headers.get('X-D1-Read'), '1-d1-fresh');

    const req2 = new Request('http://localhost:8899/api/home?provider=ALL&utm_campaign=spring');
    const res2 = await withEdgeCache(req2, {}, 3600, mock, { allowedParams: ['provider'] });
    assert.strictEqual(res2.status, 200);
    assert.strictEqual(res2.headers.get('X-D1-Read'), '0-dev-memory-hit');
    assert.strictEqual(mock.getCount(), 1, 'D1 query count MUST remain 1 on repeat');
  });

  await t.test('3. Emergency bypass parameter bypasses cache (1-d1-bypassed)', async () => {
    const mock = createMockCompute();
    const req1 = new Request('http://localhost:8899/api/home?provider=all');
    await withEdgeCache(req1, {}, 3600, mock, { allowedParams: ['provider'] });
    assert.strictEqual(mock.getCount(), 1);

    const reqBypass = new Request('http://localhost:8899/api/home?provider=all&bypass=1');
    const resBypass = await withEdgeCache(reqBypass, {}, 3600, mock, { allowedParams: ['provider'] });
    assert.strictEqual(resBypass.headers.get('X-D1-Read'), '1-d1-bypassed');
    assert.strictEqual(mock.getCount(), 2);

    const reqBypassHeader = new Request('http://localhost:8899/api/home?provider=all', {
      headers: { 'x-bypass-cache': '1' },
    });
    const resBypassHeader = await withEdgeCache(reqBypassHeader, {}, 3600, mock, { allowedParams: ['provider'] });
    assert.strictEqual(resBypassHeader.headers.get('X-D1-Read'), '1-d1-bypassed');
    assert.strictEqual(mock.getCount(), 3);
  });

  await t.test('4. Thundering herd concurrency coalesces into 1 execution', async () => {
    let slowCount = 0;
    const slowCompute = async () => {
      slowCount++;
      await new Promise((r) => setTimeout(r, 40));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const parallelReqs = [
      withEdgeCache(new Request('http://localhost:8899/api/genres'), {}, 3600, slowCompute),
      withEdgeCache(new Request('http://localhost:8899/api/genres'), {}, 3600, slowCompute),
      withEdgeCache(new Request('http://localhost:8899/api/genres'), {}, 3600, slowCompute),
    ];

    const results = await Promise.all(parallelReqs);
    assert.strictEqual(slowCount, 1, 'Concurrent requests must only query D1 once');
    const piggybacks = results.filter((r) => r.headers.get('X-D1-Read') === '0-inflight-piggyback');
    assert.strictEqual(piggybacks.length, 2);
  });

  await t.test('5. Set-Cookie is stripped and Cache-Control contains public s-maxage', async () => {
    const mock = createMockCompute();
    const req = new Request('http://localhost:8899/api/anime/attack-on-titan');
    const res = await withEdgeCache(req, {}, 7200, mock, { allowedParams: [] });
    assert.strictEqual(res.headers.get('Set-Cookie'), null, 'Set-Cookie MUST be stripped');
    assert.ok(res.headers.get('Cache-Control')?.includes('public'), 'Cache-Control must be public');
    assert.ok(res.headers.get('Cache-Control')?.includes('s-maxage=7200'), 's-maxage must match ttl');
    assert.ok(res.headers.get('Cache-Control')?.includes('stale-while-revalidate'), 'stale-while-revalidate must be present');
    assert.strictEqual(res.headers.get('Vary'), 'Accept-Encoding');
  });

  await t.test('6. Parameter ordering and extraneous params normalize to same cache key', async () => {
    const mock = createMockCompute();
    // Request with params in order: a then b, plus extra tracking param
    const reqA = new Request('http://localhost:8899/api/search?q=naruto&limit=20&fbclid=xyz123');
    const resA = await withEdgeCache(reqA, {}, 1800, mock, { allowedParams: ['limit', 'q'] });
    assert.strictEqual(resA.headers.get('X-D1-Read'), '1-d1-fresh');
    assert.strictEqual(mock.getCount(), 1);

    // Request with reverse order: limit then q, uppercase, different tracking param
    const reqB = new Request('http://localhost:8899/api/search?limit=20&q=NARUTO&utm_medium=cpc');
    const resB = await withEdgeCache(reqB, {}, 1800, mock, { allowedParams: ['limit', 'q'] });
    assert.strictEqual(resB.headers.get('X-D1-Read'), '0-dev-memory-hit');
    assert.strictEqual(mock.getCount(), 1, 'Different param order and casing must hit the same cache entry');
  });

  await t.test('7. Empty allowedParams strips all query parameters', async () => {
    const mock = createMockCompute();
    const reqBase = new Request('http://localhost:8899/api/genres');
    const resBase = await withEdgeCache(reqBase, {}, 86400, mock, { allowedParams: [] });
    assert.strictEqual(resBase.headers.get('X-D1-Read'), '1-d1-fresh');
    assert.strictEqual(mock.getCount(), 1);

    const reqWithJunk = new Request('http://localhost:8899/api/genres?random_param=999&session=abc');
    const resWithJunk = await withEdgeCache(reqWithJunk, {}, 86400, mock, { allowedParams: [] });
    assert.strictEqual(resWithJunk.headers.get('X-D1-Read'), '0-dev-memory-hit');
    assert.strictEqual(mock.getCount(), 1, 'Empty allowedParams must normalize all query variations to canonical URL');
  });
});
