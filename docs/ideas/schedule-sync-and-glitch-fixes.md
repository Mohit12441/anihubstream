# Schedule Daily Sync Architecture & Glitch Fixes

## Problem Statement
How Might We ensure the AniHubStream anime broadcast schedule syncs reliably once every day, while fixing critical schedule glitches—including stale lingering schedules from finished anime, timezone month-rollover calculation bugs, single-title highlighting bugs, and missing daily workflow automation?

---

## Analysis of Identified Drawbacks, Glitches & Bugs

### 1. Stale Airing Slots Lingering on Schedule
- **Issue**: `tools/sync-ongoing-schedules.mjs` only updated rows where AniList returned `nextAiringEpisode.airingAt`. If an anime finished or had no upcoming episodes, its `sched_day`, `sched_date`, and `sched_time` were never cleared.
- **Example**: `Cyberpunk: Edgerunners 2` (Upcoming) lingered with `Oct 20` schedule indefinitely.
- **Fix**: Clear `sched_day=NULL, sched_day_label=NULL, sched_date=NULL, sched_time=NULL, sched_season=NULL` for titles with no active upcoming episode, and for any anime with `status IN ('Finished', 'Cancelled')`.

### 2. Timezone Month-Rollover Date Calculation Glitch
- **Issue**: In `src/lib/scheduleTime.ts`, `convertSlotTimezone()` used naive integer math on string dates (`shiftedDay = dayNum + deltaDays`). When shifting across month boundaries (e.g. `Oct 31` -> `Nov 1` or `Nov 1` -> `Oct 31`), the guard `shiftedDay > 0 && shiftedDay <= 31` failed, causing the old month/day to be displayed under the new day.
- **Fix**: Parse into standard UTC dates (`Date.UTC(year, monthIdx, dayNum)`) and use native `setUTCDate(d.getUTCDate() + deltaDays)` to handle all month boundaries, leap years, and year rollovers accurately.

### 3. "Airing Today" Single-Title Highlighting Glitch
- **Issue**: `src/pages/Schedule.tsx` used `entries.find(e => e.day === todayDay)?.anime?.id`, passing a single `highlightId` to `<ScheduleList>`. As a result, only ONE anime on the day received the crimson `.tl__row[data-today]` highlight, while the rest of the day's anime appeared unhighlighted.
- **Fix**: Pass `todayDay` directly to `<ScheduleList>`, so every episode broadcasting on today's date receives the glowing crimson indicator and border.

### 4. Day Filter Bar Lacks "TODAY" Badge
- **Issue**: The day tabs (`MON`, `TUE`, `WED`, `THU`, `FRI`, `SAT`, `SUN`) had no indication of which day is today in the viewer's active timezone.
- **Fix**: Add a subtle `Today` badge or indicator to the matching day button in the tablist.

### 5. Automated Daily Sync Pipeline
- **Issue**: `tools/sync-ongoing-schedules.mjs` only ran against local SQLite and had no remote Cloudflare D1 execution mode or scheduled GitHub Actions workflow.
- **Fix**:
  - Add `--remote` flag to `tools/sync-ongoing-schedules.mjs` to execute updates via Cloudflare D1 API / Wrangler.
  - Create `.github/workflows/schedule-sync.yml` running daily at 03:00 UTC (`cron: '0 3 * * *'`).
  - Add `"sync:schedule": "node tools/sync-ongoing-schedules.mjs"` to `package.json`.

---

## MVP Scope
1. **Fix `src/lib/scheduleTime.ts`**: Implement robust UTC date rollover.
2. **Fix `src/components/ScheduleList.tsx` & `src/pages/Schedule.tsx`**: Highlight all anime airing today and show "Today" on the day tab.
3. **Upgrade `tools/sync-ongoing-schedules.mjs`**: Clear stale slots, support `--remote`, and execute cleanly.
4. **Create `.github/workflows/schedule-sync.yml`**: Daily automated cron job.
5. **Verify**: Add unit tests in `tools/schedule-timezone.test.mjs`, run all 201+ tests, verify TypeScript & Pages builds.
