import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  getUtcDayIndex,
  getNextAiringDate,
  computeAiringCountdown,
} from '../src/lib/airingCountdown.ts';

test('Airing Countdown: getUtcDayIndex maps Sunday to 7 and Monday to 1', () => {
  const sun = new Date(Date.UTC(2026, 10, 1, 12, 0)); // 2026-11-01 is a Sunday
  assert.equal(getUtcDayIndex(sun), 7);

  const mon = new Date(Date.UTC(2026, 10, 2, 12, 0)); // 2026-11-02 is a Monday
  assert.equal(getUtcDayIndex(mon), 1);

  const wed = new Date(Date.UTC(2026, 10, 4, 12, 0)); // 2026-11-04 is a Wednesday
  assert.equal(getUtcDayIndex(wed), 3);
});

test('Airing Countdown: getNextAiringDate calculates future day within same week', () => {
  // Tuesday Nov 3, 2026 at 10:00 UTC (day 2)
  const now = new Date(Date.UTC(2026, 10, 3, 10, 0, 0));
  // Target: Friday at 14:00 UTC (day 5)
  const schedule = { day: 5, time: '14:00' };

  const target = getNextAiringDate(schedule, now);
  assert.ok(target instanceof Date);
  assert.equal(target.getUTCDay(), 5); // Friday
  assert.equal(target.getUTCDate(), 6); // Nov 6
  assert.equal(target.getUTCHours(), 14);
  assert.equal(target.getUTCMinutes(), 0);
});

test('Airing Countdown: getNextAiringDate wraps around to next week if slot passed', () => {
  // Saturday Nov 7, 2026 at 16:00 UTC (day 6)
  const now = new Date(Date.UTC(2026, 10, 7, 16, 0, 0));
  // Target: Friday at 14:00 UTC (day 5 - already passed this week)
  const schedule = { day: 5, time: '14:00' };

  const target = getNextAiringDate(schedule, now);
  assert.ok(target instanceof Date);
  assert.equal(target.getUTCDay(), 5); // Friday next week
  assert.equal(target.getUTCDate(), 13); // Nov 13
  assert.equal(target.getUTCHours(), 14);
});

test('Airing Countdown: computeAiringCountdown returns precise breakdown and formatted labels', () => {
  // Now: Friday Nov 6, 2026 at 12:00:00 UTC
  const now = new Date(Date.UTC(2026, 10, 6, 12, 0, 0));
  // Target: Friday at 14:30:00 UTC (same day, 2 hours and 30 mins later)
  const schedule = { day: 5, time: '14:30', episode: 8 };

  const res = computeAiringCountdown(schedule, 12, 7, now);
  assert.ok(res);
  assert.equal(res.days, 0);
  assert.equal(res.hours, 2);
  assert.equal(res.minutes, 30);
  assert.equal(res.seconds, 0);
  assert.equal(res.nextEpisode, 8);
  assert.equal(res.isAiringToday, true);
  assert.equal(res.isAiringSoon, false); // > 1h
  assert.match(res.formatted, /2h 30m 0s/);
  assert.equal(res.shortLabel, '2h 30m');
});

test('Airing Countdown: flags isAiringSoon when under 60 minutes', () => {
  // Now: Friday Nov 6, 2026 at 14:15:00 UTC
  const now = new Date(Date.UTC(2026, 10, 6, 14, 15, 0));
  // Target: Friday at 14:30:00 UTC (15 mins later)
  const schedule = { day: 5, time: '14:30', episode: 9 };

  const res = computeAiringCountdown(schedule, 12, 8, now);
  assert.ok(res);
  assert.equal(res.days, 0);
  assert.equal(res.hours, 0);
  assert.equal(res.minutes, 15);
  assert.equal(res.isAiringSoon, true);
  assert.equal(res.shortLabel, '15m');
});

test('Service Worker: sw.js defines notificationclick listener for interactive alerts', () => {
  const swPath = resolve('public/sw.js');
  const code = readFileSync(swPath, 'utf8');

  assert.match(code, /notificationclick/);
  assert.match(code, /event\.notification\.close\(\)/);
  assert.match(code, /openWindow/);
});
