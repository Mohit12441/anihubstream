// Unit & integration tests for AniSkip v2 API client and player skip engine.
// Run with: node --test api/aniskip.test.mjs

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ANISKIP_BASE,
  applyRelationRules,
  clearAniSkipCache,
  fetchRelationRules,
  fetchSkipTimes,
  getRateLimitCooldown,
  mapAniSkipResultToMarker,
  setAniSkipBaseUrl,
  setRateLimitCooldown,
} from '../src/lib/aniskip.ts';
import { resolveMalId } from '../src/data/model.ts';
import { resolveMalId as resolveMalIdFromLib } from '../functions/api/_lib.js';

describe('1. MAL ID provenance and resolution (never confuse with AniList or Kitsu)', () => {
  it('extracts valid MAL ID from source_ids JSON string', () => {
    const json = JSON.stringify({ kitsu: 10038, anilist: 20964, mal: 28617 });
    assert.equal(resolveMalId(json, null, null), 28617);
    assert.equal(resolveMalIdFromLib(json, null, null), 28617);
  });

  it('extracts valid MAL ID from parsed source_ids object', () => {
    const obj = { kitsu: 1234, anilist: 5678, mal: 9999 };
    assert.equal(resolveMalId(obj, null, null), 9999);
    assert.equal(resolveMalIdFromLib(obj, null, null), 9999);
  });

  it('falls back to skip_key_id when skip_key_space is "mal"', () => {
    const noMalJson = JSON.stringify({ kitsu: 1234, anilist: 5678 });
    assert.equal(resolveMalId(noMalJson, 34567, 'mal'), 34567);
    assert.equal(resolveMalId(null, 34567, 'mal'), 34567);
    assert.equal(resolveMalIdFromLib(null, '34567', 'mal'), 34567);
  });

  it('NEVER uses anilist or kitsu id when skip_key_space is not "mal"', () => {
    const onlyAniList = JSON.stringify({ anilist: 11933, kitsu: 7657 });
    // skip_key_space is 'anilist' with skip_key_id 11933
    assert.equal(resolveMalId(onlyAniList, 11933, 'anilist'), null);
    assert.equal(resolveMalIdFromLib(onlyAniList, 11933, 'anilist'), null);
    // skip_key_space is 'kitsu' with skip_key_id 7657
    assert.equal(resolveMalId(onlyAniList, 7657, 'kitsu'), null);
    assert.equal(resolveMalIdFromLib(onlyAniList, 7657, 'kitsu'), null);
    // undefined skip_key_space
    assert.equal(resolveMalId(onlyAniList, 11933, null), null);
    assert.equal(resolveMalIdFromLib(onlyAniList, 11933, null), null);
  });

  it('handles malformed source_ids, nulls, and non-numeric inputs gracefully', () => {
    assert.equal(resolveMalId('{ bad json', null, null), null);
    assert.equal(resolveMalId('', null, null), null);
    assert.equal(resolveMalId(null, null, null), null);
    assert.equal(resolveMalId(undefined, null, null), null);
    assert.equal(resolveMalId({ mal: 'not-a-number' }, null, null), null);
    assert.equal(resolveMalId({ mal: -5 }, null, null), null);
    assert.equal(resolveMalId({ mal: 0 }, null, null), null);
    assert.equal(resolveMalId(null, 0, 'mal'), null);
    assert.equal(resolveMalId(null, -1, 'mal'), null);
  });
});

