import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalMergeKey,
  scoreSlug,
  chooseStableSlug,
  mergeRows,
  deduplicateRows,
  assertNoDuplicateMergeKeys,
} from './sync-catalogue.mjs';

describe('Task 1: Catalogue Deduplication', () => {
  describe('canonicalMergeKey', () => {
    it('prefers AniList ID when present in row or sourceIds', () => {
      const row = {
        id: 'sousou-no-frieren',
        sourceIds: JSON.stringify({ kitsu: 46170, anilist: 154587, mal: 52991 }),
      };
      assert.equal(canonicalMergeKey(row), 'anilist:154587');
    });

    it('falls back to Kitsu ID when AniList ID is absent', () => {
      const row = {
        id: 'some-anime',
        sourceIds: JSON.stringify({ kitsu: 12345, mal: 9999 }),
      };
      assert.equal(canonicalMergeKey(row), 'kitsu:12345');
    });

    it('falls back to normalised (title_romaji + year + format) when IDs absent', () => {
      const row = {
        id: 'custom-anime',
        titleRomaji: 'Shingeki no Kyojin',
        year: 2013,
        kind: 'TV',
      };
      assert.equal(canonicalMergeKey(row), 'norm:shingekinokyojin:2013:tv');
    });
  });

  describe('chooseStableSlug', () => {
    it('chooses stable canonical slug for all 7 confirmed duplicate pairs', () => {
      // 1. demon-slayer (shortest, base)
      assert.equal(
        chooseStableSlug('demon-slayer', 'demon-slayer-kimetsu-no-yaiba'),
        'demon-slayer',
      );
      assert.equal(
        chooseStableSlug('demon-slayer-kimetsu-no-yaiba', 'demon-slayer'),
        'demon-slayer',
      );

      // 2. sousou-no-frieren (shorter, romanised)
      assert.equal(
        chooseStableSlug('sousou-no-frieren', 'frieren-beyond-journey-s-end'),
        'sousou-no-frieren',
      );

      // 3. cyberpunk-edgerunners-ii (no arabic numeric suffix)
      assert.equal(
        chooseStableSlug('cyberpunk-edgerunners-ii', 'cyberpunk-edgerunners-2'),
        'cyberpunk-edgerunners-ii',
      );

      // 4. kusuriya-no-hitorigoto-3rd-season (romanised, no trailing numeric suffix)
      assert.equal(
        chooseStableSlug('kusuriya-no-hitorigoto-3rd-season', 'the-apothecary-diaries-season-3'),
        'kusuriya-no-hitorigoto-3rd-season',
      );

      // 5. tokyo-revengers-zokuhen (shorter, romanised)
      assert.equal(
        chooseStableSlug('tokyo-revengers-zokuhen', 'tokyo-revengers-war-of-the-three-titans-arc'),
        'tokyo-revengers-zokuhen',
      );

      // 6. ao-no-hako-2 (shorter, romanised)
      assert.equal(
        chooseStableSlug('ao-no-hako-2', 'blue-box-season-2'),
        'ao-no-hako-2',
      );

      // 7. the-laid-off-cheat-granting-mage-enjoys-a-second-lease-on-life (full title, not truncated at preposition)
      assert.equal(
        chooseStableSlug(
          'the-laid-off-cheat-granting-mage-enjoys-a-second-lease-on-life',
          'the-laid-off-cheat-granting-mage-enjoys-a-second-lease-on',
        ),
        'the-laid-off-cheat-granting-mage-enjoys-a-second-lease-on-life',
      );
    });
  });

  describe('mergeRows', () => {
    it('merges data preferring AniList for rating, episode count, schedule and combining sourceIds', () => {
      const canonical = {
        id: 'sousou-no-frieren',
        title: 'Frieren: Beyond Journey’s End',
        rating: 9.1,
        episodeTotal: 28,
        schedule: { day: 5, time: '14:00' },
        sourceIds: JSON.stringify({ anilist: 154587, mal: 52991 }),
        genres: ['fantasy', 'adventure'],
        altSeasons: ['Frieren Season 2'],
      };
      const other = {
        id: 'frieren-beyond-journey-s-end',
        title: 'Sousou no Frieren',
        rating: 8.9,
        episodeTotal: 24,
        sourceIds: JSON.stringify({ kitsu: 46170 }),
        genres: ['drama', 'fantasy'],
        altSeasons: [],
        synopsis: 'Kitsu synopsis',
      };

      const merged = mergeRows(canonical, other);
      assert.equal(merged.id, 'sousou-no-frieren');
      assert.equal(merged.rating, 9.1);
      assert.equal(merged.episodeTotal, 28);
      assert.deepEqual(merged.schedule, { day: 5, time: '14:00' });
      assert.equal(merged.synopsis, 'Kitsu synopsis');

      const parsedSources = JSON.parse(merged.sourceIds);
      assert.equal(parsedSources.anilist, 154587);
      assert.equal(parsedSources.kitsu, 46170);
      assert.equal(parsedSources.mal, 52991);

      assert.ok(merged.genres.includes('fantasy'));
      assert.ok(merged.genres.includes('adventure'));
      assert.ok(merged.genres.includes('drama'));
    });
  });

  describe('deduplicateRows & assertNoDuplicateMergeKeys', () => {
    it('deduplicates matching rows into unique set', () => {
      const rows = [
        {
          id: 'sousou-no-frieren',
          sourceIds: JSON.stringify({ kitsu: 46170, anilist: 154587 }),
          rating: 8.9,
          genres: ['fantasy'],
        },
        {
          id: 'frieren-beyond-journey-s-end',
          sourceIds: JSON.stringify({ anilist: 154587 }),
          rating: 9.1,
          genres: ['adventure'],
        },
        {
          id: 'demon-slayer',
          sourceIds: JSON.stringify({ anilist: 101922 }),
          rating: 8.6,
          genres: ['action'],
        },
      ];

      const deduped = deduplicateRows(rows);
      assert.equal(deduped.length, 2);
      assert.equal(deduped[0].id, 'sousou-no-frieren');
      assert.equal(deduped[0].rating, 8.9);
      assert.equal(deduped[1].id, 'demon-slayer');

      // assertNoDuplicateMergeKeys passes on deduplicated output
      assert.doesNotThrow(() => assertNoDuplicateMergeKeys(deduped));
    });

    it('throws if duplicate merge keys are present', () => {
      const duplicateRows = [
        { id: 'demon-slayer', sourceIds: JSON.stringify({ anilist: 101922 }) },
        { id: 'demon-slayer-kimetsu-no-yaiba', sourceIds: JSON.stringify({ anilist: 101922 }) },
      ];

      assert.throws(
        () => assertNoDuplicateMergeKeys(duplicateRows),
        /Duplicate merge key 'anilist:101922' detected for 'demon-slayer-kimetsu-no-yaiba'/,
      );
    });
  });
});

