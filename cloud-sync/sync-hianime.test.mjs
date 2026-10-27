// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mapHiAnimeItem,
  paletteAccent,
  fetchHiAnimePage,
  PAGE_SIZE,
} from './sync-hianime.mjs';

describe('HiAnime Cloud Sync Pipeline Tests', () => {
  describe('mapHiAnimeItem', () => {
    it('maps raw HiAnime item into D1 anime schema correctly', () => {
      const raw = {
        title: 'Solo Leveling',
        slug: 'solo-leveling-e5tfvj',
        Japanese: '俺だけレベルアップな件',
        alternateTitle: 'Ore dake Level Up na Ken',
        English: 'Solo Leveling',
        Aired: 'Jan 7, 2024 to Mar 31, 2024',
        Score: '8.22',
        Type: 'TV',
        Status: 'Finished Airing',
        totalEpisodes: '12',
        image: 'https://animehot.cc/storage/media/poster.jpg',
        landScapeImage: 'https://animehot.cc/storage/media/landscape.jpg',
        synopsis: 'Ten years ago, the Gate appeared...',
        mal_id: 52299,
        genres: ['Action', 'Adventure', 'Fantasy'],
      };

      const mapped = mapHiAnimeItem(raw);
      assert.ok(mapped);
      assert.equal(mapped.id, 'solo-leveling');
      assert.equal(mapped.title, 'Solo Leveling');
      assert.equal(mapped.native, '俺だけレベルアップな件');
      assert.equal(mapped.year, 2024);
      assert.equal(mapped.rating, 82);
      assert.equal(mapped.kind, 'TV');
      assert.equal(mapped.status, 'Finished');
      assert.equal(mapped.episode_count, 12);
      assert.equal(mapped.art, 'https://animehot.cc/storage/media/poster.jpg');
      assert.equal(mapped.key_art, 'https://animehot.cc/storage/media/landscape.jpg');
      assert.ok(mapped.accent.startsWith('#'));

      const sources = JSON.parse(mapped.source_ids);
      assert.equal(sources.hianime, 'solo-leveling-e5tfvj');
      assert.equal(sources.mal, 52299);
      assert.ok(mapped.cloud_synced_at > 0);
    });

    it('merges existing source_ids without losing prior provenance (AniList, Kitsu)', () => {
      const raw = {
        title: 'Frieren: Beyond Journey\'s End',
        slug: 'frieren-beyond-journeys-end-815',
        mal_id: 52991,
      };

      const existingRow = {
        id: 'frieren-beyond-journeys-end',
        source_ids: JSON.stringify({ anilist: 154587, kitsu: 46474 }),
      };

      const mapped = mapHiAnimeItem(raw, existingRow);
      assert.ok(mapped);
      const sources = JSON.parse(mapped.source_ids);
      assert.equal(sources.anilist, 154587);
      assert.equal(sources.kitsu, 46474);
      assert.equal(sources.hianime, 'frieren-beyond-journeys-end-815');
      assert.equal(sources.mal, 52991);
    });

    it('returns null on invalid or missing title and slug', () => {
      assert.equal(mapHiAnimeItem(null), null);
      assert.equal(mapHiAnimeItem({ title: '' }), null);
      assert.equal(mapHiAnimeItem({ slug: '' }), null);
    });
  });

  describe('paletteAccent', () => {
    it('produces deterministic hex colors based on ID hash', () => {
      const color1 = paletteAccent('solo-leveling');
      const color2 = paletteAccent('solo-leveling');
      assert.equal(color1, color2);
      assert.ok(/^#[0-9a-f]{6}$/i.test(color1));
    });
  });

  describe('fetchHiAnimePage', () => {
    it('fetches real catalog items from HiAnime endpoint', async () => {
      const page = await fetchHiAnimePage(1, 10, AbortSignal.timeout(15_000));
      assert.ok(page);
      assert.ok(Array.isArray(page.results));
      assert.ok(page.results.length > 0);
      assert.ok(page.total > 100);
      assert.ok(page.totalPages > 10);
      assert.equal(page.page, 1);
      assert.ok(page.results[0].title);
      assert.ok(page.results[0].slug);
    });
  });
});
