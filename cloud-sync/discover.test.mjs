import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { discoverTrending, fetchTrending } from './discover.mjs';

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
