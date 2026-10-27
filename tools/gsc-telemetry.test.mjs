import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getAccessToken, inspectUrl, queryAnalytics, listSitemaps } from './gsc-telemetry.mjs';

describe('GSC Telemetry Client Contract', () => {
  it('exports expected telemetry inspection methods', () => {
    assert.equal(typeof getAccessToken, 'function');
    assert.equal(typeof inspectUrl, 'function');
    assert.equal(typeof queryAnalytics, 'function');
    assert.equal(typeof listSitemaps, 'function');
  });
});
