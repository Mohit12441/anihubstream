# Schedule Page Live Release Overhaul

## Problem Statement
How Might We transform the `/schedule` page from a static, full-week schedule list into an engaging **Live Release Command Center** that automatically surfaces today's airing anime, delivers real-time countdowns, and enables 1-click playback to the newest episodes?

---

## Recommended Direction: Live Release Command Center

Transform `/schedule` to prioritize the real-time viewer experience:

1. **Smart Day Landing ("Today" by Default)**:
   - When users land on `/schedule`, automatically select the current day of the week (`todayDay`) instead of dumping all 7 days in one long list.
   - Highlight the "Today" pill in the day selector with a vibrant pulsating glow (`🔴 TODAY (X Airing)`).
   - Retain the "ALL (Full Week)" option for planning ahead.

2. **Real-Time Episode Countdowns & Live Status Badges**:
   - Calculate live relative timing for every airing slot:
     - 🔴 **LIVE NOW**: Title is currently broadcasting (within 30 mins of airtime).
     - ⏳ **AIRS IN Xh Ym**: Real-time ticker counting down to broadcast.
     - 🟢 **AIRED TODAY**: Episode has finished airing and is ready to stream.
     - 📅 **UPCOMING**: Scheduled for later this week.

3. **Episode Number Tracking & 1-Click Instant Watch**:
   - Display the next airing episode number (e.g. `Episode 5`, `Season Finale`).
   - "Watch Now" CTA links directly to `/watch/:id/:ep` (the newly aired or latest available episode).

4. **Timezone Confidence Indicator**:
   - Prominently display viewer's detected local timezone (e.g. `Local Time: IST (UTC+5:30)`) with a quick 1-click toggle to `JST (Tokyo)` and `UTC`.
   - Never leave viewers guessing whether airtimes are in Japan Standard Time or their local timezone.

5. **Clean Day & View Filters**:
   - Intuitive day strip: `MON`, `TUE`, `WED`, `THU`, `FRI`, `SAT`, `SUN`, plus `ALL`.
   - Visual cards with high-contrast time stamps, synopsis preview, genres, and studio/rating badges.

---

## Key Assumptions to Validate
- [ ] **Assumption 1**: Slot times can be accurately compared to client `Date.now()` across all timezones without drift.
  - *Validation*: Test with positive (JST, IST) and negative (EST, PST) timezones relative to UTC air times.
- [ ] **Assumption 2**: Episode counts from `anime.episodeCount` or `schedule.date` reliably inform the next episode number.
  - *Validation*: Check if `episodeCount > 0` provides clean `Ep ${episodeCount + 1}` or fallback gracefully to `New Episode`.
- [ ] **Assumption 3**: Auto-selecting "Today" does not break existing user habits of browsing the full week.
  - *Validation*: "Full Week" / "ALL" remains the first tab with clear slot counts.

---

## MVP Scope (Thin Vertical Slice)

### In-Scope (Phase 1):
1. **Default to Today**: Update `Schedule.tsx` state to initialize `day` to `todayDay` (with easy "ALL" reset).
2. **Live Timing Helper (`src/lib/scheduleTime.ts`)**:
   - `getAiringStatus(slotDate, slotTime, useLocalTime)` returning:
     - `status`: `'live' | 'soon' | 'aired' | 'upcoming'`
     - `label`: `'LIVE NOW' | 'Airs in 2h 15m' | 'Aired today' | 'Air date'`
     - `countdownMinutes`: number
3. **Status Badges in `ScheduleList.tsx`**:
   - Add status pill with pulsating beacon animation for live/airing titles.
   - Display episode number badge (`Ep ${n}`).
4. **1-Click Direct Episode Play**:
   - Update watch link to navigate directly to the newest episode.
5. **Timezone Selector Bar**:
   - Clean, visible timezone pill showing local timezone abbreviation with 1-click toggle.

### Not Doing (and Why):
- **Push Notification / Browser Alarms**: Web push requires Service Worker VAPID keys and user permissions; out of scope for MVP.
- **Calendar (.ics) Export**: Niche feature; live on-site countdown provides 90% of the value with 0 friction.
- **Multi-Server Provider Filter on Schedule**: Schedule is based on official broadcast airing times, not individual scrapers.

---

## Open Questions & Verification
- Should titles that already aired earlier today move to the top or bottom of the day's list? (Recommended: chronological order by air time, with "AIRED" badges).
- Would you like to proceed with implementing this MVP scope?
