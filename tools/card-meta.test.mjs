import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatCardMeta } from '../src/lib/cardMeta.ts';

describe('TASK 6 (P1) — CardMeta unified card template', () => {
  it('formats standard TV series with "{Format} · {Year} · {epCount} EP"', () => {
    const anime = {
      kind: 'TV',
      year: 2024,
      episodeCount: 12,
      episodeTotal: 12,
    };
    assert.equal(formatCardMeta(anime), 'TV · 2024 · 12 EP');
  });

  it('uses "TBA" when episode count is 0, null, or undefined', () => {
    const unreleased = {
      kind: 'TV',
      year: 2026,
      episodeCount: 0,
      episodeTotal: null,
    };
    assert.equal(formatCardMeta(unreleased), 'TV · 2026 · TBA');

    const ongoingNoCount = {
      kind: 'ONA',
      year: 2025,
      episodeCount: 0,
      episodeTotal: undefined,
    };
    assert.equal(formatCardMeta(ongoingNoCount), 'ONA · 2025 · TBA');
  });

  it('formats Movie and OVA formats cleanly', () => {
    const movie = {
      kind: 'Movie',
      year: 2023,
      episodeCount: 1,
      episodeTotal: 1,
    };
    assert.equal(formatCardMeta(movie), 'Movie · 2023 · 1 EP');

    const ova = {
      kind: 'OVA',
      year: 2022,
      episodeCount: 3,
      episodeTotal: 3,
    };
    assert.equal(formatCardMeta(ova), 'OVA · 2022 · 3 EP');
  });

  it('handles missing year without outputting 0 or empty dots', () => {
    const special = {
      kind: 'Special',
      year: 0,
      episodeCount: 1,
      episodeTotal: 1,
    };
    assert.equal(formatCardMeta(special), 'Special · 1 EP');
  });

  it('strictly prevents duplicate tokens across all fields', () => {
    // If somehow kind or custom tokens duplicated the year or format:
    const buggyDuplicateTokens = {
      kind: '2026',
      year: 2026,
      episodeCount: 0,
      episodeTotal: null,
    };
    // Must not produce "2026 · 2026 · TBA"
    assert.equal(formatCardMeta(buggyDuplicateTokens), '2026 · TBA');
  });

  it('supports explicit episode override while preserving unified format', () => {
    const anime = {
      kind: 'TV',
      year: 2024,
      episodeCount: 24,
      episodeTotal: 24,
    };
    assert.equal(formatCardMeta(anime, 'EP 5'), 'TV · 2024 · EP 5');
    assert.equal(formatCardMeta(anime, '8'), 'TV · 2024 · 8 EP');
  });
});
