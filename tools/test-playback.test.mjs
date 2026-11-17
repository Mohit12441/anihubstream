import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testHdrezkaPlayback } from './test-playback.mjs';

test('Playback Diagnostic: exports testHdrezkaPlayback function', () => {
  assert.equal(typeof testHdrezkaPlayback, 'function');
});

test('Playback Diagnostic: contract handles network failures cleanly', async () => {
  const result = await testHdrezkaPlayback({
    query: 'NonExistentTitle99999',
    timeoutMs: 1000,
  });

  assert.equal(typeof result.ok, 'boolean');
  assert.ok(result.diagnostics);
  assert.equal(result.diagnostics.provider, 'hdrezka');
  assert.ok(result.diagnostics.step);
});
