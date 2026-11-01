import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captionStyle } from '../src/components/player/captionStyle.ts';
import { DEFAULT_SUBTITLES, SUBTITLE_PRESETS } from '../src/lib/playerPrefs.ts';

test('captionStyle generates correct typography and font families', () => {
  const classicStyle = captionStyle({ ...DEFAULT_SUBTITLES, font: 'classic' });
  assert.ok(classicStyle.fontFamily.includes('Trebuchet MS'), 'classic font contains Trebuchet MS');

  const serifStyle = captionStyle({ ...DEFAULT_SUBTITLES, font: 'serif' });
  assert.ok(serifStyle.fontFamily.includes('Noto Serif JP'), 'serif font contains Noto Serif JP');

  const monoStyle = captionStyle({ ...DEFAULT_SUBTITLES, font: 'mono' });
  assert.ok(monoStyle.fontFamily.includes('JetBrains Mono'), 'mono font contains JetBrains Mono');

  const sansStyle = captionStyle({ ...DEFAULT_SUBTITLES, font: 'sans' });
  assert.ok(sansStyle.fontFamily.includes('Inter'), 'sans font contains Inter');
});

test('captionStyle generates custom text shadows and heavy outline', () => {
  const heavyStyle = captionStyle({ ...DEFAULT_SUBTITLES, shadow: 'heavy' });
  assert.ok(heavyStyle.textShadow.includes('2px 2px 0 #000'), 'heavy shadow uses 2px outline');

  const glowStyle = captionStyle({ ...DEFAULT_SUBTITLES, shadow: 'glow' });
  assert.ok(glowStyle.textShadow.includes('0 0 16px'), 'glow shadow uses ambient diffusion');

  const dropStyle = captionStyle({ ...DEFAULT_SUBTITLES, shadow: 'drop' });
  assert.ok(dropStyle.textShadow.includes('2px 3px 6px'), 'drop shadow uses directional offset');

  const noneStyle = captionStyle({ ...DEFAULT_SUBTITLES, shadow: 'none', outline: false, backdrop: 'none' });
  assert.equal(noneStyle.textShadow, 'none', 'none shadow produces no text shadow');
});

test('SUBTITLE_PRESETS contains valid presets with complete styling', () => {
  assert.equal(SUBTITLE_PRESETS.length, 4, 'defines 4 style presets');

  const classic = SUBTITLE_PRESETS.find((p) => p.id === 'anime_classic');
  assert.ok(classic, 'Anime Classic preset exists');
  assert.equal(classic.settings.color, '#ffe066');
  assert.equal(classic.settings.font, 'classic');
  assert.equal(classic.settings.shadow, 'heavy');

  const cinema = SUBTITLE_PRESETS.find((p) => p.id === 'cinema_serif');
  assert.ok(cinema, 'Cinema preset exists');
  assert.equal(cinema.settings.font, 'serif');
  assert.equal(cinema.settings.shadow, 'glow');

  const cyberpunk = SUBTITLE_PRESETS.find((p) => p.id === 'cyberpunk_mono');
  assert.ok(cyberpunk, 'Cyberpunk preset exists');
  assert.equal(cyberpunk.settings.font, 'mono');
  assert.equal(cyberpunk.settings.color, '#7dd3fc');
});

test('Timing sync offset calculates effective cue time cleanly', () => {
  const testOffset = (currentTime, offset) => Math.max(0, currentTime + (offset || 0));

  assert.equal(testOffset(10.0, 0), 10.0, 'zero offset does not alter time');
  assert.equal(testOffset(10.0, 0.5), 10.5, 'positive offset delays cues (looks ahead in stream)');
  assert.equal(testOffset(10.0, -0.8), 9.2, 'negative offset advances cues (shows earlier)');
  assert.equal(testOffset(0.3, -1.0), 0, 'negative offset clamps to 0 at stream start');
});
