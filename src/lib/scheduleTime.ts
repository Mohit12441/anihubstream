import { DAYS, type ScheduleEntry } from '../data/model.ts';

export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface ConvertedSlot {
  day: number; // 1 to 7 (1 = MON, 7 = SUN)
  dayLabel: string; // 'MON', 'TUE', ...
  time: string; // 'HH:MM'
  date: string; // 'Oct 14'
}

/**
 * Converts a schedule slot from UTC to a target timezone offset (defaults to viewer's local offset).
 * If useLocal is false, preserves exact UTC slot without alteration.
 */
export function convertSlotTimezone(
  slot: { day: number; dayLabel: string; time: string; date: string },
  useLocal = true,
  offsetMinutes = -new Date().getTimezoneOffset(),
): ConvertedSlot {
  if (!useLocal || offsetMinutes === 0 || !slot.time || !slot.day) {
    return {
      day: slot.day,
      dayLabel: slot.dayLabel,
      time: slot.time,
      date: slot.date,
    };
  }

  const [hours, minutes] = slot.time.split(':').map((v) => Number.parseInt(v, 10) || 0);
  // Total minutes from Monday 00:00 UTC (day 1 = 0 days elapsed, day 7 = 6 days elapsed)
  const utcTotalMinutes = (slot.day - 1) * 1440 + hours * 60 + minutes;

  // 7 days * 24h * 60m = 10080 minutes per week
  let localTotalMinutes = (utcTotalMinutes + offsetMinutes) % 10080;
  if (localTotalMinutes < 0) localTotalMinutes += 10080;

  const localDayIndex = Math.floor(localTotalMinutes / 1440); // 0 = MON, 6 = SUN
  const localDay = localDayIndex + 1;
  const localDayLabel = DAYS[localDayIndex];

  const remainingMinutes = localTotalMinutes % 1440;
  const localHours = Math.floor(remainingMinutes / 60);
  const localMins = remainingMinutes % 60;
  const localTime = `${String(localHours).padStart(2, '0')}:${String(localMins).padStart(2, '0')}`;

  // Date roll-over adjustment
  let localDate = slot.date;
  const daysDiff = localDay - slot.day;
  // Handle week boundary wrap (e.g. Sun(7) -> Mon(1) is +1 day, Mon(1) -> Sun(7) is -1 day)
  let deltaDays = daysDiff;
  if (daysDiff === -6) deltaDays = 1;
  else if (daysDiff === 6) deltaDays = -1;

  if (deltaDays !== 0 && slot.date) {
    const parts = slot.date.trim().split(/\s+/);
    if (parts.length === 2) {
      const monthIdx = MONTH_NAMES.indexOf(parts[0]);
      const dayNum = Number.parseInt(parts[1], 10);
      if (monthIdx !== -1 && !isNaN(dayNum)) {
        const currentYear = new Date().getFullYear();
        const d = new Date(Date.UTC(currentYear, monthIdx, dayNum));
        d.setUTCDate(d.getUTCDate() + deltaDays);
        localDate = `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCDate()}`;
      }
    }
  }

  return {
    day: localDay,
    dayLabel: localDayLabel,
    time: localTime,
    date: localDate,
  };
}

/**
 * Formats a schedule entry using dynamic epoch timestamps (sub/dub) or fallback slot time.
 */
export function formatScheduleEntry(
  e: ScheduleEntry,
  useLocalTime: boolean,
  scheduleType: 'sub' | 'dub',
): ScheduleEntry {
  const schedSubAt = e.sched_sub_at ?? e.subAt ?? e.anime.sched_sub_at ?? e.anime.schedule?.subAt ?? null;
  const schedDubAt = e.sched_dub_at ?? e.dubAt ?? e.anime.sched_dub_at ?? e.anime.schedule?.dubAt ?? null;

  const targetIso = scheduleType === 'dub' ? schedDubAt : (scheduleType === 'sub' ? schedSubAt : null);
  if (targetIso) {
    const d = new Date(typeof targetIso === 'number' && targetIso < 1e11 ? targetIso * 1000 : targetIso);
    if (!isNaN(d.getTime())) {
      const dayOfWeek = useLocalTime ? d.getDay() : d.getUTCDay();
      const day = dayOfWeek === 0 ? 7 : dayOfWeek;
      const dayLabel = DAYS[day - 1] ?? e.dayLabel;
      const time = useLocalTime
        ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
        : `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
      const date = useLocalTime
        ? `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`
        : `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCDate()}`;

      return {
        ...e,
        day,
        dayLabel,
        time,
        date,
        sched_sub_at: schedSubAt,
        sched_dub_at: schedDubAt,
      };
    }
  }

  const converted = convertSlotTimezone(e, useLocalTime);
  return {
    ...e,
    day: converted.day,
    dayLabel: converted.dayLabel,
    time: converted.time,
    date: converted.date,
    sched_sub_at: schedSubAt,
    sched_dub_at: schedDubAt,
  };
}

export function getUserTimezoneLabel(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const offsetMin = -new Date().getTimezoneOffset();
    const sign = offsetMin >= 0 ? '+' : '-';
    const absMin = Math.abs(offsetMin);
    const h = Math.floor(absMin / 60);
    const m = absMin % 60;
    const formattedOffset = `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
    return tz ? `${tz} (${formattedOffset})` : formattedOffset;
  } catch {
    return 'Local time';
  }
}

