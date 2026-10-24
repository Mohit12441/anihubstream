import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getEpisodeReleaseStatus } from '../src/lib/scheduleTime.ts';

const ROOT = process.cwd();

test('Header Navigation contains Episode Schedule Tab', () => {
  const header = fs.readFileSync(path.resolve(ROOT, 'src/components/Header.tsx'), 'utf8');
  assert.ok(
    header.includes("{ label: 'Episode Schedule', to: '/schedule' }"),
    'Header.tsx NAV must have Episode Schedule tab linking to /schedule'
  );
});

test('getEpisodeReleaseStatus calculation logic', () => {
  // Test Monday (day 1) when today is Wednesday (day 3) -> Already released
  const pastSlot = getEpisodeReleaseStatus(1, '18:00', 3, new Date('2026-10-21T12:00:00Z'));
  assert.equal(pastSlot.type, 'released');
  assert.equal(pastSlot.label, 'Episode Released');

  // Test Friday (day 5) when today is Wednesday (day 3) -> Coming Soon
  const futureSlot = getEpisodeReleaseStatus(5, '18:00', 3, new Date('2026-10-21T12:00:00Z'));
  assert.equal(futureSlot.type, 'upcoming');
  assert.equal(futureSlot.label, 'Coming Soon');

  // Test Wednesday (day 3) before airtime (airtime 18:00, current time 14:30) -> Countdown
  const mockNowBefore = new Date();
  mockNowBefore.setHours(14, 30, 0, 0);
  const countdownSlot = getEpisodeReleaseStatus(3, '18:00', 3, mockNowBefore);
  assert.equal(countdownSlot.type, 'countdown');
  assert.ok(countdownSlot.label.includes('Airing in 3h 30m'));

  // Test Wednesday (day 3) after airtime (airtime 18:00, current time 19:15) -> Released
  const mockNowAfter = new Date();
  mockNowAfter.setHours(19, 15, 0, 0);
  const releasedTodaySlot = getEpisodeReleaseStatus(3, '18:00', 3, mockNowAfter);
  assert.equal(releasedTodaySlot.type, 'released');
  assert.equal(releasedTodaySlot.label, 'Episode Released');
});

test('ScheduleList component links directly to target episode and renders Watch Ep button', () => {
  const listSrc = fs.readFileSync(path.resolve(ROOT, 'src/components/ScheduleList.tsx'), 'utf8');

  // Must construct target episode URL: /watch/:id/:ep
  assert.ok(
    listSrc.includes('const toWatch = `/watch/${e.anime.id}/${targetEp}`;'),
    'ScheduleList must construct direct target episode route /watch/:id/:ep'
  );

  // Must render prominent Watch button with episode number
  assert.ok(
    listSrc.includes('Watch Ep {targetEp}'),
    'ScheduleList must render Watch Ep {targetEp} action button'
  );

  // Must render status badges (released, countdown, upcoming)
  assert.ok(listSrc.includes('tl__status--released'), 'ScheduleList must style released badge');
  assert.ok(listSrc.includes('tl__status--countdown'), 'ScheduleList must style countdown badge');
  assert.ok(listSrc.includes('tl__status--upcoming'), 'ScheduleList must style upcoming badge');
});

test('Schedule page includes quick filters for Today, Upcoming, and Released', () => {
  const pageSrc = fs.readFileSync(path.resolve(ROOT, 'src/pages/Schedule.tsx'), 'utf8');

  assert.ok(
    pageSrc.includes("Today's Releases"),
    "Schedule.tsx must include Today's Releases quick filter"
  );
  assert.ok(
    pageSrc.includes('Upcoming'),
    'Schedule.tsx must include Upcoming quick filter'
  );
  assert.ok(
    pageSrc.includes('Episode Released'),
    'Schedule.tsx must include Episode Released quick filter'
  );
});
