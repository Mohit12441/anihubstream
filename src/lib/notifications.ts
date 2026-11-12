/**
 * Web Push & Local Notification Manager
 * Handles user subscription to anime episode airing alerts,
 * browser permission negotiation, and service worker notification dispatch.
 */

import { computeAiringCountdown, type ScheduleInfo } from './airingCountdown.ts';

export interface NotificationSubscription {
  animeId: string;
  title: string;
  poster?: string;
  nextEp?: number | null;
  scheduleDay: number;
  scheduleTime: string;
  createdAt: number;
}

export interface NotificationPreferences {
  enabled: boolean;
  leadTimeMinutes: number; // e.g. 0 (at air), 15, 30
  subscriptions: NotificationSubscription[];
  alertHistory: Record<string, number>; // key: `${animeId}_ep${ep}` -> timestamp
}

const STORAGE_KEY = 'anihub_notification_prefs';

const DEFAULT_PREFS: NotificationPreferences = {
  enabled: true,
  leadTimeMinutes: 15,
  subscriptions: [],
  alertHistory: {},
};

export function isNotificationSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return 'Notification' in window && 'serviceWorker' in navigator;
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!isNotificationSupported()) return 'denied';
  try {
    const result = await Notification.requestPermission();
    return result;
  } catch {
    return 'denied';
  }
}

export function getNotificationPrefs(): NotificationPreferences {
  if (typeof window === 'undefined') return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw);
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : true,
      leadTimeMinutes: typeof parsed.leadTimeMinutes === 'number' ? parsed.leadTimeMinutes : 15,
      subscriptions: Array.isArray(parsed.subscriptions) ? parsed.subscriptions : [],
      alertHistory: typeof parsed.alertHistory === 'object' && parsed.alertHistory ? parsed.alertHistory : {},
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function saveNotificationPrefs(prefs: NotificationPreferences): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {}
}

export function isSubscribed(animeId: string): boolean {
  const prefs = getNotificationPrefs();
  return prefs.subscriptions.some((s) => s.animeId === animeId);
}

export async function toggleSubscription(
  anime: {
    id: string;
    title: string;
    poster?: string;
    schedule?: ScheduleInfo | null;
  }
): Promise<boolean> {
  const prefs = getNotificationPrefs();
  const index = prefs.subscriptions.findIndex((s) => s.animeId === anime.id);

  if (index >= 0) {
    // Unsubscribe
    prefs.subscriptions.splice(index, 1);
    saveNotificationPrefs(prefs);
    return false;
  }

  // Subscribe
  if (isNotificationSupported()) {
    if (Notification.permission === 'denied') return false;
    if (Notification.permission === 'default') {
      const permission = await requestNotificationPermission();
      if (permission !== 'granted') {
        return false;
      }
    }
  }

  if (!anime.schedule?.day || !anime.schedule?.time) {
    return false;
  }

  const newSub: NotificationSubscription = {
    animeId: anime.id,
    title: anime.title,
    poster: anime.poster,
    nextEp: anime.schedule.episode ?? null,
    scheduleDay: anime.schedule.day,
    scheduleTime: anime.schedule.time,
    createdAt: Date.now(),
  };

  prefs.subscriptions.push(newSub);
  saveNotificationPrefs(prefs);

  // Remote push is retired (endpoints deleted). Local in-browser alerts
  // are handled entirely by checkAiringAlerts() using the schedule data
  // saved above. No server round-trip needed.

  // Send a confirmation toast / test alert if supported
  sendLocalNotification(`Subscribed to ${anime.title}`, {
    body: `You'll get a notification when new episodes air!`,
    icon: anime.poster || '/emblem.svg',
    tag: `sub_${anime.id}`,
  });

  return true;
}

export async function sendLocalNotification(
  title: string,
  options: NotificationOptions & { data?: Record<string, unknown> } = {}
): Promise<boolean> {
  if (!isNotificationSupported() || Notification.permission !== 'granted') {
    return false;
  }

  const defaultOptions: NotificationOptions = {
    icon: '/emblem.svg',
    badge: '/emblem.svg',
    silent: false,
    ...options,
  };

  try {
    // 1. Prefer Service Worker registration (works on mobile / Android PWA)
    if (navigator.serviceWorker.controller) {
      const reg = await navigator.serviceWorker.ready;
      if (reg && 'showNotification' in reg) {
        await reg.showNotification(title, defaultOptions);
        return true;
      }
    }

    // 2. Fallback to Window Notification
    new Notification(title, defaultOptions);
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks all active subscriptions against current time.
 * If an episode is scheduled to air within `leadTimeMinutes` and hasn't alerted yet,
 * dispatches a desktop/mobile notification.
 */
export async function checkAiringAlerts(): Promise<number> {
  const prefs = getNotificationPrefs();
  if (!prefs.enabled || !prefs.subscriptions.length) return 0;
  if (!isNotificationSupported() || Notification.permission !== 'granted') return 0;

  const now = new Date();
  const thresholdSeconds = prefs.leadTimeMinutes * 60;
  let triggeredCount = 0;

  for (const sub of prefs.subscriptions) {
    const countdown = computeAiringCountdown(
      {
        day: sub.scheduleDay,
        time: sub.scheduleTime,
        episode: sub.nextEp,
      },
      null,
      null,
      now
    );

    if (!countdown) continue;

    // Trigger alert if within threshold (e.g. within 15 minutes) or just aired within the last 5 minutes
    const epNum = countdown.nextEpisode ?? sub.nextEp ?? 1;
    const alertKey = `${sub.animeId}_ep${epNum}`;

    if (prefs.alertHistory[alertKey]) {
      // Already alerted for this episode
      continue;
    }

    // 604800s in a week. If elapsed < 15 mins (900s) past airtime, target wrapped to next week but it just aired
    const elapsedSinceAir = 604800 - countdown.totalSeconds;
    const isJustAired = elapsedSinceAir >= 0 && elapsedSinceAir <= 900;

    if (countdown.totalSeconds <= thresholdSeconds || isJustAired) {
      const timeDesc = isJustAired || countdown.totalSeconds <= 60
        ? 'airing now!'
        : `airing in ${Math.ceil(countdown.totalSeconds / 60)} minutes!`;

      const success = await sendLocalNotification(`New Episode: ${sub.title}`, {
        body: `Episode ${epNum} is ${timeDesc}`,
        icon: sub.poster || '/emblem.svg',
        tag: `airing_${sub.animeId}_${epNum}`,
        data: {
          url: `/watch/${sub.animeId}/${epNum}`,
          animeId: sub.animeId,
          episode: epNum,
        },
      });

      if (success) {
        prefs.alertHistory[alertKey] = Date.now();
        triggeredCount++;
      }
    }
  }

  if (triggeredCount > 0) {
    // Prune alert history older than 30 days
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    for (const [k, timestamp] of Object.entries(prefs.alertHistory)) {
      if (timestamp < thirtyDaysAgo) {
        delete prefs.alertHistory[k];
      }
    }
    saveNotificationPrefs(prefs);
  }

  return triggeredCount;
}
