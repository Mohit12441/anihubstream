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

test('Watch.tsx auto-expands virtual episode shells for high episode numbers (e.g. Ep 61)', () => {
  const watchSrc = fs.readFileSync(path.resolve(ROOT, 'src/pages/Watch.tsx'), 'utf8');

  // Must support parsing and expanding up to requestedEp
  assert.ok(
    watchSrc.includes('validRequested'),
    'Watch.tsx must validate requested episode number from URL'
  );

  // Must expand missing episode shells up to count
  assert.ok(
    watchSrc.includes('// Expand missing episode shells up to count'),
    'Watch.tsx must expand missing shells up to requested episode count'
  );

  // Must not clamp to 1 when navigating to high episode
  assert.ok(
    watchSrc.includes('for (let i = existingCount + 1; i <= count; i++)'),
    'Watch.tsx must loop and populate shells from existingCount + 1 up to count'
  );

  // Must lazily initialize epNum from URL to eliminate 1-frame episode 1 flash
  assert.ok(
    watchSrc.includes('const [epNum, setEpNum] = useState<number>(() =>'),
    'Watch.tsx must lazily initialize epNum from URL route or query param'
  );

  // Must size fallback anime with validRequested to avoid artificial 12-episode clamping
  assert.ok(
    watchSrc.includes('const totalEps = isMovie ? 1 : Math.max(validRequested, validQueryEp, 12);'),
    'Watch.tsx must size fallback anime with validRequested instead of hardcoded 12'
  );
});

test('catalogue.tsx resets stale anime state when switching anime to prevent episode cross-clamping', () => {
  const catSrc = fs.readFileSync(path.resolve(ROOT, 'src/state/catalogue.tsx'), 'utf8');

  assert.ok(
    catSrc.includes('const isSameAnime = s.anime?.id === id;'),
    'catalogue.tsx must check if cached anime matches requested id'
  );
  assert.ok(
    catSrc.includes('anime: isSameAnime ? s.anime : null,'),
    'catalogue.tsx must reset anime to null when id changes to avoid leaking previous anime'
  );
});

test('ScheduleList differentiates between released episodes and upcoming countdowns', () => {
  const listSrc = fs.readFileSync(path.resolve(ROOT, 'src/components/ScheduleList.tsx'), 'utf8');

  assert.ok(
    listSrc.includes('const isReleased = status.type === \'released\' || (nextEp !== null && (e.anime.episodeCount ?? 0) >= nextEp);'),
    'ScheduleList must determine release status by status.type or database episodeCount'
  );
  assert.ok(
    listSrc.includes('nextEp && nextEp > 1'),
    'ScheduleList must safely handle upcoming episodes without producing episode 0'
  );
});

test('sync-episodes supports high episode numbers without artificial 50-episode cap', () => {
  const syncSrc = fs.readFileSync(path.resolve(ROOT, 'cloud-sync/sync-episodes.mjs'), 'utf8');

  assert.ok(
    !syncSrc.includes('Math.min(Math.max(anime.episode_total || 1, 1), 50)'),
    'sync-episodes must not artificially cap ongoing shows at 50 episodes'
  );
  assert.ok(
    syncSrc.includes('2000'),
    'sync-episodes must support episode ceiling up to 2000 for long-running series'
  );
});
