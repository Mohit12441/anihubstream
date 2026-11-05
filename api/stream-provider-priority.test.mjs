import test from 'node:test';
import assert from 'node:assert/strict';
import { getAdapter, listAdapters, listAdapterIds } from './adapters/registry.mjs';

test('Provider Latency Tiers: Adapters sorted by speed and latency tiers', () => {
  const adapters = listAdapters();
  const ids = listAdapterIds();

  // Tier 1 Fast Extractors (<150ms)
  assert.ok(getAdapter('anipm').priority >= 115, 'AniPM must be Tier 1 (priority >= 115)');
  assert.ok(getAdapter('animewave').priority >= 110, 'AnimeWave must be Tier 1 (priority >= 110)');
  assert.ok(getAdapter('watchanimeworld').priority >= 105, 'WatchAnimeWorld must be Tier 1 (priority >= 105)');

  // Tier 2 Direct / HTML Fallbacks
  assert.ok(getAdapter('anidisk').priority >= 100, 'AniDisk must be Tier 2 (priority >= 100)');
  assert.ok(getAdapter('animekai').priority >= 95, 'AnimeKai must be Tier 2 (priority >= 95)');
  assert.ok(getAdapter('hdrezka').priority >= 90, 'HDRezka must be Tier 2 (priority >= 90)');
  assert.ok(getAdapter('animeflv').priority >= 85, 'AnimeFLV must be Tier 2 (priority >= 85)');
  assert.ok(getAdapter('jkanime').priority >= 80, 'JKAnime must be Tier 2 (priority >= 80)');

  // Tier 3 Heavy Cipher / Anti-Bot Extractors
  assert.ok(getAdapter('aniwatch').priority >= 75, 'AniWatch must be Tier 3 (priority >= 75)');
  assert.ok(getAdapter('hianime').priority >= 70, 'HiAnime must be Tier 3 (priority >= 70)');
  assert.ok(getAdapter('anikoto').priority >= 65, 'AniKoto must be Tier 3 (priority >= 65)');

  // Check hierarchy order
  const anipmIdx = ids.indexOf('anipm');
  const animewaveIdx = ids.indexOf('animewave');
  const wawIdx = ids.indexOf('watchanimeworld');
  const anidiskIdx = ids.indexOf('anidisk');
  const animekaiIdx = ids.indexOf('animekai');
  const hdrezkaIdx = ids.indexOf('hdrezka');
  const animeflvIdx = ids.indexOf('animeflv');
  const jkanimeIdx = ids.indexOf('jkanime');
  const aniwatchIdx = ids.indexOf('aniwatch');
  const hianimeIdx = ids.indexOf('hianime');
  const anikotoIdx = ids.indexOf('anikoto');

  assert.ok(anipmIdx < animewaveIdx, 'AniPM before AnimeWave');
  assert.ok(animewaveIdx < wawIdx, 'AnimeWave before WatchAnimeWorld');
  assert.ok(wawIdx < anidiskIdx, 'WatchAnimeWorld before AniDisk');
  assert.ok(anidiskIdx < animekaiIdx, 'AniDisk before AnimeKai');
  assert.ok(animekaiIdx < hdrezkaIdx, 'AnimeKai before HDRezka');
  assert.ok(hdrezkaIdx < animeflvIdx, 'HDRezka before AnimeFLV');
  assert.ok(animeflvIdx < jkanimeIdx, 'AnimeFLV before JKAnime');
  assert.ok(jkanimeIdx < aniwatchIdx, 'JKAnime before AniWatch');
  assert.ok(aniwatchIdx < hianimeIdx, 'AniWatch before HiAnime');
  assert.ok(hianimeIdx < anikotoIdx, 'HiAnime before AniKoto');
});
