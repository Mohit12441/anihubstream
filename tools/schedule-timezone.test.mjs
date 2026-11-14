import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { convertSlotTimezone, formatScheduleEntry, getUserTimezoneLabel } from '../src/lib/scheduleTime.ts';

describe('TASK 9 (P2) — Schedule Timezone Conversion & Year Filter', () => {
  it('converts Sunday night slot into Monday morning slot in positive timezone (e.g. JST UTC+9)', () => {
    const slot = {
      day: 7, // Sunday
      dayLabel: 'SUN',
      time: '20:00',
      date: 'Oct 14',
    };

    // +540 minutes = UTC+9 (Japan Standard Time)
    const converted = convertSlotTimezone(slot, true, 540);

    assert.equal(converted.day, 1, 'Sunday 20:00 UTC + 9h should roll into Monday (day 1)');
    assert.equal(converted.dayLabel, 'MON');
    assert.equal(converted.time, '05:00');
    assert.equal(converted.date, 'Oct 15', 'Date must roll forward by 1 day');
  });

  it('converts Monday early morning slot into Sunday night slot in negative timezone (e.g. EDT UTC-4)', () => {
    const slot = {
      day: 1, // Monday
      dayLabel: 'MON',
      time: '02:00',
      date: 'Oct 15',
    };

    // -240 minutes = UTC-4 (Eastern Daylight Time)
    const converted = convertSlotTimezone(slot, true, -240);

    assert.equal(converted.day, 7, 'Monday 02:00 UTC - 4h should roll back into Sunday (day 7)');
    assert.equal(converted.dayLabel, 'SUN');
    assert.equal(converted.time, '22:00');
    assert.equal(converted.date, 'Oct 14', 'Date must roll back by 1 day');
  });

  it('preserves exact UTC day and time when useLocal is false', () => {
    const slot = {
      day: 7,
      dayLabel: 'SUN',
      time: '20:00',
      date: 'Oct 14',
    };

    const utc = convertSlotTimezone(slot, false, 540);

    assert.equal(utc.day, 7);
    assert.equal(utc.dayLabel, 'SUN');
    assert.equal(utc.time, '20:00');
    assert.equal(utc.date, 'Oct 14');
  });

  it('keeps same day for airtimes within the day in same timezone', () => {
    const slot = {
      day: 3, // Wednesday
      dayLabel: 'WED',
      time: '12:00',
      date: 'Oct 16',
    };

    const converted = convertSlotTimezone(slot, true, 330); // UTC+5:30 (India)
    assert.equal(converted.day, 3);
    assert.equal(converted.dayLabel, 'WED');
    assert.equal(converted.time, '17:30');
    assert.equal(converted.date, 'Oct 16');
  });

  it('rolls forward month date boundary cleanly (e.g. Oct 31 to Nov 1)', () => {
    const slot = {
      day: 7, // Sunday
      dayLabel: 'SUN',
      time: '20:00',
      date: 'Oct 31',
    };

    const converted = convertSlotTimezone(slot, true, 540); // UTC+9
    assert.equal(converted.day, 1);
    assert.equal(converted.dayLabel, 'MON');
    assert.equal(converted.time, '05:00');
    assert.equal(converted.date, 'Nov 1', 'Date must roll forward across month boundary');
  });

  it('rolls backward month date boundary cleanly (e.g. Nov 1 to Oct 31)', () => {
    const slot = {
      day: 1, // Monday
      dayLabel: 'MON',
      time: '02:00',
      date: 'Nov 1',
    };

    const converted = convertSlotTimezone(slot, true, -240); // UTC-4
    assert.equal(converted.day, 7);
    assert.equal(converted.dayLabel, 'SUN');
    assert.equal(converted.time, '22:00');
    assert.equal(converted.date, 'Oct 31', 'Date must roll backward across month boundary');
  });

  it('getUserTimezoneLabel returns valid timezone descriptor', () => {
    const label = getUserTimezoneLabel();
    assert.ok(typeof label === 'string' && label.length > 0);
    assert.match(label, /UTC/i);
  });

  it('formatScheduleEntry recomputes day and time from sched_dub_at when scheduleType is dub', () => {
    // 1793725200000 = Tue, 03 Nov 2026 17:00:00 GMT (UTC Tuesday = day 2)
    const entry = {
      anime: {
        id: 'one-piece',
        title: 'One Piece',
        poster: '',
        key: '',
        episodeCount: 1181,
        sched_dub_at: 1793725200000,
      },
      day: 7, // Sunday slot for sub
      dayLabel: 'SUN',
      time: '14:16',
      date: 'Nov 01',
      season: 'Fall 2026',
      sched_dub_at: 1793725200000,
    };

    const formattedSub = formatScheduleEntry(entry, false, 'sub');
    assert.equal(formattedSub.day, 7, 'Sub format retains Sunday slot');
    assert.equal(formattedSub.time, '14:16');

    const formattedDub = formatScheduleEntry(entry, false, 'dub');
    assert.equal(formattedDub.day, 2, 'Dub format rolls to Tuesday from timestamp');
    assert.equal(formattedDub.time, '17:00');
  });

  it('formatScheduleEntry falls back to slot timezone when target timestamp is absent', () => {
    const entry = {
      anime: {
        id: 'sub-only-anime',
        title: 'Sub Only Anime',
        poster: '',
        key: '',
        episodeCount: 12,
      },
      day: 3,
      dayLabel: 'WED',
      time: '12:00',
      date: 'Oct 14',
      season: 'Fall 2026',
    };

    const formatted = formatScheduleEntry(entry, false, 'dub');
    assert.equal(formatted.day, 3);
    assert.equal(formatted.time, '12:00');
  });
});