import { formatEpisodeCount, formatRuntime, formatSeason } from '../src/data/model.ts';

describe('Task 2: Fill missing/placeholder data', () => {
  describe('formatEpisodeCount', () => {
    it('returns "TBA" when episode count is 0, null, or undefined', () => {
      assert.equal(formatEpisodeCount({ episodeCount: 0, episodeTotal: null }), 'TBA');
      assert.equal(formatEpisodeCount({ episodeCount: 0, episodeTotal: undefined }), 'TBA');
      assert.equal(formatEpisodeCount({ episodeCount: 0, episodeTotal: 0 }), 'TBA');
    });

    it('returns count + " EP" when count is positive', () => {
      assert.equal(formatEpisodeCount({ episodeCount: 12, episodeTotal: 12 }), '12 EP');
      assert.equal(formatEpisodeCount({ episodeCount: 0, episodeTotal: 24 }), '24 EP');
    });
  });

  describe('formatRuntime', () => {
    it('returns "—" for 0, 0:00, 0m or empty values', () => {
      assert.equal(formatRuntime(null), '—');
      assert.equal(formatRuntime(''), '—');
      assert.equal(formatRuntime('0'), '—');
      assert.equal(formatRuntime('0:00'), '—');
      assert.equal(formatRuntime('0m'), '—');
    });

    it('preserves valid runtime strings', () => {
      assert.equal(formatRuntime('23:40'), '23:40');
      assert.equal(formatRuntime('1:44:00'), '1:44:00');
    });
  });

  describe('formatSeason', () => {
    it('cleans season strings and omits sentinel', () => {
      assert.equal(formatSeason('—', null, 2024), '2024');
      assert.equal(formatSeason('', 'Fall 2026', 2026), 'Fall 2026');
      assert.equal(formatSeason('Spring 2024', null, 2024), 'Spring 2024');
      assert.equal(formatSeason(null, null, null), '');
    });
  });
});

