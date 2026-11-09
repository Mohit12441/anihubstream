import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAnimeDoc, validateGenreList, validateReferenceDoc } from '../lib/data-schema.mjs';

test('data-schema: validates a valid anime document', () => {
  const sample = {
    id: 'frieren-beyond-journeys-end',
    title: "Frieren: Beyond Journey's End",
    native: '葬送のフリーレン',
    year: 2023,
    rating: 9.14,
    season: 'Fall 2023',
    kind: 'TV',
    status: 'Finished',
    art: 'https://media.kitsu.app/anime/poster_images/46474/medium.jpg',
    key_art: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/154587.jpg',
    accent: '#4a90e2',
    synopsis: 'An elf mage reflecting on time and mortality after defeating the Demon King.',
    rank: 1,
    genres: ['adventure', 'drama', 'fantasy'],
    source_ids: { anilist: 154587, mal: 52991, kitsu: 46474 },
    episode_total: 28,
    episodes: [
      {
        n: 1,
        title: "The Journey's End",
        runtime: '24:00',
        runtime_seconds: 1440,
        thumb: 'https://media.kitsu.app/episodes/thumbnails/1000/original.jpg',
        synopsis: 'Frieren and her party return triumphant.',
        airdate: '2023-09-29'
      }
    ],
    relations: [],
    themes: []
  };

  const res = validateAnimeDoc(sample);
  assert.equal(res.valid, true);
  assert.equal(res.errors.length, 0);
});

test('data-schema: rejects anime doc with missing id or invalid rating', () => {
  const invalidDoc = {
    title: 'Missing ID Anime',
    year: 2020,
    rating: 15.5 // rating > 10
  };

  const res = validateAnimeDoc(invalidDoc);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some(e => e.includes('id')));
  assert.ok(res.errors.some(e => e.includes('rating')));
});

test('data-schema: rejects malformed episode entries', () => {
  const badEpisodeDoc = {
    id: 'test-anime',
    title: 'Test Anime',
    year: 2024,
    rating: 8.0,
    episodes: [
      {
        n: -1, // invalid negative episode number
        title: 'Negative Episode'
      }
    ]
  };

  const res = validateAnimeDoc(badEpisodeDoc);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some(e => e.includes('episode')));
});

test('data-schema: validates genre list structure', () => {
  const validGenres = [
    { id: 'action', label: 'Action', tagline: 'Explosive Battles', art: 'key-demon-slayer', accent: '#ff1f4a', position: 0 },
    { id: 'fantasy', label: 'Fantasy', tagline: 'Magical Worlds', art: 'key-elf-mage', accent: '#a24bff', position: 1 }
  ];

  const res = validateGenreList(validGenres);
  assert.equal(res.valid, true);

  const invalidGenres = [{ id: 'action' }]; // missing label, accent, etc.
  const badRes = validateGenreList(invalidGenres);
  assert.equal(badRes.valid, false);
});

test('data-schema: validates reference docs (routes, relations, id_map)', () => {
  const validRoutes = [
    { provider_id: 'hianime', route_pattern: '/watch/:slug', target_upstream: 'megaplay' }
  ];
  assert.equal(validateReferenceDoc('provider_routes', validRoutes).valid, true);

  const validRelations = [
    { anime_id: 'naruto', related_anime_id: 'naruto-shippuden', relation_type: 'sequel' }
  ];
  assert.equal(validateReferenceDoc('franchise_relations', validRelations).valid, true);

  assert.equal(validateReferenceDoc('unknown_type', []).valid, false);
});
