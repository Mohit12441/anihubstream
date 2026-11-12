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

  it('parses WebVTT cue times and bodies accurately with parseVtt', async () => {
    const { parseVtt } = await import('../src/lib/streamBridge.ts');
    const vttSample = `WEBVTT

00:00:02.500 --> 00:00:05.100
<i>Wealth, fame, power...</i>

00:01:10.000 --> 00:01:15.000 line:80% align:center
The King of the Pirates!`;

    const cues = parseVtt(vttSample);
    assert.strictEqual(cues.length, 2);
    assert.strictEqual(cues[0].start, 2.5);
    assert.strictEqual(cues[0].end, 5.1);
    assert.strictEqual(cues[0].text, 'Wealth, fame, power...');
    assert.strictEqual(cues[1].start, 70);
    assert.strictEqual(cues[1].end, 75);
    assert.strictEqual(cues[1].text, 'The King of the Pirates!');
  });

  it('parses WebVTT containing STYLE and NOTE blocks without dropping cues', async () => {
    const { parseVtt } = await import('../src/lib/streamBridge.ts');
    const styledVtt = `WEBVTT

NOTE This is a commentary block before styles

STYLE
::cue {
  color: #fff;
}

00:00:01.000 --> 00:00:04.000
First styled cue line.

NOTE Another middle comment

00:00:05.000 --> 00:00:08.000
Second styled cue line.`;

    const cues = parseVtt(styledVtt);
    assert.strictEqual(cues.length, 2);
    assert.strictEqual(cues[0].start, 1);
    assert.strictEqual(cues[0].text, 'First styled cue line.');
    assert.strictEqual(cues[1].start, 5);
    assert.strictEqual(cues[1].text, 'Second styled cue line.');
  });

  it('subLangCode correctly resolves full labels, aliases, and 3-letter codes', async () => {
    const { subLangCode } = await import('../src/lib/playerPrefs.ts');
    assert.strictEqual(subLangCode('English'), 'en');
    assert.strictEqual(subLangCode('eng'), 'en');
    assert.strictEqual(subLangCode('Spanish'), 'es');
    assert.strictEqual(subLangCode('spa'), 'es');
    assert.strictEqual(subLangCode('Bahasa Indonesia'), 'id');
    assert.strictEqual(subLangCode('bah'), 'id');
    assert.strictEqual(subLangCode('Japanese'), 'ja');
  });
});
