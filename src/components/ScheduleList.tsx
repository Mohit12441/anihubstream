import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, BellOff, Calendar, CheckCircle2, Clock, Film, Play, Star, Timer } from 'lucide-react';
import { Art } from './Art';
import { CardMeta } from './CardMeta';
import { cleanAnimeTitle, type ScheduleEntry } from '../data/model';
import { getEpisodeReleaseStatus } from '../lib/scheduleTime';
import { getNotificationPrefs, isNotificationSupported, toggleSubscription } from '../lib/notifications';

interface Props {
  entries: ScheduleEntry[];
  highlightId?: string | null;
  todayDay?: number;
  useLocalTime?: boolean;
  audio?: 'sub' | 'dub';
}

export function ScheduleList({ entries, highlightId, todayDay, useLocalTime = true, audio = 'sub' }: Props) {
  const [now, setNow] = useState(() => new Date());
  const [subscribedMap, setSubscribedMap] = useState<Record<string, boolean>>({});

  // Sync subscription states
  useEffect(() => {
    const prefs = getNotificationPrefs();
    const subSet = new Set(prefs.subscriptions.map((s) => s.animeId));
    const map: Record<string, boolean> = {};
    for (const e of entries) {
      if (e.anime?.id) {
        map[e.anime.id] = subSet.has(e.anime.id);
      }
    }
    setSubscribedMap(map);
  }, [entries]);

  const handleToggleSub = async (e: React.MouseEvent, entry: ScheduleEntry, nextEp: number | null) => {
    e.preventDefault();
    e.stopPropagation();
    const rawSched = audio === 'dub' && (entry.sched_dub_at || entry.anime.sched_dub_at)
      ? (() => {
          const d = new Date((entry.sched_dub_at ?? entry.anime.sched_dub_at)!);
          const day = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
          const time = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
          return { day, time };
        })()
      : {
          day: entry.anime.schedule?.day ?? entry.day,
          time: entry.anime.schedule?.time ?? entry.time,
        };

    const nextState = await toggleSubscription({
      id: entry.anime.id,
      title: entry.anime.title,
      poster: entry.anime.poster,
      schedule: {
        day: rawSched.day,
        time: rawSched.time,
        date: entry.date,
        episode: nextEp,
      },
    });
    setSubscribedMap((prev) => ({ ...prev, [entry.anime.id]: nextState }));
  };

  // Keep countdown updated live every second
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!entries.length) {
    return (
      <div className="empty" role="status">
        <p>
          <b>No anime scheduled to air for this selection.</b>
          Pick another release day or switch the filter back to All.
        </p>
      </div>
    );
  }

  const liveTodayDay = useLocalTime
    ? (now.getDay() === 0 ? 7 : now.getDay())
    : (now.getUTCDay() === 0 ? 7 : now.getUTCDay());
  const effectiveTodayDay = todayDay && todayDay === liveTodayDay ? todayDay : liveTodayDay;

  return (
    <ol className="tl">
      {entries.map((e, idx) => {
        const cleanTitle = cleanAnimeTitle(e.anime.title);
        const targetTs = audio === 'dub' ? (e.sched_dub_at ?? e.dubAt) : (e.sched_sub_at ?? e.subAt);
        const status = getEpisodeReleaseStatus(e.day, e.time, effectiveTodayDay, now, useLocalTime, e.date, targetTs);
        const isToday = e.day === effectiveTodayDay;

        const nextEp = e.episode && e.episode > 0
          ? e.episode
          : (e.anime.schedule?.episode && e.anime.schedule.episode > 0
            ? e.anime.schedule.episode
            : null);

        const isReleased = status.type === 'released';

        const targetEp = isReleased
          ? (nextEp ?? (e.anime.episodeCount && e.anime.episodeCount > 0 ? e.anime.episodeCount : 1))
          : (nextEp && nextEp > 1
            ? nextEp - 1
            : (e.anime.episodeCount && e.anime.episodeCount > 0 ? e.anime.episodeCount : 1));

        const hasDub = Boolean(e.sched_dub_at || e.dubAt || e.anime.sched_dub_at || e.anime.schedule?.dubAt);
        const toWatch = `/watch/${e.anime.id}/${targetEp}`;
        const watchTarget = audio === 'dub' && hasDub ? `${toWatch}?audio=dub` : toWatch;

        const pillEpLabel = (!isReleased && nextEp) ? `Next: Ep ${nextEp}` : `Ep ${targetEp}`;

        return (
          <li
            key={`${e.anime.id}-${e.day}-${e.time}`}
            className="tl__row"
            data-today={isToday || e.anime.id === highlightId || undefined}
            style={{ '--row-idx': idx } as React.CSSProperties}
          >
            {/* Release Day column */}
            <div className="tl__day">
              <span className="tl__dot" aria-hidden="true" />
              <b>{e.dayLabel}</b>
              <span>{e.date}</span>
              {isToday && <span className="tl__today-badge">TODAY</span>}
            </div>

            {/* Poster Thumbnail */}
            <Link to={watchTarget} className="tl__thumb" tabIndex={-1} aria-hidden="true">
              <Art sources={[e.anime.poster, e.anime.key]} alt="" hideWhenEmpty />
              <span className="tl__thumb-overlay">
                <Play size={20} fill="#fff" strokeWidth={0} />
              </span>
            </Link>

            {/* Content Body */}
            <div className="tl__body">
              <div className="tl__badges">
                {/* Status Badge */}
                {status.type === 'released' && (
                  <span className="tl__status tl__status--released">
                    <CheckCircle2 size={12} aria-hidden="true" />
                    {status.label}
                  </span>
                )}
                {status.type === 'countdown' && (
                  <span className="tl__status tl__status--countdown">
                    <Timer size={12} aria-hidden="true" />
                    {status.label}
                  </span>
                )}
                {status.type === 'upcoming' && (
                  <span className="tl__status tl__status--upcoming">
                    <Calendar size={12} aria-hidden="true" />
                    {status.label}
                  </span>
                )}
                {audio === 'dub' && !hasDub && (
                  <span className="tl__status" style={{ opacity: 0.75 }}>
                    Sub only
                  </span>
                )}

                {/* Latest Episode Badge */}
                <span className="tl__ep-pill">
                  <Film size={11} aria-hidden="true" />
                  {pillEpLabel}{e.anime.episodeTotal ? ` / ${e.anime.episodeTotal}` : ''}
                </span>

                {/* Rating */}
                {e.anime.rating > 0 && (
                  <span className="tl__rating">
                    <Star size={11} fill="currentColor" strokeWidth={0} aria-hidden="true" />
                    {(e.anime.rating > 10 ? e.anime.rating / 10 : e.anime.rating).toFixed(1)}
                  </span>
                )}
              </div>

              <Link to={watchTarget} className="tl__title">
                {cleanTitle}
              </Link>

              {e.anime.native && (
                <p className="tl__native" lang="ja">
                  {e.anime.native}
                </p>
              )}

              <CardMeta anime={e.anime} className="tl__meta" />
              <p className="tl__syn">{e.anime.synopsis}</p>
            </div>

            {/* Time & Direct Watch Action */}
            <div className="tl__end">
              <span className="tl__time" title={`Release airtime: ${e.time}`}>
                <span className="tl__mobile-day">{e.dayLabel}</span>
                <Clock size={13} aria-hidden="true" />
                <span>{e.time}</span>
              </span>

              {isNotificationSupported() && !isReleased && (
                <button
                  type="button"
                  className={`tl__remind ${subscribedMap[e.anime.id] ? 'tl__remind--active' : ''}`}
                  onClick={(ev) => handleToggleSub(ev, e, nextEp)}
                  title={subscribedMap[e.anime.id] ? 'Subscribed to notifications' : 'Get notified when episode airs'}
                >
                  {subscribedMap[e.anime.id] ? <BellOff size={13} /> : <Bell size={13} />}
                  <span>{subscribedMap[e.anime.id] ? 'Alerted' : 'Notify'}</span>
                </button>
              )}

              <Link className="tl__watch" to={watchTarget} title={`Stream ${cleanTitle} Episode ${targetEp}`}>
                <Play size={14} fill="currentColor" strokeWidth={0} aria-hidden="true" />
                <span>Watch Ep {targetEp}</span>
                <span className="sr-only"> — Stream {cleanTitle} Episode {targetEp}</span>
              </Link>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
