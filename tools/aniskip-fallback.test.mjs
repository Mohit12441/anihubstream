import { test } from 'node:test';
import assert from 'node:assert/strict';

// Isolated mock of resolveSkipTimes logic
function simulateSkipResolution({
  db,
  malId,
  ep,
  duration,
  rawEpisodeMarkers,
  animeId = '',
  metaSkip = null,
}) {
  let aniskipData = null;

  // 1. Check local D1 episode markers (0ms)
  if (rawEpisodeMarkers) {
    try {
      const markers = typeof rawEpisodeMarkers === 'string' ? JSON.parse(rawEpisodeMarkers) : rawEpisodeMarkers;
      if (Array.isArray(markers) && markers.length > 0) {
        let op = null;
        let ed = null;
        let recap = null;
        for (const m of markers) {
          const formatted = {
            start: m.start,
            end: m.end,
            label: m.label || (m.kind === 'outro' ? 'Ending' : m.kind === 'recap' ? 'Recap' : 'Opening'),
            source: 'aniskip',
            confidence: 1.0,
          };
          if (m.kind === 'intro') op ??= formatted;
          else if (m.kind === 'outro') ed ??= formatted;
          else if (m.kind === 'recap') recap ??= formatted;
        }
        if (op || ed || recap) {
          aniskipData = { op, ed, recap };
        }
      }
    } catch {}
  }

  // 2. Check stream_cache
  if (!aniskipData && malId && malId > 0 && db?.cached) {
    const cached = db.cached[`aniskip:${malId}:${ep}`];
    if (cached && !cached.empty) {
      aniskipData = {
        op: cached.op ? { ...cached.op, source: 'aniskip', confidence: 1.0 } : null,
        ed: cached.ed ? { ...cached.ed, source: 'aniskip', confidence: 1.0 } : null,
        recap: cached.recap ? { ...cached.recap, source: 'aniskip', confidence: 1.0 } : null,
      };
    }
  }

  // 3. Sibling Episode Learned Template (Cour pattern heuristic)
  if (!aniskipData && db?.siblings && animeId && ep > 1) {
    const siblings = db.siblings[animeId] || [];
    for (const sib of siblings) {
      const sibIntro = sib.find((m) => m.kind === 'intro');
      const sibOutro = sib.find((m) => m.kind === 'outro');

      if (sibIntro && (sibIntro.end - sibIntro.start) >= 75 && (sibIntro.end - sibIntro.start) <= 105) {
        aniskipData = {
          op: {
            start: sibIntro.start,
            end: sibIntro.end,
            label: 'Opening',
            source: 'learned_template',
            confidence: 0.85,
          },
          ed: sibOutro && duration > 600 ? {
            start: Math.min(sibOutro.start, duration - 100),
            end: Math.min(sibOutro.end, duration - 10),
            label: 'Ending',
            source: 'learned_template',
            confidence: 0.85,
          } : null,
          recap: null,
        };
        break;
      }
    }
  }

  // 4. Structural TV Anime Estimator
  if (!aniskipData && duration >= 1000 && duration <= 1800 && ep > 1) {
    aniskipData = {
      op: {
        start: 90,
        end: 180,
        label: 'Opening',
        source: 'estimated',
        confidence: 0.65,
      },
      ed: {
        start: Math.max(duration - 120, 0),
        end: Math.max(duration - 30, 0),
        label: 'Ending',
        source: 'estimated',
        confidence: 0.65,
      },
      recap: null,
    };
  }

  // Merge with provider metadata
  let finalOp = aniskipData?.op || null;
  let finalEd = aniskipData?.ed || null;
  let finalRecap = aniskipData?.recap || null;

  if ((!finalOp || (finalOp.confidence && finalOp.confidence < 0.8)) && metaSkip?.intro) {
    const s = metaSkip.intro;
    const start = Array.isArray(s) ? s[0] : s.start;
    const end = Array.isArray(s) ? s[1] : s.end;
    if (start !== undefined && end !== undefined && (start > 0 || end > 0)) {
      finalOp = { start, end, label: 'Opening', source: 'provider', confidence: 0.9 };
    }
  }

  if ((!finalEd || (finalEd.confidence && finalEd.confidence < 0.8)) && metaSkip?.outro) {
    const s = metaSkip.outro;
    const start = Array.isArray(s) ? s[0] : s.start;
    const end = Array.isArray(s) ? s[1] : s.end;
    if (start !== undefined && end !== undefined && (start > 0 || end > 0)) {
      finalEd = { start, end, label: 'Ending', source: 'provider', confidence: 0.9 };
    }
  }

  return { op: finalOp, ed: finalEd, recap: finalRecap };
}

test('returns canonical episode markers with confidence 1.0', () => {
  const result = simulateSkipResolution({
    rawEpisodeMarkers: [{ kind: 'intro', start: 60, end: 150 }],
    malId: 52299,
    ep: 1,
    duration: 1440,
  });

  assert.equal(result.op.start, 60);
  assert.equal(result.op.end, 150);
  assert.equal(result.op.source, 'aniskip');
  assert.equal(result.op.confidence, 1.0);
});

test('learns opening template from sibling episode of same anime', () => {
  const result = simulateSkipResolution({
    rawEpisodeMarkers: null,
    malId: 99999,
    ep: 4,
    duration: 1440,
    animeId: 'solo-leveling',
    db: {
      siblings: {
        'solo-leveling': [
          [{ kind: 'intro', start: 85, end: 175 }], // 90s opening template from Ep 2
        ],
      },
    },
  });

  assert.ok(result.op, 'learned template creates OP interval');
  assert.equal(result.op.start, 85);
  assert.equal(result.op.end, 175);
  assert.equal(result.op.source, 'learned_template');
  assert.equal(result.op.confidence, 0.85);
});

test('structural estimator applies to standard TV anime when no data exists (ep > 1)', () => {
  const result = simulateSkipResolution({
    rawEpisodeMarkers: null,
    malId: null,
    ep: 3,
    duration: 1420,
    animeId: 'obscure-tv-series',
    db: null,
  });

  assert.ok(result.op, 'generates structural OP estimate');
  assert.equal(result.op.start, 90);
  assert.equal(result.op.end, 180);
  assert.equal(result.op.source, 'estimated');
  assert.equal(result.op.confidence, 0.65);
  assert.equal(result.ed.start, 1300); // 1420 - 120
});

test('structural estimator does NOT guess on episode 1', () => {
  const result = simulateSkipResolution({
    rawEpisodeMarkers: null,
    malId: null,
    ep: 1, // Episode 1 usually has no OP or plays over credits
    duration: 1440,
    animeId: 'obscure-tv-series',
    db: null,
  });

  assert.equal(result.op, null, 'Episode 1 should not receive speculative OP');
  assert.equal(result.ed, null);
});

test('provider skip metadata overrides low-confidence structural estimate', () => {
  const result = simulateSkipResolution({
    rawEpisodeMarkers: null,
    malId: null,
    ep: 2,
    duration: 1440,
    animeId: 'some-anime',
    db: null,
    metaSkip: {
      intro: [72, 162], // AniKoto/HiAnime verified intro
    },
  });

  assert.equal(result.op.start, 72);
  assert.equal(result.op.end, 162);
  assert.equal(result.op.source, 'provider');
  assert.equal(result.op.confidence, 0.9);
});