export interface EpisodeReleaseStatus {
  type: 'released' | 'countdown' | 'upcoming';
  label: string;
  countdown?: string;
}

/**
 * Parses a schedule date string (e.g. 'Nov 16', 'Oct 14') and time string into a Date.
 */
export function parseScheduleDate(
  dateStr?: string,
  timeStr = '00:00',
  refDate: Date = new Date(),
  useLocal = true,
): Date | null {
  if (!dateStr) return null;
  const parts = dateStr.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const monthIdx = MONTH_NAMES.indexOf(parts[0]);
  const dayNum = Number.parseInt(parts[1], 10);
  if (monthIdx === -1 || isNaN(dayNum)) return null;

  const [hStr = '0', mStr = '0'] = (timeStr || '00:00').split(':');
  const h = Number.parseInt(hStr, 10) || 0;
  const m = Number.parseInt(mStr, 10) || 0;

  const refYear = useLocal ? refDate.getFullYear() : refDate.getUTCFullYear();
  let year = refYear;
  const refMonth = useLocal ? refDate.getMonth() : refDate.getUTCMonth();
  if (refMonth === 11 && monthIdx === 0) {
    year += 1;
  } else if (refMonth === 0 && monthIdx === 11) {
    year -= 1;
  }

  return useLocal
    ? new Date(year, monthIdx, dayNum, h, m, 0, 0)
    : new Date(Date.UTC(year, monthIdx, dayNum, h, m, 0, 0));
}

export function getEpisodeReleaseStatus(
  day: number,
  timeStr: string,
  todayDay: number,
  now: Date = new Date(),
  useLocalTime = true,
  dateStr?: string,
  targetTimestamp?: number | null,
): EpisodeReleaseStatus {
  let targetMs: number | null = null;
  if (targetTimestamp != null && targetTimestamp > 0) {
    targetMs = targetTimestamp < 1e11 ? targetTimestamp * 1000 : targetTimestamp;
  }

  if (targetMs == null && dateStr) {
    const parsed = parseScheduleDate(dateStr, timeStr, now, useLocalTime);
    if (parsed) {
      targetMs = parsed.getTime();
    }
  }

  if (targetMs != null && !isNaN(targetMs)) {
    const diffMs = targetMs - now.getTime();
    if (diffMs <= 0) {
      return {
        type: 'released',
        label: 'Episode Released',
      };
    }

    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1440 && (day === todayDay || diffMs < 86400000)) {
      const hours = Math.floor(diffMins / 60);
      const mins = diffMins % 60;
      const countdown = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
      return {
        type: 'countdown',
        label: `Airing in ${countdown}`,
        countdown,
      };
    }

    return {
      type: 'upcoming',
      label: 'Coming Soon',
    };
  }

  const [hStr = '0', mStr = '0'] = (timeStr || '00:00').split(':');
  const slotHour = parseInt(hStr, 10) || 0;
  const slotMin = parseInt(mStr, 10) || 0;

  if (day === todayDay) {
    const curHour = useLocalTime ? now.getHours() : now.getUTCHours();
    const curMin = useLocalTime ? now.getMinutes() : now.getUTCMinutes();
    const currentMins = curHour * 60 + curMin;
    const slotMins = slotHour * 60 + slotMin;

    if (currentMins >= slotMins) {
      return {
        type: 'released',
        label: 'Episode Released',
      };
    } else {
      const diff = slotMins - currentMins;
      const hours = Math.floor(diff / 60);
      const mins = diff % 60;
      const countdown = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
      return {
        type: 'countdown',
        label: `Airing in ${countdown}`,
        countdown,
      };
    }
  } else if (day < todayDay) {
    return {
      type: 'released',
      label: 'Episode Released',
    };
  } else {
    return {
      type: 'upcoming',
      label: 'Coming Soon',
    };
  }
}
