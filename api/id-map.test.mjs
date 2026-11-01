// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet, onRequestPost } from '../functions/api/id-map.js';

describe('Edge API: /api/id-map Contract & Caching Suite', () => {
  const mockDb = {
    prepare: (query) => ({
      bind: (...args) => ({
        first: async () => {
          if (query.includes('FROM anime_id_map WHERE anime_id = ?1') && args[0] === 'demon-slayer') {
            return {
              anime_id: 'demon-slayer',
              mal_id: 38000,
              anilist_id: 101922,
              kitsu_id: 41370,
              anikoto_slug: 'demon-slayer-kimetsu-no-yaiba-rzepv',
              hianime_slug: 'demon-slayer-kimetsu-no-yaiba-5e3e2b',
              aniwatch_slug: null,
              adb_slug: null,
              waw_slug: null,
              updated_at: '2026-11-01 06:00:00',
            };
          }
          if (query.includes('FROM anime_id_map WHERE mal_id = ?1') && args[0] === 38000) {
            return {
              anime_id: 'demon-slayer',
              mal_id: 38000,
              anilist_id: 101922,
              kitsu_id: 41370,
              anikoto_slug: 'demon-slayer-kimetsu-no-yaiba-rzepv',
              hianime_slug: null,
              aniwatch_slug: null,
              adb_slug: null,
              waw_slug: null,
              updated_at: '2026-11-01 06:00:00',
            };
          }
          return null;
        },
        all: async () => {
          if (query.includes('FROM anime_provider_mapping WHERE anime_id = ?1')) {
            return {
              results: [
                { provider_id: 'anikoto', provider_slug: 'demon-slayer-kimetsu-no-yaiba-rzepv', confidence: 1.0 },
              ],
            };
          }
          return { results: [] };
        },
        run: async () => ({ success: true }),
      }),
    }),
  };

  const env = {
    ANIHUB: mockDb,
  };

  it('rejects requests with no identifiers with 400 Bad Request', async () => {
    const req = new Request('https://anihubstream.com/api/id-map');
    const res = await onRequestGet({ request: req, env, waitUntil: () => {} });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'bad_request');
  });

  it('resolves ID mapping by animeId with Edge cache headers', async () => {
    const req = new Request('https://anihubstream.com/api/id-map?animeId=demon-slayer');
    const res = await onRequestGet({ request: req, env, waitUntil: () => {} });
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('cache-control')?.includes('max-age='));
    const body = await res.json();
    assert.equal(body.found, true);
    assert.equal(body.animeId, 'demon-slayer');
    assert.equal(body.malId, 38000);
    assert.equal(body.anilistId, 101922);
    assert.equal(body.kitsuId, 41370);
    assert.equal(body.anikotoSlug, 'demon-slayer-kimetsu-no-yaiba-rzepv');
  });

  it('resolves ID mapping by malId', async () => {
    const req = new Request('https://anihubstream.com/api/id-map?malId=38000');
    const res = await onRequestGet({ request: req, env, waitUntil: () => {} });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.found, true);
    assert.equal(body.animeId, 'demon-slayer');
    assert.equal(body.malId, 38000);
  });

  it('returns 404 for unknown anime identifier', async () => {
    const req = new Request('https://anihubstream.com/api/id-map?animeId=completely-unknown-series-xyz');
    const res = await onRequestGet({ request: req, env, waitUntil: () => {} });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.found, false);
  });

  it('supports emergency cache bypass parameter', async () => {
    const req = new Request('https://anihubstream.com/api/id-map?animeId=demon-slayer&bypass=1');
    const res = await onRequestGet({ request: req, env, waitUntil: () => {} });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-d1-read'), '1-d1-bypassed');
  });
});
