// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet as onInstantSearchGet } from '../functions/api/search/instant.js';

describe('Instant Search Endpoint Tests', () => {
  it('returns empty hits array on empty query', async () => {
    const req = new Request('http://127.0.0.1:8899/api/search/instant?q=');
    const res = await onInstantSearchGet({ request: req, env: {} });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.query, '');
    assert.deepEqual(json.hits, []);
    assert.equal(json.estimatedTotalHits, 0);
  });

  it('handles missing database gracefully without crashing', async () => {
    const req = new Request('http://127.0.0.1:8899/api/search/instant?q=solo');
    const res = await onInstantSearchGet({ request: req, env: {} });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.query, 'solo');
    assert.deepEqual(json.hits, []);
    assert.equal(json.engine, 'none');
  });

  it('expands acronyms and tokenizes words on D1 query', async () => {
    let capturedSql = '';
    let capturedParams = [];

    const mockDb = {
      prepare: (sql) => {
        capturedSql = sql;
        return {
          bind: (...params) => {
            capturedParams = params;
            return {
              all: async () => ({
                results: [
                  {
                    id: 'jujutsu-kaisen',
                    title: 'Jujutsu Kaisen',
                    native: '呪術廻戦',
                    year: 2020,
                    rating: 8.6,
                    kind: 'TV',
                    status: 'Finished',
                    art: 'https://example.com/jjk.jpg',
                    key_art: 'https://example.com/jjk_banner.jpg',
                    synopsis: 'Cursed spirits exist...',
                  },
                ],
              }),
            };
          },
        };
      },
    };

    const req = new Request('http://127.0.0.1:8899/api/search/instant?q=jjk&limit=6');
    const res = await onInstantSearchGet({ request: req, env: { ANIHUB: mockDb } });
    assert.equal(res.status, 200);
    const json = await res.json();

    assert.equal(json.query, 'jjk');
    assert.equal(json.hits.length, 1);
    assert.equal(json.hits[0].id, 'jujutsu-kaisen');
    assert.equal(json.hits[0].title, 'Jujutsu Kaisen');
    assert.equal(json.hits[0].year, 2020);
    assert.equal(json.hits[0].rating, 8.6);
    assert.equal(json.engine, 'd1_fallback');

    assert.ok(capturedParams.includes('jujutsu kaisen'), 'Acronym expanded to jujutsu kaisen');
    assert.ok(capturedSql.includes('a.search_text LIKE ?'), 'Queries against search_text index');
    assert.ok(capturedParams.includes(6), 'Respects limit parameter');
  });
});
