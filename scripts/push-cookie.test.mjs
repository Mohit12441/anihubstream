// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCookie, needEnv } from './push-cookie.mjs';
import { rezkaFetch, parseStreams, decodeRezkaStream } from '../functions/_lib/hdrezka.js';

describe('Manual Cookie Push & KV Passthrough Tests', () => {
  it('normalizes pasted cookie string cleanly', () => {
    const raw = 'cookie: anubis-auth=token123; path=/; domain=.hdrezka.ag; HttpOnly; SameSite=Lax';
    const normalized = normalizeCookie(raw);
    assert.equal(normalized, 'anubis-auth=token123');
  });

  it('needEnv throws error if required Cloudflare KV credentials are missing', () => {
    const originalEnv = { ...process.env };
    delete process.env.CF_API_TOKEN;
    delete process.env.CF_ACCOUNT_ID;
    delete process.env.CF_KV_NAMESPACE;

    assert.throws(() => needEnv(), /missing environment variable/);

    process.env = originalEnv;
  });

  it('rezkaFetch reports no-cookie when no KV or env cookie is present', async () => {
    const result = await rezkaFetch({}, '/test');
    assert.equal(result.res, null);
    assert.equal(result.reason, 'no-cookie');
  });

  it('rezkaFetch reports stale when cookie timestamp exceeds max age', async () => {
    const mockKv = {
      get: async (k) => {
        if (k === 'anubis:cookie') return 'anubis-auth=xyz';
        if (k === 'anubis:ts') return String(Date.now() - 10 * 3600 * 1000); // 10h old
        return null;
      },
    };
    const result = await rezkaFetch({ STREAM_KV: mockKv }, '/test');
    assert.equal(result.res, null);
    assert.equal(result.reason, 'stale');
  });

  it('parseStreams decodes raw obfuscated rezka payload correctly', () => {
    const sampleOutput = '[1080p Ultra]https://stream.voidboost.cc/video.mp4:hls:manifest.m3u8,[720p]https://stream.voidboost.cc/720.mp4';
    const b64 = Buffer.from(sampleOutput).toString('base64');
    const obfuscated = `#h//_//${b64}`;

    const parsed = parseStreams({ url: obfuscated });
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].quality, '1080p Ultra');
    assert.equal(parsed[0].url, 'https://stream.voidboost.cc/video.mp4');
    assert.equal(parsed[0].container, 'mp4');
    assert.equal(parsed[1].quality, '720p');
  });
});