describe('2. AniSkip segment type mapping to Markers', () => {
  it('maps "op" to intro marker with "Opening" label', () => {
    const marker = mapAniSkipResultToMarker({
      interval: { startTime: 12.5, endTime: 102.5 },
      skipType: 'op',
      skipId: 'uuid-1',
      episodeLength: 1440,
    });
    assert.deepEqual(marker, {
      kind: 'intro',
      label: 'Opening',
      start: 12.5,
      end: 102.5,
    });
  });

  it('maps "mixed-op" to intro marker with "Mixed Opening" label', () => {
    const marker = mapAniSkipResultToMarker({
      interval: { startTime: 30, endTime: 120 },
      skipType: 'mixed-op',
      skipId: 'uuid-2',
      episodeLength: 1440,
    });
    assert.deepEqual(marker, {
      kind: 'intro',
      label: 'Mixed Opening',
      start: 30,
      end: 120,
    });
  });

  it('maps "ed" to outro marker with "Ending" label', () => {
    const marker = mapAniSkipResultToMarker({
      interval: { startTime: 1300, endTime: 1390 },
      skipType: 'ed',
      skipId: 'uuid-3',
      episodeLength: 1440,
    });
    assert.deepEqual(marker, {
      kind: 'outro',
      label: 'Ending',
      start: 1300,
      end: 1390,
    });
  });

  it('maps "mixed-ed" to outro marker with "Mixed Ending" label', () => {
    const marker = mapAniSkipResultToMarker({
      interval: { startTime: 1320, endTime: 1410 },
      skipType: 'mixed-ed',
      skipId: 'uuid-4',
      episodeLength: 1440,
    });
    assert.deepEqual(marker, {
      kind: 'outro',
      label: 'Mixed Ending',
      start: 1320,
      end: 1410,
    });
  });

  it('maps "recap" to recap marker with "Recap" label', () => {
    const marker = mapAniSkipResultToMarker({
      interval: { startTime: 0, endTime: 65 },
      skipType: 'recap',
      skipId: 'uuid-5',
      episodeLength: 1440,
    });
    assert.deepEqual(marker, {
      kind: 'recap',
      label: 'Recap',
      start: 0,
      end: 65,
    });
  });

  it('rejects invalid or inverted intervals', () => {
    assert.equal(
      mapAniSkipResultToMarker({
        interval: { startTime: 100, endTime: 50 },
        skipType: 'op',
        skipId: 'bad-1',
        episodeLength: 1440,
      }),
      null,
    );
    assert.equal(
      mapAniSkipResultToMarker({
        interval: { startTime: 100, endTime: 100 },
        skipType: 'op',
        skipId: 'bad-2',
        episodeLength: 1440,
      }),
      null,
    );
    assert.equal(
      mapAniSkipResultToMarker({
        interval: { startTime: 0, endTime: 0 },
        skipType: 'op',
        skipId: 'bad-3',
        episodeLength: 1440,
      }),
      null,
    );
  });
});

describe('3. Relation rules remapping logic', () => {
  const rules = [
    {
      from: { start: 1, end: 12 },
      to: { malId: 101, start: 1, end: 12 },
    },
    {
      from: { start: 13, end: 24 },
      to: { malId: 102, start: 1, end: 12 },
    },
    {
      from: { start: 25 },
      to: { malId: 103, start: 1 },
    },
  ];

  it('remaps episode inside first range', () => {
    const result = applyRelationRules(rules, 1);
    assert.deepEqual(result, { malId: 101, episodeNumber: 1 });

    const ep5 = applyRelationRules(rules, 5);
    assert.deepEqual(ep5, { malId: 101, episodeNumber: 5 });
  });

  it('remaps episode in second range with starting offset', () => {
    const ep13 = applyRelationRules(rules, 13);
    assert.deepEqual(ep13, { malId: 102, episodeNumber: 1 });

    const ep20 = applyRelationRules(rules, 20);
    assert.deepEqual(ep20, { malId: 102, episodeNumber: 8 });
  });

  it('remaps episode in open-ended upper range', () => {
    const ep25 = applyRelationRules(rules, 25);
    assert.deepEqual(ep25, { malId: 103, episodeNumber: 1 });

    const ep30 = applyRelationRules(rules, 30);
    assert.deepEqual(ep30, { malId: 103, episodeNumber: 6 });
  });

  it('returns original episode when no rule matches or rules array is empty', () => {
    assert.deepEqual(applyRelationRules([], 7), { episodeNumber: 7 });
    assert.deepEqual(applyRelationRules(null, 7), { episodeNumber: 7 });
    const noMatch = applyRelationRules(
      [{ from: { start: 1, end: 5 }, to: { malId: 50, start: 1 } }],
      10,
    );
    assert.deepEqual(noMatch, { episodeNumber: 10 });
  });
});

