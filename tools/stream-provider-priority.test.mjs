import { test } from 'node:test';
import assert from 'node:assert/strict';

function selectProvider({ rawRequested, availableSlugs, providerHealth }) {
  const defaultHealth = {
    anikoto: { status: 'healthy', latencyMs: 85 },
    hianime: { status: 'healthy', latencyMs: 140 },
    aniwatch: { status: 'healthy', latencyMs: 210 },
  };

  const health = { ...defaultHealth, ...(providerHealth || {}) };
  let requested = (rawRequested || '').toLowerCase().trim();

  if (!requested || requested === 'auto') {
    const candidates = ['anikoto', 'hianime', 'aniwatch'].filter((p) => availableSlugs[p]);
    if (candidates.length > 0) {
      candidates.sort((a, b) => {
        const healthA = health[a]?.status === 'healthy' ? 0 : 1;
        const healthB = health[b]?.status === 'healthy' ? 0 : 1;
        if (healthA !== healthB) return healthA - healthB;
        return (health[a]?.latencyMs || 999) - (health[b]?.latencyMs || 999);
      });
      requested = candidates[0];
    } else {
      requested = 'anikoto';
    }
  }

  const isScopedUnavailable = !availableSlugs[requested];

  return {
    selected: requested,
    isScopedUnavailable,
    providerHealth: health,
    availableProviders: [
      { id: 'anikoto', name: 'AniKoto', available: Boolean(availableSlugs.anikoto), ...(health.anikoto || {}) },
      { id: 'hianime', name: 'HiAnime', available: Boolean(availableSlugs.hianime), ...(health.hianime || {}) },
      { id: 'aniwatch', name: 'AniWatch', available: Boolean(availableSlugs.aniwatch), ...(health.aniwatch || {}) },
    ],
  };
}

test('selects fastest healthy provider when requested is auto or empty', () => {
  const result = selectProvider({
    rawRequested: 'auto',
    availableSlugs: { anikoto: 'solo-leveling', hianime: 'solo-leveling-18718', aniwatch: null },
    providerHealth: {
      anikoto: { status: 'healthy', latencyMs: 190 },
      hianime: { status: 'healthy', latencyMs: 95 },
      aniwatch: { status: 'healthy', latencyMs: 220 },
    },
  });

  assert.equal(result.selected, 'hianime');
  assert.equal(result.isScopedUnavailable, false);
});

test('prefers healthy provider over degraded provider even if degraded has lower latency', () => {
  const result = selectProvider({
    rawRequested: '',
    availableSlugs: { anikoto: 'naruto', hianime: 'naruto-677', aniwatch: 'naruto' },
    providerHealth: {
      anikoto: { status: 'degraded', latencyMs: 40 },
      hianime: { status: 'healthy', latencyMs: 120 },
      aniwatch: { status: 'healthy', latencyMs: 250 },
    },
  });

  assert.equal(result.selected, 'hianime');
});

test('respects explicit user provider request even if slower', () => {
  const result = selectProvider({
    rawRequested: 'aniwatch',
    availableSlugs: { anikoto: 'one-piece', hianime: 'one-piece-100', aniwatch: 'one-piece-sub' },
    providerHealth: {
      anikoto: { status: 'healthy', latencyMs: 50 },
      aniwatch: { status: 'healthy', latencyMs: 300 },
    },
  });

  assert.equal(result.selected, 'aniwatch');
  assert.equal(result.isScopedUnavailable, false);
});

test('flags scopedProviderUnavailable when explicit provider has no slug', () => {
  const result = selectProvider({
    rawRequested: 'aniwatch',
    availableSlugs: { anikoto: 'rare-ova', hianime: 'rare-ova-99', aniwatch: null },
    providerHealth: {
      anikoto: { status: 'healthy', latencyMs: 60 },
    },
  });

  assert.equal(result.selected, 'aniwatch');
  assert.equal(result.isScopedUnavailable, true);
  assert.equal(result.availableProviders.find((p) => p.id === 'aniwatch')?.available, false);
});

test('falls back to default baseline health if no health metrics in sync_meta', () => {
  const result = selectProvider({
    rawRequested: 'auto',
    availableSlugs: { anikoto: 'bleach', hianime: 'bleach-12', aniwatch: 'bleach-tv' },
    providerHealth: null,
  });

  // Default baseline has anikoto (85ms) < hianime (140ms) < aniwatch (210ms)
  assert.equal(result.selected, 'anikoto');
  assert.equal(result.providerHealth.anikoto.latencyMs, 85);
});
