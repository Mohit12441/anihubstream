// @ts-check
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { clearEdgeMemoryCache } from '../functions/api/_lib.js';
import { onRequestGet as searchGet } from '../functions/api/search.js';
import { onRequestGet as genresGet } from '../functions/api/genres.js';
import { onRequestGet as statsGet } from '../functions/api/stats/index.js';
import { onRequestGet as scheduleGet } from '../functions/api/schedule.js';
import { onRequestGet as anikotoHomeGet } from '../functions/api/anikoto/home.js';
import { onRequestGet as anikotoSearchGet } from '../functions/api/anikoto/search.js';

describe('Edge API Routes: Zero-Read D1 Caching Enforcement', () => {
  let queryCount = 0;

  const mockDb = {
    prepare: (sql) => ({
      bind: (...args) => ({
        all: async () => {
          queryCount++;
          return { results: [] };
        },
        first: async () => {
          queryCount++;
          return { n: 42 };
        },
        run: async () => {
          queryCount++;
          return { success: true };
        },
      }),
      all: async () => {
        queryCount++;
        return { results: [] };
      },
      first: async () => {
        queryCount++;
        return { n: 42 };
      },
    }),
  };

  const env = {
    ANIHUB: mockDb,
    STREAM_BRIDGE_URL: '',
  };

  beforeEach(() => {
    clearEdgeMemoryCache();
    queryCount = 0;
  });

  it('/api/search enforces edge caching and strips tracking params', async () => {
    const req1 = new Request('http://localhost:8899/api/search?q=naruto&utm_source=facebook');
    const res1 = await searchGet({ request: req1, env });
    assert.strictEqual(res1.status, 200);
    assert.strictEqual(res1.headers.get('X-D1-Read'), '1-d1-fresh');
    assert.ok(queryCount > 0, 'First request queries D1');
    const initialQueries = queryCount;

    const req2 = new Request('http://localhost:8899/api/search?q=naruto&fbclid=tracking123');
    const res2 = await searchGet({ request: req2, env });
    assert.strictEqual(res2.status, 200);
    assert.strictEqual(res2.headers.get('X-D1-Read'), '0-dev-memory-hit');
    assert.strictEqual(queryCount, initialQueries, 'Second request must produce 0 additional D1 queries');
  });

  it('/api/genres caches globally and ignores query strings', async () => {
    const req1 = new Request('http://localhost:8899/api/genres');
    const res1 = await genresGet({ request: req1, env });
    assert.strictEqual(res1.status, 200);
    assert.strictEqual(res1.headers.get('X-D1-Read'), '1-d1-fresh');
    assert.strictEqual(queryCount, 1);

    const req2 = new Request('http://localhost:8899/api/genres?random=999');
    const res2 = await genresGet({ request: req2, env });
    assert.strictEqual(res2.status, 200);
    assert.strictEqual(res2.headers.get('X-D1-Read'), '0-dev-memory-hit');
    assert.strictEqual(queryCount, 1, 'Subsequent genres request must not touch D1');
  });

  it('/api/stats caches for 600s and strips extraneous params', async () => {
    const req1 = new Request('http://localhost:8899/api/stats');
    const res1 = await statsGet({ request: req1, env });
    assert.strictEqual(res1.status, 200);
    assert.strictEqual(res1.headers.get('X-D1-Read'), '1-d1-fresh');
    const qCount = queryCount;

    const req2 = new Request('http://localhost:8899/api/stats?nocache=fake');
    const res2 = await statsGet({ request: req2, env });
    assert.strictEqual(res2.status, 200);
    assert.strictEqual(res2.headers.get('X-D1-Read'), '0-dev-memory-hit');
    assert.strictEqual(queryCount, qCount);
  });

  it('/api/schedule filters by season and caches results', async () => {
    const req1 = new Request('http://localhost:8899/api/schedule?season=FALL-2026&utm_campaign=winter');
    const res1 = await scheduleGet({ request: req1, env });
    assert.strictEqual(res1.status, 200);
    assert.strictEqual(res1.headers.get('X-D1-Read'), '1-d1-fresh');
    const qCount = queryCount;

    const req2 = new Request('http://localhost:8899/api/schedule?season=fall-2026&other=junk');
    const res2 = await scheduleGet({ request: req2, env });
    assert.strictEqual(res2.status, 200);
    assert.strictEqual(res2.headers.get('X-D1-Read'), '0-dev-memory-hit');
    assert.strictEqual(queryCount, qCount);
  });

  it('/api/anikoto/home caches shelf queries across hits', async () => {
    const req1 = new Request('http://localhost:8899/api/anikoto/home');
    const res1 = await anikotoHomeGet({ request: req1, env });
    assert.strictEqual(res1.status, 200);
    assert.strictEqual(res1.headers.get('X-D1-Read'), '1-d1-fresh');
    const qCount = queryCount;

    const req2 = new Request('http://localhost:8899/api/anikoto/home?ignore=me');
    const res2 = await anikotoHomeGet({ request: req2, env });
    assert.strictEqual(res2.status, 200);
    assert.strictEqual(res2.headers.get('X-D1-Read'), '0-dev-memory-hit');
    assert.strictEqual(queryCount, qCount);
  });

  it('/api/anikoto/search caches results and prevents repeated queries', async () => {
    const req1 = new Request('http://localhost:8899/api/anikoto/search?q=titan');
    const res1 = await anikotoSearchGet({ request: req1, env });
    assert.strictEqual(res1.status, 200);
    assert.strictEqual(res1.headers.get('X-D1-Read'), '1-d1-fresh');
    const qCount = queryCount;

    const req2 = new Request('http://localhost:8899/api/anikoto/search?q=TITAN');
    const res2 = await anikotoSearchGet({ request: req2, env });
    assert.strictEqual(res2.status, 200);
    assert.strictEqual(res2.headers.get('X-D1-Read'), '0-dev-memory-hit');
    assert.strictEqual(queryCount, qCount);
  });
});
