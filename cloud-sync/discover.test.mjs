import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  discoverTrending, fetchTrending, pace, resetPacing, getCurrentInterval,
  calculateRateSpread, MIN_INTERVAL_MS, RATE_CEILING_RPM,
} from './discover.mjs';

const mockMedia = [
  {
    id: 100,
    title: { english: 'Existing Anime One', romaji: 'Existing Anime One' }
  },
  {
    id: 200,
    title: { english: 'Existing Pending Anime', romaji: 'Existing Pending Anime' }
  },
  {
    id: 300,
    title: { english: 'Brand New Anime Three', romaji: 'Brand New Anime Three' }
  },
  {
    id: 400,
    title: { english: 'Brand New Anime Four', romaji: 'Brand New Anime Four' }
  },
  {
    id: 500,
    title: { english: 'Brand New Anime Five', romaji: 'Brand New Anime Five' }
  }
];

describe('cloud-sync/discover.mjs', () => {
  describe('fetchTrending', () => {
    it('returns media array when AniList GraphQL succeeds', async () => {
      const mockFetch = async () => ({
        ok: true,
        json: async () => ({ data: { Page: { media: [{ id: 123, title: { english: 'Test' } }] } } })
      });
      const items = await fetchTrending(10, mockFetch);
      assert.equal(items.length, 1);
      assert.equal(items[0].id, 123);
    });

    it('throws error when AniList GraphQL returns error response', async () => {
      const mockFetch = async () => ({
        ok: true,
        json: async () => ({ errors: [{ message: 'Rate limit exceeded' }] })
      });
      await assert.rejects(
        () => fetchTrending(10, mockFetch),
        /AniList GraphQL error: "Rate limit exceeded"/
      );
    });

    it('retries on 429 with retry-after header and recovers on attempt 2', async () => {
      let attempts = 0;
      let slept = [];
      const mockFetch = async () => {
        attempts++;
        if (attempts === 1) {
          return {
            status: 429,
            ok: false,
            headers: new Headers({ 'retry-after': '1' }),
            json: async () => ({ errors: [{ message: 'Too many requests' }] }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { Page: { media: [{ id: 999, title: { english: 'Recovered' } }] } } }),
        };
      };
      const items = await fetchTrending(10, mockFetch, {
        sleep: (ms) => { slept.push(ms); return Promise.resolve(); }
      });
      assert.equal(attempts, 2);
      assert.equal(items.length, 1);
      assert.equal(items[0].id, 999);
      assert.equal(slept.length, 1);
      assert.equal(slept[0], 1000);
    });

    it('retries on transient 500/502/503 server error and recovers', async () => {
      let attempts = 0;
      const mockFetch = async () => {
        attempts++;
        if (attempts === 1) {
          return { status: 502, ok: false, text: async () => 'Bad Gateway' };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { Page: { media: [{ id: 888, title: { english: 'Ok' } }] } } }),
        };
      };
      const items = await fetchTrending(10, mockFetch, { sleep: () => Promise.resolve() });
      assert.equal(attempts, 2);
      assert.equal(items[0].id, 888);
    });
  });

  describe('pace and rate ceiling', () => {
    it('defaults to 24 RPM ceiling with 2500ms spacing to respect degraded rate limits', () => {
      assert.equal(RATE_CEILING_RPM, 24);
      assert.equal(MIN_INTERVAL_MS, 2500);
    });

    it('spaces consecutive operations by the configured interval', async () => {
      const sleeps = [];
      resetPacing();
      await pace(2500, (ms) => { sleeps.push(ms); return Promise.resolve(); });
      assert.equal(sleeps.length, 0, 'first call should not wait');

      await pace(2500, (ms) => { sleeps.push(ms); return Promise.resolve(); });
      assert.equal(sleeps.length, 1, 'second call should pace');
      assert.ok(sleeps[0] > 0 && sleeps[0] <= 2500);
    });

    it('widens spacing dynamically when response headers indicate low remaining quota', async () => {
      resetPacing();
      const headers = new Headers({
        'x-ratelimit-remaining': '3',
        'x-ratelimit-reset': String(Math.floor((Date.now() + 30000) / 1000)),
      });
      const mockFetch = async () => ({
        ok: true,
        status: 200,
        headers,
        json: async () => ({ data: { Page: { media: [{ id: 1, title: { english: 'T' } }] } } }),
      });

      let observedSpread = 0;
      await fetchTrending(10, mockFetch, { onSpread: (s) => { observedSpread = s; } });
      assert.ok(observedSpread >= 9000, `expected widened spread >= 9000ms, got ${observedSpread}`);
      assert.equal(getCurrentInterval(), observedSpread);
    });
  });

  describe('calculateRateSpread', () => {
    it('returns default interval when remaining requests are plentiful', () => {
      const headers = new Headers({
        'x-ratelimit-remaining': '50',
        'x-ratelimit-reset': String(Math.floor((Date.now() + 60000) / 1000)),
      });
      assert.equal(calculateRateSpread(headers, { defaultIntervalMs: 2500 }), 2500);
    });

    it('spreads remaining requests across window when remaining is below floor', () => {
      const now = 1000000;
      const headers = new Headers({
        'x-ratelimit-remaining': '2',
        'x-ratelimit-reset': '1030', // 30s remaining
      });
      // 30,000ms / 2 = 15,000ms spread
      const spread = calculateRateSpread(headers, { defaultIntervalMs: 2500, remainingFloor: 10, now });
      assert.equal(spread, 15000);
    });

    it('prioritizes Retry-After header when present', () => {
      const headers = new Headers({
        'retry-after': '45',
        'x-ratelimit-remaining': '50',
      });
      assert.equal(calculateRateSpread(headers, { defaultIntervalMs: 2500 }), 45000);
    });
  });

  describe('discoverTrending', () => {
    it('filters out existing anime rows and pending queue items', async () => {
      const mockFetch = async () => ({
        ok: true,
        json: async () => ({ data: { Page: { media: mockMedia } } })
      });

      const mockAll = async (sql) => {
        if (sql.includes('FROM anime')) {
          return [
            { id: 'existing-anime-one', source_ids: JSON.stringify({ anilist: 100 }) }
          ];
        }
        if (sql.includes('FROM sync_pending')) {
          return [
            { anilist_id: 200, slug: 'existing-pending-anime' }
          ];
        }
        return [];
      };

      const queries = [];
      const mockQuery = async (sql, params) => {
        queries.push({ sql, params });
        return { changes: 1 };
      };

      const res = await discoverTrending({
        limit: 2,
        depth: 10,
        dryRun: false,
        fetchImpl: mockFetch,
        queryImpl: mockQuery,
        allImpl: mockAll
      });

      assert.equal(res.queued.length, 2);
      assert.equal(res.queued[0].anilist_id, 300);
      assert.equal(res.queued[0].slug, 'brand-new-anime-three');
      assert.equal(res.queued[1].anilist_id, 400);
      assert.equal(res.queued[1].slug, 'brand-new-anime-four');

      // Check that sync_pending and sync_meta were updated
      assert.equal(queries.length, 3); // 2 inserts for sync_pending + 1 for sync_meta
      assert.ok(queries[0].sql.includes('INSERT OR IGNORE INTO sync_pending'));
      assert.ok(queries[2].sql.includes('INSERT INTO sync_meta'));
    });

    it('dryRun does not execute inserts', async () => {
      const mockFetch = async () => ({
        ok: true,
        json: async () => ({ data: { Page: { media: mockMedia } } })
      });
      const mockAll = async () => [];
      const queries = [];
      const mockQuery = async (sql, params) => queries.push({ sql, params });

      const res = await discoverTrending({
        limit: 2,
        dryRun: true,
        fetchImpl: mockFetch,
        queryImpl: mockQuery,
        allImpl: mockAll
      });

      assert.equal(res.queued.length, 2);
      assert.equal(res.dry_run, true);
      assert.equal(queries.length, 0); // No SQL executed
    });
  });
});
