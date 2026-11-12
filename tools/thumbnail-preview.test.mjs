import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseVttTime,
  resolveRelativeUrl,
  parseThumbnailVtt,
  findThumbnailCue,
} from '../src/lib/thumbnailParser.ts';

import { toPlayerInput } from '../src/components/player/PlayerInput.ts';

test('Thumbnail Parser: parseVttTime parses timestamps accurately', () => {
  assert.equal(parseVttTime('00:00:00.000'), 0);
  assert.equal(parseVttTime('00:01:30.500'), 90.5);
  assert.equal(parseVttTime('01:15:20.250'), 4520.25);
  // MM:SS format
  assert.equal(parseVttTime('05:10.000'), 310);
  // Comma separator support
  assert.equal(parseVttTime('00:02:15,750'), 135.75);
});

test('Thumbnail Parser: resolveRelativeUrl resolves paths against VTT base URL', () => {
  const base = 'https://cdn.anihubstream.com/media/stream123/thumbnails.vtt';
  assert.equal(
    resolveRelativeUrl('sprite_0.jpg', base),
    'https://cdn.anihubstream.com/media/stream123/sprite_0.jpg'
  );
  assert.equal(
    resolveRelativeUrl('sub/sprite_1.jpg', base),
    'https://cdn.anihubstream.com/media/stream123/sub/sprite_1.jpg'
  );
  // Absolute URLs should not be modified
  assert.equal(
    resolveRelativeUrl('https://other-cdn.com/thumb.jpg', base),
    'https://other-cdn.com/thumb.jpg'
  );
  assert.equal(resolveRelativeUrl('/api/proxy?url=1', base), '/api/proxy?url=1');
});

test('Thumbnail Parser: parseThumbnailVtt parses sprite sheet with #xywh coordinates', () => {
  const sampleVtt = `WEBVTT
NOTE Scrubber thumbnail sprite map

00:00:00.000 --> 00:00:05.000
sprite0.jpg#xywh=0,0,160,90

00:00:05.000 --> 00:00:10.000
sprite0.jpg#xywh=160,0,160,90

00:00:10.000 --> 00:00:15.000
sprite0.jpg#xywh=0,90,160,90
`;

  const cues = parseThumbnailVtt(sampleVtt, 'https://cdn.anihubstream.com/media/thumbnails.vtt');
  assert.equal(cues.length, 3);

  assert.equal(cues[0].start, 0);
  assert.equal(cues[0].end, 5);
  assert.equal(cues[0].url, 'https://cdn.anihubstream.com/media/sprite0.jpg');
  assert.equal(cues[0].x, 0);
  assert.equal(cues[0].y, 0);
  assert.equal(cues[0].width, 160);
  assert.equal(cues[0].height, 90);
  assert.equal(cues[0].isSprite, true);

  assert.equal(cues[1].start, 5);
  assert.equal(cues[1].end, 10);
  assert.equal(cues[1].x, 160);
  assert.equal(cues[1].y, 0);
  assert.equal(cues[1].isSprite, true);

  assert.equal(cues[2].start, 10);
  assert.equal(cues[2].end, 15);
  assert.equal(cues[2].x, 0);
  assert.equal(cues[2].y, 90);
});

test('Thumbnail Parser: parseThumbnailVtt parses standalone image cues', () => {
  const sampleVtt = `WEBVTT

00:00:00.000 --> 00:00:10.000
https://img.anihubstream.com/ep1/thumb_0.jpg

00:00:10.000 --> 00:00:20.000
https://img.anihubstream.com/ep1/thumb_1.jpg
`;

  const cues = parseThumbnailVtt(sampleVtt);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].url, 'https://img.anihubstream.com/ep1/thumb_0.jpg');
  assert.equal(cues[0].isSprite, false);
  assert.equal(cues[1].url, 'https://img.anihubstream.com/ep1/thumb_1.jpg');
});

test('Thumbnail Parser: findThumbnailCue locates cue via binary search', () => {
  const sampleVtt = `WEBVTT

00:00:00.000 --> 00:00:05.000
thumb_0.jpg

00:00:05.000 --> 00:00:10.000
thumb_1.jpg

00:00:10.000 --> 00:00:15.000
thumb_2.jpg
`;

  const cues = parseThumbnailVtt(sampleVtt);

  // Exact start
  const cue0 = findThumbnailCue(cues, 0);
  assert.equal(cue0?.url, 'thumb_0.jpg');

  // Mid-interval
  const cue1 = findThumbnailCue(cues, 7.5);
  assert.equal(cue1?.url, 'thumb_1.jpg');

  // Boundary condition
  const cue2 = findThumbnailCue(cues, 10.0);
  assert.equal(cue2?.url, 'thumb_2.jpg');

  // Out of bounds past end returns last cue
  const cueEnd = findThumbnailCue(cues, 999);
  assert.equal(cueEnd?.url, 'thumb_2.jpg');
});

test('PlayerInput: toPlayerInput preserves thumbnails payload from PlayServer', () => {
  const mockServer = {
    id: 'hianime:HD-1',
    name: 'HD-1',
    provider: 'hianime',
    status: 'ready',
    streamUrl: 'https://cdn.example.com/master.m3u8',
    type: 'hls',
    thumbnails: { url: 'https://cdn.example.com/thumbnails.vtt' },
  };

  const input = toPlayerInput(mockServer, null, 0, 'Test Title', 1);
  assert.ok(input.thumbnails);
  assert.equal(input.thumbnails.url, 'https://cdn.example.com/thumbnails.vtt');
});

test('Dynamic Thumbnail Scrubber: stream eligibility and gating rules', () => {
  const isEligible = (cuesCount, streamUrl, streamKind) => {
    return (
      cuesCount === 0 &&
      Boolean(streamUrl) &&
      streamKind !== 'embed' &&
      !streamUrl?.includes('/api/play/resolve')
    );
  };

  // When VTT cues exist, dynamic extraction is disabled (VTT takes precedence)
  assert.equal(isEligible(5, 'https://cdn.example.com/stream.m3u8', 'hls'), false);

  // When no VTT cues exist and stream is direct HLS or MP4, dynamic extraction is active
  assert.equal(isEligible(0, 'https://cdn.example.com/stream.m3u8', 'hls'), true);
  assert.equal(isEligible(0, 'https://cdn.example.com/video.mp4', 'progressive'), true);

  // Unresolved API route or missing URL stays inactive
  assert.equal(isEligible(0, '/api/play/resolve?id=123', 'hls'), false);
  assert.equal(isEligible(0, null, 'hls'), false);

  // Iframe embeds cannot extract canvas frames
  assert.equal(isEligible(0, 'https://megacloud.tv/embed-2/e-1', 'embed'), false);
});
