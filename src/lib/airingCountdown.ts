/**
 * Airing Countdown & Schedule Timing Engine
 * Computes exact future airing timestamps, weekly recurrence, and countdown intervals.
 */

export interface ScheduleInfo {
  day: number; // 1 (MON) to 7 (SUN) in UTC
  dayLabel?: string;
  time: string; // 'HH:MM' (UTC)
  date?: string;
  episode?: number | null;
  season?: string;
}

export interface AiringCountdownResult {
  targetDate: Date;
  diffMs: number;
  totalSeconds: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  formatted: string;
  shortLabel: string;
  isAiringSoon: boolean; // Under 1 hour
  isAiringToday: boolean;
  nextEpisode: number | null;
}

/**
 * Returns the exact UTC day index from 1 (Mon) to 7 (Sun)
 */
export function getUtcDayIndex(date: Date): number {
  const d = date.getUTCDay();
  return d === 0 ? 7 : d;
}

/**
 * Computes the next occurrence Date for a weekly schedule slot
 */
export function getNextAiringDate(
  schedule: ScheduleInfo,
  now: Date = new Date()
): Date | null {
  if (!schedule || !schedule.day || !schedule.time) return null;

  const [hStr = '0', mStr = '0'] = schedule.time.split(':');
  const targetHour = Number.parseInt(hStr, 10) || 0;
  const targetMin = Number.parseInt(mStr, 10) || 0;

  const currentDay = getUtcDayIndex(now);
  const currentUtcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const currentUtcSeconds = currentUtcMinutes * 60 + now.getUTCSeconds();
  const targetUtcSeconds = (targetHour * 60 + targetMin) * 60;

  let dayOffset = schedule.day - currentDay;

  // If slot is earlier today or earlier in the week, advance to next week
  if (dayOffset < 0 || (dayOffset === 0 && currentUtcSeconds >= targetUtcSeconds)) {
    dayOffset += 7;
  }

  const target = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + dayOffset,
    targetHour,
    targetMin,
    0,
    0
  ));

  return target;
}

/**
 * Computes complete countdown breakdown and human-friendly labels
 */
export function computeAiringCountdown(
  schedule: ScheduleInfo | null | undefined,
  episodeTotal?: number | null,
  episodeCount?: number | null,
  now: Date = new Date()
): AiringCountdownResult | null {
  if (!schedule || !schedule.day || !schedule.time) return null;

  const targetDate = getNextAiringDate(schedule, now);
  if (!targetDate) return null;

  const diffMs = Math.max(0, targetDate.getTime() - now.getTime());
  const totalSeconds = Math.floor(diffMs / 1000);

  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  let formatted = '';
  let shortLabel = '';

  if (days > 0) {
    formatted = `${days}d ${hours}h ${minutes}m`;
    shortLabel = `${days}d ${hours}h`;
  } else if (hours > 0) {
    formatted = `${hours}h ${minutes}m ${seconds}s`;
    shortLabel = `${hours}h ${minutes}m`;
  } else if (minutes > 0) {
    formatted = `${minutes}m ${seconds}s`;
    shortLabel = `${minutes}m`;
  } else {
    formatted = `${seconds}s`;
    shortLabel = `${seconds}s`;
  }

  const isAiringSoon = totalSeconds <= 3600; // < 60 mins
  const isAiringToday = days === 0;

  // Determine next episode number
  let nextEpisode: number | null = null;
  if (schedule.episode && schedule.episode > 0) {
    nextEpisode = schedule.episode;
  } else if (typeof episodeCount === 'number' && episodeCount >= 0) {
    nextEpisode = episodeCount + 1;
    if (episodeTotal && nextEpisode > episodeTotal) {
      nextEpisode = null; // Series concluded
    }
  }

  return {
    targetDate,
    diffMs,
    totalSeconds,
    days,
    hours,
    minutes,
    seconds,
    formatted,
    shortLabel,
    isAiringSoon,
    isAiringToday,
    nextEpisode,
  };
}
