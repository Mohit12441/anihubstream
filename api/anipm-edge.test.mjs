import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAniPmBetaDirect } from '../functions/api/_anipm.js';

test('AniPM Edge Resolver Suite', async (t) => {
  await t.test('resolves Black Clover Season 2 (195604) correctly', async () => {
    const res = await resolveAniPmBetaDirect({ anilistId: 195604, ep: 1 });
    assert.equal(res.status, 'ready');
    assert.match(res.streamUrl, /\/api\/test-proxy\?u=/);
    assert.match(res.masterUrl, /https:\/\/beta\.cno\.to\/hls\/195604-black-clover-season-2\/E0001\/master\.m3u8/);
  });

  await t.test('resolves Solo Leveling (151807) correctly without defaulting to 195604', async () => {
    const res = await resolveAniPmBetaDirect({ anilistId: 151807, ep: 2 });
    assert.equal(res.status, 'ready');
    assert.match(res.masterUrl, /https:\/\/beta\.cno\.to\/hls\/151807-solo-leveling\/E0002\/master\.m3u8/);
    assert.ok(!res.masterUrl.includes('195604'));
  });

  await t.test('resolves Jujutsu Kaisen by slug correctly', async () => {
    const res = await resolveAniPmBetaDirect({ slug: 'jujutsu-kaisen', ep: 1 });
    assert.equal(res.status, 'ready');
    assert.match(res.masterUrl, /https:\/\/beta\.cno\.to\/hls\/113415-jujutsu-kaisen\/E0001\/master\.m3u8/);
  });

  await t.test('resolves Demon Slayer correctly with exact AniPM slug', async () => {
    const res = await resolveAniPmBetaDirect({ anilistId: 101922, ep: 1 });
    assert.equal(res.status, 'ready');
    assert.match(res.masterUrl, /https:\/\/beta\.cno\.to\/hls\/101922-demon-slayer-kimetsu-no-yaiba\/E0001\/master\.m3u8/);
  });

  await t.test('returns unavailable when AniList ID cannot be resolved', async () => {
    const res = await resolveAniPmBetaDirect({ slug: 'completely-unknown-random-slug-xyz', ep: 1 });
    assert.equal(res.status, 'unavailable');
    assert.equal(res.streamUrl, null);
  });
});
