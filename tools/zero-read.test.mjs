import assert from 'node:assert';
import test from 'node:test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

test('Zero-Read Edge Shield Verification Suite', async (t) => {
  const libUrl = pathToFileURL(path.resolve('functions/api/_lib.js')).href;
  const { withEdgeCache } = await import(libUrl);

  let d1QueryCount = 0;
  const mockCompute = async () => {
    d1QueryCount++;
    return new Response(JSON.stringify({ success: true, count: d1QueryCount }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  await t.test('1. First request fetches fresh from D1 (1-d1-fresh)', async () => {
    const req1 = new Request('http://localhost:8899/api/home?provider=all&utm_source=twitter');
    const res1 = await withEdgeCache(req1, {}, 3600, mockCompute, { allowedParams: ['provider'] });
    assert.strictEqual(res1.status, 200);
    assert.strictEqual(res1.headers.get('X-D1-Read'), '1-d1-fresh');
    assert.strictEqual(d1QueryCount, 1);
  });

  await t.test('2. Repeated requests hit in-memory/edge cache with ZERO D1 reads', async () => {
    const req2 = new Request('http://localhost:8899/api/home?provider=ALL&utm_campaign=spring');
    const res2 = await withEdgeCache(req2, {}, 3600, mockCompute, { allowedParams: ['provider'] });
    assert.strictEqual(res2.status, 200);
    assert.strictEqual(res2.headers.get('X-D1-Read'), '0-dev-memory-hit');
    assert.strictEqual(d1QueryCount, 1, 'D1 query count MUST remain 1');
  });

  await t.test('3. Emergency bypass parameter bypasses cache (1-d1-bypassed)', async () => {
    const reqBypass = new Request('http://localhost:8899/api/home?provider=all&bypass=1');
    const resBypass = await withEdgeCache(reqBypass, {}, 3600, mockCompute, { allowedParams: ['provider'] });
    assert.strictEqual(resBypass.headers.get('X-D1-Read'), '1-d1-bypassed');
    assert.strictEqual(d1QueryCount, 2);
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
});
