// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toPlayerInput } from '../src/components/player/PlayerInput.ts';

describe('Layer 2: PlayerInput Adapter Tests', () => {
  it('maps standard HLS server and AniSkip payload cleanly', () => {
    /** @type {import('../src/components/player/PlayerInput.ts').PlayServer} */
    const server = {
      id: 'anikoto:HD-1',
      name: 'AniKoto · HD-1',
      provider: 'anikoto',
      status: 'ready',
      streamUrl: 'http://127.0.0.1:8795/stream/sid-1/master.m3u8',
      type: 'hls',
      quality: '1080p',
      audio: 'sub',
      subtitles: [
        { id: 'sub-0', language: 'en', label: 'English', url: '/stream/sid-1/sub/0.vtt', default: true },
      ],
      fallbackUrls: ['http://127.0.0.1:8795/stream/sid-fallback/master.m3u8'],
    };

    /** @type {import('../src/components/player/PlayerInput.ts').AniSkipData} */
    const aniskip = {
      op: { start: 90.0, end: 180.0, label: 'Opening' },
      ed: { start: 1320.0, end: 1410.0, label: 'Ending' },
      recap: null,
    };

    const input = toPlayerInput(server, aniskip, 45.5, 'Attack on Titan', 1);

    assert.strictEqual(input.src, 'http://127.0.0.1:8795/stream/sid-1/master.m3u8');
    assert.strictEqual(input.type, 'hls');
    assert.strictEqual(input.title, 'Attack on Titan');
    assert.strictEqual(input.episodeNumber, 1);
    assert.strictEqual(input.startTime, 45.5);
    assert.strictEqual(input.quality, '1080p');
    assert.strictEqual(input.provider, 'anikoto');
    assert.strictEqual(input.serverId, 'anikoto:HD-1');
    assert.strictEqual(input.subtitles.length, 1);
    assert.strictEqual(input.fallbackUrls.length, 1);
    assert.strictEqual(input.fallbackUrls[0], 'http://127.0.0.1:8795/stream/sid-fallback/master.m3u8');
    assert.deepStrictEqual(input.aniskip, aniskip);
  });

  it('clamps negative start times to 0 and provides sensible defaults for missing audioTracks', () => {
    /** @type {import('../src/components/player/PlayerInput.ts').PlayServer} */
    const server = {
      id: 'waw-hindi',
      name: 'WatchAnimeWorld',
      provider: 'watchanimeworld',
      status: 'ready',
      streamUrl: 'http://127.0.0.1:8795/stream/sid-waw/media.mkv',
      type: 'mp4',
      audio: 'hindi',
    };

    const input = toPlayerInput(server, null, -10);

    assert.strictEqual(input.startTime, 0);
    assert.strictEqual(input.type, 'mp4');
    assert.strictEqual(input.audio, 'hindi');
    assert.strictEqual(input.audioTracks.length, 1);
    assert.strictEqual(input.audioTracks[0].language, 'hi');
    assert.strictEqual(input.subtitles.length, 0);
    assert.strictEqual(input.aniskip, undefined);
  });
});
