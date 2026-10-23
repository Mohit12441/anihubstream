// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  probeAniKotoSlug,
  probeHiAnimeSlug,
  probeAniWatchSlug,
  validateProviderHealth,
  PROVIDER_HEALTH_SAMPLE_SIZE,
} from './validate-providers.mjs';

test('validate-providers exports expected functions and constants', () => {
  assert.equal(typeof probeAniKotoSlug, 'function');
  assert.equal(typeof probeHiAnimeSlug, 'function');
  assert.equal(typeof probeAniWatchSlug, 'function');
  assert.equal(typeof validateProviderHealth, 'function');
  assert.equal(typeof PROVIDER_HEALTH_SAMPLE_SIZE, 'number');
  assert.ok(PROVIDER_HEALTH_SAMPLE_SIZE > 0);
});

test('slug probes return false when slug is empty or null', async () => {
  assert.equal(await probeAniKotoSlug(''), false);
  assert.equal(await probeHiAnimeSlug(null), false);
  assert.equal(await probeAniWatchSlug(undefined), false);
});