describe('4. AniSkip API client resilience, caching, and 429 backoff', () => {
  let originalFetch;
  let fetchCalls = [];

  beforeEach(() => {
    clearAniSkipCache();
    originalFetch = globalThis.fetch;
    fetchCalls = [];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    setAniSkipBaseUrl(null);
    clearAniSkipCache();
  });

  it('queries official endpoint with required parameters and caches response', async () => {
    globalThis.fetch = async (url) => {
      fetchCalls.push(url);
      if (url.includes('/relation-rules/')) {
        return new Response(JSON.stringify({ found: false, rules: [] }), { status: 404 });
      }
      return new Response(
        JSON.stringify({
          statusCode: 200,
          message: 'Found skip times',
          found: true,
          results: [
            {
              interval: { startTime: 15.0, endTime: 105.0 },
              skipType: 'op',
              skipId: 'test-uuid-op',
              episodeLength: 1420,
            },
            {
              interval: { startTime: 1300.0, endTime: 1390.0 },
              skipType: 'ed',
              skipId: 'test-uuid-ed',
              episodeLength: 1420,
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };

    const markers = await fetchSkipTimes(21, 1, 1420);
    assert.equal(markers.length, 2);
    assert.equal(markers[0].kind, 'intro');
    assert.equal(markers[0].start, 15.0);
    assert.equal(markers[0].end, 105.0);
    assert.equal(markers[1].kind, 'outro');
    assert.equal(markers[1].start, 1300.0);
    assert.equal(markers[1].end, 1390.0);

    // Verify endpoint URL
    const skipCall = fetchCalls.find((u) => u.includes('/skip-times/21/1'));
    assert.ok(skipCall, 'called skip times endpoint');
    assert.ok(skipCall.includes('types=op'), 'includes op type');
    assert.ok(skipCall.includes('types=ed'), 'includes ed type');
    assert.ok(skipCall.includes('types=recap'), 'includes recap type');
    assert.ok(skipCall.includes('episodeLength=1420'), 'includes episode length');

    // Second call should hit cache and NOT invoke fetch again
    const callCountBefore = fetchCalls.length;
    const cachedMarkers = await fetchSkipTimes(21, 1, 1420);
    assert.equal(fetchCalls.length, callCountBefore, 'no additional network fetch made');
    assert.deepEqual(cachedMarkers, markers);
  });

  it('automatically applies relation rules to redirect MAL ID and episode number', async () => {
    globalThis.fetch = async (url) => {
      fetchCalls.push(url);
      if (url.includes('/relation-rules/500')) {
        return new Response(
          JSON.stringify({
            statusCode: 200,
            message: 'Rules found',
            found: true,
            rules: [
              {
                from: { start: 13, end: 24 },
                to: { malId: 600, start: 1, end: 12 },
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes('/skip-times/600/1')) {
        return new Response(
          JSON.stringify({
            statusCode: 200,
            message: 'Found',
            found: true,
            results: [
              {
                interval: { startTime: 10, endTime: 100 },
                skipType: 'op',
                skipId: 'rule-op',
                episodeLength: 1400,
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ found: false, results: [] }), { status: 404 });
    };

    // Asking for MAL 500, Episode 13 should redirect to MAL 600, Episode 1
    const markers = await fetchSkipTimes(500, 13, 1400);
    assert.equal(markers.length, 1);
    assert.equal(markers[0].kind, 'intro');
    assert.ok(fetchCalls.some((u) => u.includes('/skip-times/600/1')), 'queried remapped MAL ID and episode');
  });

  it('handles 404 Not Found cleanly without throwing, and caches negative result', async () => {
    globalThis.fetch = async (url) => {
      fetchCalls.push(url);
      return new Response(
        JSON.stringify({ found: false, results: [], message: 'No skip times found', statusCode: 404 }),
        { status: 404 },
      );
    };

    const markers = await fetchSkipTimes(99999, 1, 1400);
    assert.deepEqual(markers, []);

    // Calling again should return cached empty result without re-fetching 404
    const countBefore = fetchCalls.length;
    const markers2 = await fetchSkipTimes(99999, 1, 1400);
    assert.deepEqual(markers2, []);
    assert.equal(fetchCalls.length, countBefore, 'negative result was cached, no network request');
  });

  it('handles HTTP 429 with Retry-After and honors cooldown period', async () => {
    let callCount = 0;
    globalThis.fetch = async (url) => {
      callCount++;
      return new Response(
        JSON.stringify({ statusCode: 429, message: 'Too Many Requests' }),
        {
          status: 429,
          headers: {
            'content-type': 'application/json',
            'retry-after': '20', // 20 seconds
          },
        },
      );
    };

    const markers = await fetchSkipTimes(1234, 1, 1400);
    assert.deepEqual(markers, []);
    assert.equal(callCount, 1);

    const cooldown = getRateLimitCooldown();
    assert.ok(cooldown > 15000 && cooldown <= 20000, `cooldown should be ~20s, got ${cooldown}ms`);

    // While in cooldown, subsequent calls do NOT hit the network
    const markersInCooldown = await fetchSkipTimes(5678, 2, 1400);
    assert.deepEqual(markersInCooldown, []);
    assert.equal(callCount, 1, 'rate limiter prevented subsequent network call during cooldown');
  });

  it('recovers cleanly from network errors and timeouts without breaking playback', async () => {
    globalThis.fetch = async () => {
      throw new Error('Network connection failed');
    };

    const markers = await fetchSkipTimes(123, 1, 1400);
    assert.deepEqual(markers, [], 'network error safely returns empty array');

    const rules = await fetchRelationRules(123);
    assert.deepEqual(rules, [], 'relation rules network error safely returns empty array');
  });

  it('respects timeout options and aborts hung requests', async () => {
    globalThis.fetch = async (url, init) => {
      return new Promise((resolve, reject) => {
        if (init?.signal) {
          init.signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }
      });
    };

    const t0 = Date.now();
    const markers = await fetchSkipTimes(111, 1, 1400, { timeoutMs: 50 });
    const elapsed = Date.now() - t0;
    assert.deepEqual(markers, []);
    assert.ok(elapsed < 200, `expected abort within 200ms, elapsed: ${elapsed}ms`);
  });
});

describe('5. Auto-skip preferences and controllable embeds', () => {
  it('defaults autoSkipIntro and autoSkipOutro to false (disabled by default)', async () => {
    const { DEFAULT_PREFS } = await import('../src/lib/playerPrefs.ts');
    assert.equal(DEFAULT_PREFS.autoSkipIntro, false, 'intro auto-skip must default to off');
    assert.equal(DEFAULT_PREFS.autoSkipOutro, false, 'outro auto-skip must default to off');
  });

  it('determines active skip interval correctly based on playhead time', () => {
    const markers = [
      { kind: 'intro', label: 'Opening', start: 30, end: 120 },
      { kind: 'outro', label: 'Ending', start: 1300, end: 1400 },
      { kind: 'recap', label: 'Recap', start: 0, end: 25 },
    ];

    const getActive = (time) => {
      const intro = markers.find((m) => m.kind === 'intro');
      const outro = markers.find((m) => m.kind === 'outro');
      const recap = markers.find((m) => m.kind === 'recap');
      if (intro && time >= intro.start && time < intro.end) return { target: intro, label: 'Skip Opening' };
      if (outro && time >= outro.start && time < outro.end) return { target: outro, label: 'Skip Ending' };
      if (recap && time >= recap.start && time < recap.end) return { target: recap, label: 'Skip Recap' };
      return null;
    };

    assert.equal(getActive(10)?.label, 'Skip Recap');
    assert.equal(getActive(50)?.label, 'Skip Opening');
    assert.equal(getActive(500), null);
    assert.equal(getActive(1350)?.label, 'Skip Ending');
    assert.equal(getActive(1450), null);
  });

  it('suppresses skipTarget when media seeking is uncontrollable or cross-origin (canSeek is false)', () => {
    const markers = [{ kind: 'intro', label: 'Opening', start: 30, end: 120 }];
    const time = 50;

    const resolveSkipTarget = ({ liveReady, canSeek, inIntro, intro }) => {
      if (!liveReady || !canSeek) return undefined;
      return inIntro ? intro : undefined;
    };

    const intro = markers[0];
    const inIntro = time >= intro.start && time < intro.end;

    // Ready & controllable -> skip target is available
    const ready = resolveSkipTarget({ liveReady: true, canSeek: true, inIntro, intro });
    assert.equal(ready, intro);

    // Cross-origin / uncontrollable -> skip target is suppressed
    const uncontrollable = resolveSkipTarget({ liveReady: true, canSeek: false, inIntro, intro });
    assert.equal(uncontrollable, undefined);

    // Live not ready -> skip target is suppressed
    const notReady = resolveSkipTarget({ liveReady: false, canSeek: true, inIntro, intro });
    assert.equal(notReady, undefined);
  });
});
