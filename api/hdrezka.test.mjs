// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decodeRezkaStream, resolve as hdrezkaResolve } from './adapters/hdrezka.mjs';
import { getAdapter } from './adapters/registry.mjs';
import { isHostAllowed } from '../functions/api/proxy.js';
import { assertAllowed, PROVIDERS } from '../lib/providers.mjs';
import { onRequestGet as onPlayGet } from '../functions/api/play.js';

describe('HDRezka Subsystem & Adapter Tests', () => {
  it('registers hdrezka adapter with correct metadata', () => {
    const adapter = getAdapter('hdrezka');
    assert.ok(adapter, 'Adapter hdrezka should be registered');
    assert.equal(adapter.id, 'hdrezka');
    assert.equal(adapter.defaultType, 'mp4');
    assert.ok(adapter.supportedAudio.includes('russian'));
  });

  it('decodes obfuscated stream payload with trash characters', () => {
    // Generate valid raw payload with trash characters
    const sampleOutput = '[1080p Ultra]https://stream.voidboost.cc/video.mp4:hls:https://stream.voidboost.cc/manifest.m3u8,[720p]https://stream.voidboost.cc/720.mp4';
    const b64 = Buffer.from(sampleOutput).toString('base64');

    // Inject trash tokens (e.g. @@ and !#) and #h prefix with //_//
    const trash1 = Buffer.from('@@').toString('base64');
    const trash2 = Buffer.from('!#').toString('base64');
    const obfuscated = `#h//_//${b64.slice(0, 10)}${trash1}${b64.slice(10, 20)}//_//${trash2}${b64.slice(20)}`;

    const decoded = decodeRezkaStream(obfuscated);
    assert.equal(decoded.length, 2);
    assert.equal(decoded[0].quality, '1080p Ultra');
    assert.equal(decoded[0].mp4, 'https://stream.voidboost.cc/video.mp4');
    assert.equal(decoded[0].hls, 'https://stream.voidboost.cc/manifest.m3u8');
    assert.equal(decoded[1].quality, '720p');
    assert.equal(decoded[1].mp4, 'https://stream.voidboost.cc/720.mp4');
  });

  it('parses plaintext voidboost stream payload with or delimiter', () => {
    const plaintext = '[360p]https://stream.voidboost.one/test/360.mp4:hls:manifest.m3u8 or https://stream.voidboost.one/test/360.mp4, [1080p Ultra]https://stream.voidboost.one/test/1080.mp4:hls:manifest.m3u8 or https://stream.voidboost.one/test/1080.mp4';
    const decoded = decodeRezkaStream(plaintext);
    assert.equal(decoded.length, 2);
    assert.equal(decoded[0].quality, '360p');
    assert.equal(decoded[0].mp4, 'https://stream.voidboost.one/test/360.mp4');
    assert.equal(decoded[1].quality, '1080p Ultra');
    assert.equal(decoded[1].mp4, 'https://stream.voidboost.one/test/1080.mp4');
  });

  it('resolves stream object with correct type and referer', async () => {
    const sampleOutput = '[1080p Ultra]https://stream.voidboost.cc/video.mp4';
    const b64 = Buffer.from(sampleOutput).toString('base64');
    const res = await hdrezkaResolve({ rawUrl: `#h${b64}`, subtitle: '[Русский]https://static.voidboost.net/sub.vtt' });

    assert.ok(res);
    assert.equal(res.provider, 'hdrezka');
    assert.equal(res.type, 'mp4');
    assert.equal(res.kind, 'mp4');
    assert.equal(res.referer, 'https://rezka.ag/');
    assert.equal(res.subtitles.length, 1);
    assert.equal(res.subtitles[0].language, 'Русский');
  });

  it('authorizes rezka and voidboost in edge proxy', () => {
    assert.equal(isHostAllowed('rezka.ag', 'https://rezka.ag/stream'), true);
    assert.equal(isHostAllowed('stream.voidboost.cc', 'https://stream.voidboost.cc/video.mp4'), true);
    assert.equal(isHostAllowed('static.voidboost.net', 'https://static.voidboost.net/sub.vtt'), true);
  });

  it('authorizes rezka and voidboost in bridge provider registry', () => {
    assert.ok(PROVIDERS.hdrezka);
    assert.doesNotThrow(() => assertAllowed('https://stream.voidboost.cc/360.mp4', 'hdrezka'));
    assert.doesNotThrow(() => assertAllowed('https://rezka.ag/ajax/get_cdn_series/', 'hdrezka'));
  });

  it('includes hdrezka server and provider in play endpoint response with Proxy Required status when unbridged', async () => {
    const req = new Request('http://127.0.0.1:8795/api/play?id=solo-leveling&ep=1');
    const res = await onPlayGet({ request: req, env: {} });
    assert.equal(res.status, 200);
    const json = await res.json();
    const rezkaServer = json.servers.find((s) => s.id === 'hdrezka:ultra');
    assert.ok(rezkaServer, 'Should include hdrezka:ultra server');
    assert.equal(rezkaServer.status, 'unavailable');
    assert.equal(rezkaServer.unavailableReason, 'Proxy Required');

    const rezkaProv = json.availableProviders.find((p) => p.id === 'hdrezka');
    assert.ok(rezkaProv, 'Should include hdrezka in availableProviders');
    assert.equal(rezkaProv.available, false);
    assert.equal(rezkaProv.unavailableReason, 'Proxy Required');
  });

  it('marks scopedProviderUnavailable when hdrezka requested without reachable bridge', async () => {
    const req = new Request('http://127.0.0.1:8795/api/play?id=solo-leveling&ep=1&provider=hdrezka');
    const res = await onPlayGet({ request: req, env: {} });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.scopedProviderUnavailable, true);
  });

  it('marks hdrezka server ready when STREAM_BRIDGE_URL is configured', async () => {
    const req = new Request('http://127.0.0.1:8795/api/play?id=demon-slayer-bridged&ep=1');
    const res = await onPlayGet({ request: req, env: { STREAM_BRIDGE_URL: 'http://127.0.0.1:8795' } });
    assert.equal(res.status, 200);
    const json = await res.json();
    const rezkaServer = json.servers.find((s) => s.id === 'hdrezka:ultra');
    assert.ok(rezkaServer);
    assert.equal(rezkaServer.status, 'ready');
    assert.equal(rezkaServer.unavailableReason, null);
  });
});
