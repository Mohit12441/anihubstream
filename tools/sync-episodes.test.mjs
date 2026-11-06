// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  fetchEpisodesFromKitsu,
  fetchAniSkipMarkers,
  syncAnime,
  syncEpisodes,
} from './sync-episodes.mjs';

function createMockDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE anime (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT,
      art TEXT,
      key_art TEXT,
      episode_total INTEGER,
      rating REAL,
      skip_key_id TEXT
    );

    CREATE TABLE anime_id_map (
      anime_id TEXT PRIMARY KEY REFERENCES anime(id),
      mal_id INTEGER,
      anilist_id INTEGER,
      kitsu_id INTEGER
    );

    CREATE TABLE episode (
      id TEXT PRIMARY KEY,
      anime_id TEXT NOT NULL REFERENCES anime(id),
      n INTEGER NOT NULL,
      title TEXT NOT NULL,
      runtime TEXT NOT NULL,
      runtime_seconds INTEGER NOT NULL,
      thumb TEXT NOT NULL,
      synopsis TEXT NOT NULL,
      markers TEXT NOT NULL,
      airdate TEXT,
      external_id TEXT,
      UNIQUE (anime_id, n)
    );
  `);
  return db;
}

test('fetchEpisodesFromKitsu returns empty array on null or falsy kitsuId', async () => {
  assert.deepEqual(await fetchEpisodesFromKitsu(null), []);
  assert.deepEqual(await fetchEpisodesFromKitsu(0), []);
  assert.deepEqual(await fetchEpisodesFromKitsu(''), []);
});

test('fetchEpisodesFromKitsu paginates, extracts canonical titles, and filters specials', async () => {
  const mockFetch = async (url) => {
    const urlStr = String(url);
    if (urlStr.includes('page[offset]=0') || urlStr.includes('offset]=0')) {
      return {
        ok: true,
        json: async () => ({
          data: [
            {
              id: '101',
              attributes: {
                number: 1,
                canonicalTitle: 'Cruelty',
                synopsis: 'Tanjiro returns home to a tragedy.',
                thumbnail: { original: 'https://kitsu.io/thumb1.jpg' },
                length: 24,
                airdate: '2019-04-06',
              },
            },
            {
              id: '102',
              attributes: {
                number: 0, // Special / prologue -> should be skipped
                canonicalTitle: 'Prologue Special',
              },
            },
            {
              id: '103',
              attributes: {
                number: 2,
                titles: { en: 'Trainer Sakonji Urokodaki' },
                synopsis: '',
                thumbnail: { medium: 'https://kitsu.io/thumb2-med.jpg' },
                length: 23,
                airdate: '2019-04-13',
              },
            },
          ],
          links: { next: 'https://kitsu.io/api/edge/episodes?page%5Boffset%5D=3' },
        }),
      };
    }

    if (urlStr.includes('page[offset]=3') || urlStr.includes('offset]=3')) {
      return {
        ok: true,
        json: async () => ({
          data: [
            {
              id: '104',
              attributes: {
                number: 3,
                canonicalTitle: 'Sabito and Makomo',
                length: 24,
              },
            },
          ],
          links: {},
        }),
      };
    }

    return { ok: false, status: 404 };
  };

  const results = await fetchEpisodesFromKitsu(41370, { fetchFn: mockFetch, pageLimit: 3, maxPages: 2 });
  assert.equal(results.length, 3);
  assert.equal(results[0].num, 1);
  assert.equal(results[0].title, 'Cruelty');
  assert.equal(results[0].thumb, 'https://kitsu.io/thumb1.jpg');
  assert.equal(results[0].lengthMin, 24);

  assert.equal(results[1].num, 2);
  assert.equal(results[1].title, 'Trainer Sakonji Urokodaki');
  assert.equal(results[1].thumb, 'https://kitsu.io/thumb2-med.jpg');

  assert.equal(results[2].num, 3);
  assert.equal(results[2].title, 'Sabito and Makomo');
});

test('fetchEpisodesFromKitsu recovers from network failure gracefully', async () => {
  const failFetch = async () => {
    throw new Error('Kitsu gateway timeout');
  };
  const results = await fetchEpisodesFromKitsu(99999, { fetchFn: failFetch });
  assert.deepEqual(results, []);
});

test('fetchAniSkipMarkers extracts OP, ED, and recap intervals correctly', async () => {
  const mockFetch = async () => ({
    ok: true,
    json: async () => ({
      found: true,
      results: [
        { skipType: 'op', interval: { startTime: 90.5, endTime: 180.2 } },
        { skipType: 'ed', interval: { startTime: 1350.0, endTime: 1440.0 } },
      ],
    }),
  });

  const markers = await fetchAniSkipMarkers(38000, 1, { fetchFn: mockFetch });
  assert.equal(markers.length, 2);
  assert.deepEqual(markers[0], { kind: 'intro', start: 91, end: 180, label: 'Opening' });
  assert.deepEqual(markers[1], { kind: 'outro', start: 1350, end: 1440, label: 'Ending' });
});

test('syncAnime skips upcoming anime to avoid phantom episode shells', async () => {
  const db = createMockDb();
  db.prepare(`
    INSERT INTO anime (id, title, status, episode_total)
    VALUES ('chainsaw-man-movie', 'Chainsaw Man: Reze Arc', 'Upcoming', 1)
  `).run();

  const res = await syncAnime({
    id: 'chainsaw-man-movie',
    title: 'Chainsaw Man: Reze Arc',
    status: 'Upcoming',
    kitsu_id: 12345,
  }, { dbInstance: db });

  assert.equal(res.synced, 0);
  const eps = db.prepare('SELECT count(1) as c FROM episode WHERE anime_id = ?').get('chainsaw-man-movie');
  assert.equal(eps.c, 0);
});

test('syncAnime syncs Kitsu metadata and falls back to keyArt when thumbnails are missing', async () => {
  const db = createMockDb();
  db.prepare(`
    INSERT INTO anime (id, title, status, art, key_art, episode_total)
    VALUES ('frieren', 'Frieren: Beyond Journeys End', 'Finished', 'https://art/frieren.jpg', 'https://art/frieren-key.jpg', 2)
  `).run();

  const mockFetch = async (url) => {
    if (String(url).includes('kitsu.io')) {
      return {
        ok: true,
        json: async () => ({
          data: [
            {
              id: '901',
              attributes: {
                number: 1,
                canonicalTitle: "The Journey's End",
                thumbnail: { original: 'https://kitsu.io/frieren-ep1.jpg' },
                length: 24,
                airdate: '2023-09-29',
              },
            },
            {
              id: '902',
              attributes: {
                number: 2,
                canonicalTitle: '', // Empty canonical title -> Fallback to Episode 2
                thumbnail: null,   // Null thumbnail -> Fallback to anime key_art
                length: 24,
                airdate: '2023-09-29',
              },
            },
          ],
          links: {},
        }),
      };
    }
    return { ok: false };
  };

  const res = await syncAnime({
    id: 'frieren',
    title: "Frieren: Beyond Journey's End",
    status: 'Finished',
    art: 'https://art/frieren.jpg',
    key_art: 'https://art/frieren-key.jpg',
    kitsu_id: 46543,
    episode_total: 2,
  }, { dbInstance: db, skipAniSkip: true, fetchFn: mockFetch });

  assert.equal(res.synced, 2);

  const rows = db.prepare('SELECT * FROM episode WHERE anime_id = ? ORDER BY n').all('frieren');
  assert.equal(rows.length, 2);

  // Episode 1 has Kitsu title and thumbnail
  assert.equal(rows[0].title, 'The Journey\'s End');
  assert.equal(rows[0].thumb, 'https://kitsu.io/frieren-ep1.jpg');
  assert.equal(rows[0].runtime, '24:00');
  assert.equal(rows[0].airdate, '2023-09-29');

  // Episode 2 falls back cleanly
  assert.equal(rows[1].title, 'Episode 2');
  assert.equal(rows[1].thumb, 'https://art/frieren-key.jpg');
});
