import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveFranchiseSeasons } from '../functions/api/_lib.js';

test('resolveFranchiseSeasons: franchise resolution and season navigation', async (t) => {
  await t.test('returns empty array when db or card is missing or invalid', async () => {
    assert.deepEqual(await resolveFranchiseSeasons(null, null), []);
    assert.deepEqual(await resolveFranchiseSeasons({}, null), []);
  });

  await t.test('resolves direct alt_seasons from mock db and marks current season', async () => {
    const mockDb = {
      prepare(query) {
        return {
          bind(...args) {
            return {
              async first() {
                if (query.includes('WHERE lower(title) = lower(?1)')) {
                  const title = args[0].toLowerCase();
                  if (title.includes('season 2')) {
                    return {
                      id: 'frieren-beyond-journeys-end-season-2',
                      title: 'Frieren: Beyond Journey’s End Season 2',
                      season: 'Year 2026',
                      year: 2026,
                      kind: 'TV',
                    };
                  }
                }
                return null;
              },
              async all() {
                return { results: [] };
              },
            };
          },
        };
      },
    };

    const card = {
      id: 'sousou-no-frieren',
      title: 'Frieren: Beyond Journey’s End',
      season: 'Fall 2023',
      year: 2023,
      kind: 'TV',
      alt_seasons: JSON.stringify(['Frieren: Beyond Journey’s End Season 2 (2026)']),
    };

    const seasons = await resolveFranchiseSeasons(mockDb, card);
    assert.equal(seasons.length, 2);
    assert.equal(seasons[0].id, 'sousou-no-frieren');
    assert.equal(seasons[0].isCurrent, true);
    assert.equal(seasons[0].year, 2023);

    assert.equal(seasons[1].id, 'frieren-beyond-journeys-end-season-2');
    assert.equal(seasons[1].isCurrent, false);
    assert.equal(seasons[1].year, 2026);
  });

  await t.test('resolves hierarchical franchise siblings by base slug and orders by year', async () => {
    const mockDb = {
      prepare(query) {
        return {
          bind(...args) {
            return {
              async first() {
                return null;
              },
              async all() {
                if (query.includes('WHERE (id = ?1 OR id LIKE ?2)')) {
                  return {
                    results: [
                      {
                        id: 'jujutsu-kaisen',
                        title: 'JUJUTSU KAISEN',
                        season: 'Fall 2020',
                        year: 2020,
                        kind: 'TV',
                      },
                      {
                        id: 'jujutsu-kaisen-0',
                        title: 'Jujutsu Kaisen 0',
                        season: 'Year 2021',
                        year: 2021,
                        kind: 'Movie',
                      },
                    ],
                  };
                }
                return { results: [] };
              },
            };
          },
        };
      },
    };

    const card = {
      id: 'jujutsu-kaisen-season-2',
      title: 'JUJUTSU KAISEN Season 2',
      season: 'Summer 2023',
      year: 2023,
      kind: 'TV',
      alt_seasons: '[]',
    };

    const seasons = await resolveFranchiseSeasons(mockDb, card);
    assert.equal(seasons.length, 3);
    // Ordered chronologically: 2020 -> 2021 -> 2023
    assert.equal(seasons[0].id, 'jujutsu-kaisen');
    assert.equal(seasons[0].isCurrent, false);
    assert.equal(seasons[1].id, 'jujutsu-kaisen-0');
    assert.equal(seasons[1].isCurrent, false);
    assert.equal(seasons[2].id, 'jujutsu-kaisen-season-2');
    assert.equal(seasons[2].isCurrent, true);
  });

  await t.test('creates fallback slug when alt_season is not yet indexed in database', async () => {
    const mockDb = {
      prepare() {
        return {
          bind() {
            return {
              async first() {
                return null;
              },
              async all() {
                return { results: [] };
              },
            };
          },
        };
      },
    };

    const card = {
      id: 'standalone-anime',
      title: 'Standalone Anime',
      season: 'Winter 2024',
      year: 2024,
      kind: 'TV',
      alt_seasons: JSON.stringify(['Standalone Anime Season 2 (2027)']),
    };

    const seasons = await resolveFranchiseSeasons(mockDb, card);
    assert.equal(seasons.length, 2);
    assert.equal(seasons[0].id, 'standalone-anime');
    assert.equal(seasons[1].id, 'standalone-anime-season-2');
    assert.equal(seasons[1].year, 2027);
  });

  await t.test('prefers pre-indexed anime_franchise_relation when available', async () => {
    const mockDb = {
      prepare(query) {
        return {
          bind(...args) {
            return {
              async first() {
                return null;
              },
              async all() {
                if (query.includes('FROM anime_franchise_relation r')) {
                  return {
                    results: [
                      {
                        id: 'my-hero-academia-season-2',
                        title: 'My Hero Academia Season 2',
                        season: 'Spring 2017',
                        year: 2017,
                        kind: 'TV',
                        relation_type: 'sequel',
                        chronology_order: 1,
                      },
                      {
                        id: 'my-hero-academia-season-3',
                        title: 'My Hero Academia Season 3',
                        season: 'Spring 2018',
                        year: 2018,
                        kind: 'TV',
                        relation_type: 'sequel',
                        chronology_order: 2,
                      },
                    ],
                  };
                }
                return { results: [] };
              },
            };
          },
        };
      },
    };

    const card = {
      id: 'my-hero-academia',
      title: 'My Hero Academia',
      season: 'Spring 2016',
      year: 2016,
      kind: 'TV',
      alt_seasons: '[]',
    };

    const seasons = await resolveFranchiseSeasons(mockDb, card);
    assert.equal(seasons.length, 3);
    assert.equal(seasons[0].id, 'my-hero-academia');
    assert.equal(seasons[0].isCurrent, true);
    assert.equal(seasons[1].id, 'my-hero-academia-season-2');
    assert.equal(seasons[2].id, 'my-hero-academia-season-3');
  });
});
