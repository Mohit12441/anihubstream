// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getAdapter, listAdapterIds, listAdapters, registerAdapter } from './adapters/registry.mjs';
import { ANIME_INDEX_SETTINGS } from '../tools/meilisearch/setup-index.mjs';
import { parseAnimeFromSeed } from '../tools/meilisearch/sync-meilisearch.mjs';
import { onRequestGet as instantSearch } from '../functions/api/search/instant.js';
import { buildIdMappings, generateIdMapSql } from '../tools/sync-id-map.mjs';

describe('Phases 4 & 5: Meilisearch & Adapter Registry Tests', () => {
  describe('api/adapters/registry.mjs', () => {
    it('registers and retrieves all standard anime providers', () => {
      const ids = listAdapterIds();
      assert.ok(ids.includes('aniwatch'));
      assert.ok(ids.includes('hianime'));
      assert.ok(ids.includes('anikoto'));
      assert.ok(!ids.includes('animedubhindi'));
      assert.ok(ids.includes('watchanimeworld'));

      const anikoto = getAdapter('anikoto');
      assert.strictEqual(anikoto?.name, 'AniKoto');
      assert.strictEqual(anikoto?.defaultType, 'hls');

      const waw = getAdapter('watchanimeworld');
      assert.strictEqual(waw?.name, 'WatchAnimeWorld');
      assert.strictEqual(waw?.defaultType, 'mp4');
      assert.ok(waw?.supportedAudio.includes('hindi'));
    });

    it('allows registering a new provider with zero side-effects', () => {
      /** @type {any} */
      const customProvider = {
        id: 'testprovider',
        name: 'Test Provider',
        supportedAudio: ['sub'],
        defaultType: 'hls',
        priority: 50,
        search: async () => [],
        details: async () => ({}),
        sources: async () => ({ embeds: [] }),
      };

      registerAdapter(customProvider);
      const retrieved = getAdapter('testprovider');
      assert.strictEqual(retrieved?.id, 'testprovider');
      assert.strictEqual(retrieved?.name, 'Test Provider');
    });
  });

  describe('tools/meilisearch/setup-index.mjs', () => {
    it('exports valid Meilisearch configuration settings for anime search', () => {
      assert.ok(Array.isArray(ANIME_INDEX_SETTINGS.searchableAttributes));
      assert.ok(ANIME_INDEX_SETTINGS.searchableAttributes.includes('title'));
      assert.ok(ANIME_INDEX_SETTINGS.searchableAttributes.includes('synonyms'));

      assert.ok(Array.isArray(ANIME_INDEX_SETTINGS.rankingRules));
      assert.strictEqual(ANIME_INDEX_SETTINGS.rankingRules[0], 'words');
      assert.strictEqual(ANIME_INDEX_SETTINGS.rankingRules[1], 'typo');

      assert.strictEqual(ANIME_INDEX_SETTINGS.typoTolerance.enabled, true);
      assert.ok(ANIME_INDEX_SETTINGS.synonyms['attack on titan'].includes('shingeki no kyojin'));
      assert.ok(ANIME_INDEX_SETTINGS.synonyms['demon slayer'].includes('kimetsu no yaiba'));
    });
  });

  describe('tools/meilisearch/sync-meilisearch.mjs', () => {
    it('parses structured anime documents from seed.sql', () => {
      const docs = parseAnimeFromSeed();
      assert.ok(Array.isArray(docs));
      assert.ok(docs.length > 50);

      const first = docs[0];
      assert.ok(first.id);
      assert.ok(first.title);
      assert.ok(typeof first.year === 'number');
      assert.ok(typeof first.rating === 'number');
    });
  });

  describe('functions/api/search/instant.js', () => {
    it('returns empty result array when query is blank', async () => {
      const req = new Request('http://localhost/api/search/instant?q=');
      const res = await instantSearch({ request: req, env: {} });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.hits.length, 0);
      assert.strictEqual(data.engine, 'empty');
    });

    it('falls back to D1 catalogue search when Meilisearch is unavailable', async () => {
      const mockEnv = {
        MEILISEARCH_HOST: 'http://127.0.0.1:9999', // unreachable port
        ANIHUB: {
          prepare(sql) {
            return {
              bind(...args) {
                return {
                  async all() {
                    return {
                      results: [
                        {
                          id: 'solo-leveling',
                          title: 'Solo Leveling',
                          native: '俺だけレベルアップな件',
                          year: 2024,
                          rating: 8.6,
                          season: 'Winter 2024',
                          kind: 'TV',
                          status: 'Finished',
                          art: '/art/solo-leveling.jpg',
                          key_art: '/art/solo-leveling-key.jpg',
                          accent: '#3b82f6',
                          synopsis: 'Sung Jinwoo ascends as the shadow monarch.',
                        },
                      ],
                    };
                  },
                };
              },
            };
          },
        },
      };

      const req = new Request('http://localhost/api/search/instant?q=solo');
      const res = await instantSearch({ request: req, env: mockEnv });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.engine, 'd1_fallback');
      assert.strictEqual(data.hits.length, 1);
      assert.strictEqual(data.hits[0].id, 'solo-leveling');
    });
  });

  describe('tools/sync-id-map.mjs', () => {
    it('builds ID mappings and produces valid SQL seed script', () => {
      const mappings = buildIdMappings();
      assert.ok(Array.isArray(mappings));
      assert.ok(mappings.length > 50);

      const first = mappings[0];
      assert.ok(first.anime_id);
      assert.ok(first.anikoto_slug);
      assert.ok(typeof first.confidence === 'number');

      const sql = generateIdMapSql(mappings);
      assert.ok(sql.includes('INSERT INTO anime_id_map'));
      assert.ok(sql.includes('ON CONFLICT(anime_id) DO UPDATE'));
    });
  });
});
