import { DAYS } from '../data/model.ts';

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

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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
