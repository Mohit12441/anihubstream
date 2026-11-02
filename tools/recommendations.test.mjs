// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  tokenizeText,
  calculateJaccard,
  calculateAnimeSimilarity,
  buildUserProfile,
  getPersonalizedRecommendations,
  getContentRecommendations,
} from '../src/lib/recommendations.ts';

const mockAnimeA = {
  id: 'solo-leveling',
  title: 'Solo Leveling',
  native: '나 혼자만 레벨업',
  year: 2024,
  rating: 8.5,
  season: 'Winter 2024',
  kind: 'TV',
  status: 'Finished',
  genres: ['Action', 'Fantasy', 'Adventure'],
  poster: '/poster/sl.jpg',
  key: '/key/sl.jpg',
  accent: '#6366f1',
  synopsis: 'Sung Jinwoo ascends from the weakest hunter to the shadow monarch in a dangerous world of dungeons and monsters.',
  episodeCount: 12,
  episodes: [],
};

const mockAnimeB = {
  id: 'jujutsu-kaisen',
  title: 'Jujutsu Kaisen',
  native: '呪術廻戦',
  year: 2020,
  rating: 8.6,
  season: 'Fall 2020',
  kind: 'TV',
  status: 'Finished',
  genres: ['Action', 'Fantasy', 'Supernatural'],
  poster: '/poster/jjk.jpg',
  key: '/key/jjk.jpg',
  accent: '#ef4444',
  synopsis: 'Yuji Itadori swallows a cursed finger and enters Tokyo Jujutsu High to fight deadly curses and monsters.',
  episodeCount: 24,
  episodes: [],
};

const mockAnimeC = {
  id: 'horimiya',
  title: 'Horimiya',
  native: 'ホリミヤ',
  year: 2021,
  rating: 8.2,
  season: 'Winter 2021',
  kind: 'TV',
  status: 'Finished',
  genres: ['Romance', 'Comedy', 'Slice of Life'],
  poster: '/poster/hori.jpg',
  key: '/key/hori.jpg',
  accent: '#ec4899',
  synopsis: 'Hori and Miyamura discover each other secret sides outside of high school and fall in love.',
  episodeCount: 13,
  episodes: [],
};

test('Tokenization and Stop Words filtering', () => {
  const tokens = tokenizeText('The strongest hunter fighting monsters in another world!');
  assert.ok(!tokens.has('the'));
  assert.ok(!tokens.has('in'));
  assert.ok(!tokens.has('world'));
  assert.ok(tokens.has('strongest'));
  assert.ok(tokens.has('hunter'));
  assert.ok(tokens.has('monsters'));
});

test('Jaccard Similarity Calculation', () => {
  const set1 = ['Action', 'Fantasy', 'Adventure'];
  const set2 = ['Action', 'Fantasy', 'Supernatural'];
  // Intersection = 2 ('Action', 'Fantasy'), Union = 4 ('Action', 'Fantasy', 'Adventure', 'Supernatural')
  const jaccard = calculateJaccard(set1, set2);
  assert.equal(jaccard, 2 / 4);

  assert.equal(calculateJaccard(['A'], ['B']), 0);
  assert.equal(calculateJaccard(['A', 'B'], ['A', 'B']), 1);
});

test('Anime Similarity Scoring', () => {
  const simAB = calculateAnimeSimilarity(mockAnimeA, mockAnimeB);
  const simAC = calculateAnimeSimilarity(mockAnimeA, mockAnimeC);

  // Solo Leveling (Action, Fantasy) should be significantly closer to JJK (Action, Fantasy) than Horimiya (Romance)
  assert.ok(simAB.score > simAC.score, `Expected sim(SL, JJK) [${simAB.score}] > sim(SL, Horimiya) [${simAC.score}]`);
  assert.ok(simAB.sharedGenres.includes('Action'));
  assert.ok(simAB.sharedGenres.includes('Fantasy'));
  assert.equal(simAC.sharedGenres.length, 0);
});

test('User Profile Affinity Modeling', () => {
  const mockHistory = [
    {
      anime: mockAnimeA,
      episodeId: 'solo-leveling#1',
      episodeNumber: 1,
      episodeTitle: 'Episode 1',
      seconds: 1400,
      runtimeSeconds: 1440, // 97% completion
      updatedAt: new Date().toISOString(),
    },
  ];

  const profile = buildUserProfile(mockHistory, new Set(['solo-leveling']), []);
  assert.ok(profile.watchedIds.has('solo-leveling'));
  assert.ok(profile.favoriteIds.has('solo-leveling'));
  assert.ok(profile.genreWeights['Action'] > 0);
  assert.ok(profile.genreWeights['Fantasy'] > 0);
  assert.equal(profile.genreWeights['Romance'] || 0, 0);
});

test('Personalized Recommendations Generation & Watch Exclusion', () => {
  const mockHistory = [
    {
      anime: mockAnimeA,
      episodeId: 'solo-leveling#1',
      episodeNumber: 1,
      episodeTitle: 'Episode 1',
      seconds: 1400,
      runtimeSeconds: 1440,
      updatedAt: new Date().toISOString(),
    },
  ];

  const profile = buildUserProfile(mockHistory, new Set(['solo-leveling']), []);
  const candidates = [mockAnimeA, mockAnimeB, mockAnimeC];

  const recs = getPersonalizedRecommendations(candidates, profile, 5);

  // 1. Must exclude Solo Leveling because it is already watched
  assert.ok(!recs.some((r) => r.anime.id === 'solo-leveling'), 'Must exclude watched titles');

  // 2. Jujutsu Kaisen should be ranked top
  assert.ok(recs.length > 0);
  assert.equal(recs[0].anime.id, 'jujutsu-kaisen');
  assert.ok(recs[0].matchPercentage >= 70);
  assert.ok(recs[0].reason.includes('Because you watched Solo Leveling'));
});

test('Content-Based Recommendations for Target Anime', () => {
  const recs = getContentRecommendations(mockAnimeA, [mockAnimeA, mockAnimeB, mockAnimeC], 5);

  assert.equal(recs.length, 2);
  assert.equal(recs[0].anime.id, 'jujutsu-kaisen');
  assert.ok(recs[0].reason.includes('Shared Action, Fantasy'));
});
