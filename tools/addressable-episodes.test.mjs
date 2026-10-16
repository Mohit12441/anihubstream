import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

export function resolveTargetEpisode(epParam, queryParam, totalEpisodes, savedResumeEp) {
  if (totalEpisodes <= 0) return 1;

  if (epParam !== undefined && epParam !== null) {
    const parsed = Number.parseInt(String(epParam), 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return { ep: 1, needsRedirect: true };
    }
    if (parsed > totalEpisodes) {
      return { ep: totalEpisodes, needsRedirect: true };
    }
    return { ep: parsed, needsRedirect: false };
  }

  // Fallback for /watch/:id without :ep
  if (queryParam !== undefined && queryParam !== null) {
    const parsedQuery = Number.parseInt(String(queryParam), 10);
    if (Number.isFinite(parsedQuery) && parsedQuery >= 1) {
      return { ep: Math.min(parsedQuery, totalEpisodes), needsRedirect: true };
    }
  }

  if (savedResumeEp && savedResumeEp >= 1 && savedResumeEp <= totalEpisodes) {
    return { ep: savedResumeEp, needsRedirect: true };
  }

  return { ep: 1, needsRedirect: true };
}

describe('Task 4: Addressable Episodes Resolution', () => {
  it('loads valid episode directly without redirect', () => {
    const res = resolveTargetEpisode('5', null, 24, null);
    assert.equal(res.ep, 5);
    assert.equal(res.needsRedirect, false);
  });

  it('clamps over-range episode (e.g. 999) to max episode and marks redirect', () => {
    const res = resolveTargetEpisode('999', null, 28, null);
    assert.equal(res.ep, 28);
    assert.equal(res.needsRedirect, true);
  });

  it('clamps non-numeric episode (e.g. abc) to episode 1 and marks redirect', () => {
    const res = resolveTargetEpisode('abc', null, 28, null);
    assert.equal(res.ep, 1);
    assert.equal(res.needsRedirect, true);
  });

  it('clamps 0 or negative episode to episode 1 and marks redirect', () => {
    const res1 = resolveTargetEpisode('0', null, 28, null);
    assert.equal(res1.ep, 1);
    assert.equal(res1.needsRedirect, true);

    const res2 = resolveTargetEpisode('-10', null, 28, null);
    assert.equal(res2.ep, 1);
    assert.equal(res2.needsRedirect, true);
  });

  it('redirects /watch/:id without :ep to saved resume episode or 1', () => {
    const resWithResume = resolveTargetEpisode(undefined, null, 24, 7);
    assert.equal(resWithResume.ep, 7);
    assert.equal(resWithResume.needsRedirect, true);

    const resNoResume = resolveTargetEpisode(undefined, null, 24, null);
    assert.equal(resNoResume.ep, 1);
    assert.equal(resNoResume.needsRedirect, true);
  });
});
