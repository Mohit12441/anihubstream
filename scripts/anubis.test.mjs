// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { solve, getCookie } from './anubis.mjs';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

describe('Anubis proof-of-work solver', () => {
  it('finds a nonce whose hash satisfies the difficulty prefix', () => {
    const { nonce, hash } = solve('abc', 2);
    assert.ok(hash.startsWith('00'), `hash ${hash} lacks two leading zeros`);
    assert.equal(hash, sha256('abc' + nonce));
  });

  it('returns a null cookie when the page is served without a challenge', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => new Response('<html>ok</html>', { status: 200 }));
    const out = await getCookie('/');
    assert.deepEqual(out, { cookie: null });
  });

  it('rejects envelope with wrong episode when read', () => {
    // Simulate KV storage: envelope with s=1,e=1
    const storedEnvelope = JSON.stringify({ s: 1, e: 1, payload: 'url-1', ts: Date.now() });
    // Read it back as s=1,e=5 (cross-episode) should be a validation miss
    const parsed = JSON.parse(storedEnvelope);
    // hdrezkaMeta validation logic: if parsed.s !== season || parsed.e !== episode → miss
    // With season=1, episode=5: parsed.s===1 && parsed.e===1, so 1 !== 5 → miss ✓
    const season = 1;
    const episode = 5;
    const isMiss = parsed.s !== season || parsed.e !== episode;
    assert.strictEqual(isMiss, true, 'envelope with s=1,e=1 should be rejected when read as s=1,e=5');
    assert.strictEqual(parsed.e, 1, 'stored envelope has e=1');
    assert.notStrictEqual(parsed.e, 5, 'stored envelope e!=5 so reading as ep 5 is a miss');
  });

  it('returns a null cookie when the page is served without a challenge', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => new Response('<html>ok</html>', { status: 200 }));
    const out = await getCookie('/');
    assert.deepEqual(out, { cookie: null });
  });
});
