// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet as onSearchGet } from '../functions/api/search.js';

describe('Consolidated Search Endpoint Tests', () => {
  it('rejects empty query parameter with 400', async () => {
    const req = new Request('http://127.0.0.1:8899/api/search?q=');
    const res = await onSearchGet({ request: req, env: {} });
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.error, 'bad_request');
  });

  it('handles null database gracefully without unhandled exceptions', async () => {
    const req = new Request('http://127.0.0.1:8899/api/search?q=frieren');
    const res = await onSearchGet({ request: req, env: {} });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.query, 'frieren');
    assert.ok(Array.isArray(json.results));
    assert.ok(typeof json.providers === 'object');
  });

  it('returns valid contract shape with total and results array', async () => {
    const mockDb = {
      prepare: () => ({
        bind: () => ({
          all: async () => ({
            results: [
              {
                id: 'test-anime',
                title: 'Test Anime Title',
                native: 'テスト',
                year: 2024,
                rating: 8.5,
                kind: 'TV',
                status: 'Ongoing',
                art: 'https://example.com/art.jpg',
                key_art: 'https://example.com/banner.jpg',
                episode_total: 12,
                genre_ids: 'action,adventure',
                provider_pairs: 'anikoto:test-anime,hianime:test-slug',
              },
            ],
          }),
        }),
      }),
    };

    const req = new Request('http://127.0.0.1:8899/api/search?q=test');
    const res = await onSearchGet({ request: req, env: { ANIHUB: mockDb } });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.total, 1);
    assert.equal(json.results[0].id, 'test-anime');
    assert.equal(json.results[0].title, 'Test Anime Title');
    assert.equal(json.results[0].providers.length, 2);
    assert.equal(json.results[0].providers[0].id, 'anikoto');
    assert.equal(json.results[0].providers[1].id, 'hianime');
    assert.ok(Array.isArray(json.providers.anikoto));
  });

  it('binds multi-word search tokens into AND clauses and expands acronyms', async () => {
    let capturedSql = '';
    let capturedParams = [];

    const mockDb = {
      prepare: (sql) => {
        capturedSql = sql;
        return {
          bind: (...params) => {
            capturedParams = params;
            return {
              all: async () => ({ results: [] }),
            };
          },
        };
      },
    };

    // 1. Acronym expansion
    const req1 = new Request('http://127.0.0.1:8899/api/search?q=jjk');
    await onSearchGet({ request: req1, env: { ANIHUB: mockDb } });
    assert.ok(capturedParams.includes('jujutsu kaisen'), 'Acronym expanded to jujutsu kaisen');
    assert.ok(capturedSql.includes('a.search_text LIKE ?'), 'Uses tokenized search_text matching');

    // 2. Multi-word tokenization
    const req2 = new Request('http://127.0.0.1:8899/api/search?q=attack+titan');
    await onSearchGet({ request: req2, env: { ANIHUB: mockDb } });
    assert.ok(capturedSql.includes('AND'), 'Combines multiple search words with AND');
    assert.ok(capturedParams.some((p) => p.includes('attack')), 'Includes first token');
    assert.ok(capturedParams.some((p) => p.includes('titan')), 'Includes second token');
  });
});
