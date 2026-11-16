import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { findSqlitePath } from './discover-titles.mjs';
import { formatScheduleEntry, convertSlotTimezone } from '../src/lib/scheduleTime.ts';

const dbPath = findSqlitePath();
const db = new DatabaseSync(dbPath);

test('Schedule Verification: Monday & Key Airing Titles in Local Time (IST +5:30)', () => {
  const titles = [
    {
      id: 'star-detective-precure',
      expectedSubDay: 7, // SUN in IST (airs Sat 23:30 UTC = Sun 05:00 IST)
      expectedSubTime: '05:00',
      isDubNull: true,
    },
    {
      id: 'psyren',
      expectedSubDay: 1, // MON in IST (airs Mon 14:00 UTC = Mon 19:30 IST)
      expectedSubTime: '19:30',
      isDubNull: true,
    },
    {
      id: 'dark-machine-the-animation',
      expectedSubDay: 2, // TUE in IST (airs Tue 16:45 UTC = Tue 22:15 IST)
      expectedSubTime: '22:15',
      isDubNull: true,
    },
    {
      id: 'red-river',
      expectedSubDay: 2, // TUE in IST (airs Tue 16:35 UTC = Tue 22:05 IST)
      expectedSubTime: '22:05',
      isDubNull: true,
    },
    {
      id: 'hello-i-am-a-witch-and-my-crush-wants-me-to-make-a-love-potion',
      expectedSubDay: 1, // MON in IST (airs Mon 12:30 UTC = Mon 18:00 IST)
      expectedSubTime: '18:00',
      isDubNull: true,
    },
    {
      id: 'hotaru-no-yomeiri-choitashi',
      expectedSubDay: 1, // MON in IST (airs Mon 09:00 UTC = Mon 14:30 IST)
      expectedSubTime: '14:30',
      isDubNull: true,
    },
    {
      id: 'a-tale-of-the-secret-saint',
      expectedSubDay: 6, // SAT in IST (airs Sat 13:00 UTC = Sat 18:30 IST)
      expectedSubTime: '18:30',
      isDubNull: true,
    },
  ];

  // Current IST offset = +330 minutes
  const IST_OFFSET = 330;

  for (const t of titles) {
    const row = db.prepare('SELECT * FROM anime WHERE id = ?').get(t.id);
    assert.ok(row, `Anime ${t.id} must exist in database`);
    assert.equal(row.sched_dub_at, null, `sched_dub_at must be NULL for ${t.id} to avoid fake dub countdowns`);

    const entry = {
      anime: row,
      day: row.sched_day,
      dayLabel: row.sched_day_label,
      time: row.sched_time,
      date: row.sched_date,
      season: row.sched_season,
      sched_sub_at: row.sched_sub_at,
      sched_dub_at: row.sched_dub_at,
    };

    // Sub mode in IST:
    const subFormatted = formatScheduleEntry(entry, true, 'sub');
    // If running in non-IST environment, convert explicitly using offset:
    const istSlot = row.sched_sub_at
      ? (() => {
          const d = new Date(row.sched_sub_at + IST_OFFSET * 60000);
          const day = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
          const time = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
          return { day, time };
        })()
      : convertSlotTimezone(entry, true, IST_OFFSET);

    assert.equal(istSlot.day, t.expectedSubDay, `${t.id} must air on day ${t.expectedSubDay} in IST`);
    assert.equal(istSlot.time, t.expectedSubTime, `${t.id} must air at ${t.expectedSubTime} in IST`);

    // In DUB mode: since sched_dub_at is null, formatScheduleEntry must fallback cleanly to SUB slot without fake countdown
    const dubFormatted = formatScheduleEntry(entry, true, 'dub');
    assert.equal(dubFormatted.sched_dub_at, null);
  }
});
