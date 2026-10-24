import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, CheckCircle2, Clock, Film, Play, Star, Timer } from 'lucide-react';
import { Art } from './Art';
import { CardMeta } from './CardMeta';
import { cleanAnimeTitle, type ScheduleEntry } from '../data/model';
import { getEpisodeReleaseStatus } from '../lib/scheduleTime';

interface Props {
  entries: ScheduleEntry[];
  highlightId?: string | null;
  todayDay?: number;
}

export function ScheduleList({ entries, highlightId, todayDay }: Props) {
  const [now, setNow] = useState(() => new Date());

  // Keep countdown updated every minute
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
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

  const effectiveTodayDay = todayDay ?? (now.getDay() === 0 ? 7 : now.getDay());

  return (
    <ol className="tl">
      {entries.map((e, idx) => {
        const cleanTitle = cleanAnimeTitle(e.anime.title);
        const targetEp = e.anime.episodeCount && e.anime.episodeCount > 0 ? e.anime.episodeCount : 1;
        const toWatch = `/watch/${e.anime.id}/${targetEp}`;
        const status = getEpisodeReleaseStatus(e.day, e.time, effectiveTodayDay, now);
        const isToday = e.day === effectiveTodayDay;

        return (
          <li
            key={`${e.anime.id}-${e.time}`}
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
            <Link to={toWatch} className="tl__thumb" tabIndex={-1} aria-hidden="true">
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

                {/* Latest Episode Badge */}
                <span className="tl__ep-pill">
                  <Film size={11} aria-hidden="true" />
                  Ep {targetEp}{e.anime.episodeTotal ? ` / ${e.anime.episodeTotal}` : ''}
                </span>

                {/* Rating */}
                {e.anime.rating > 0 && (
                  <span className="tl__rating">
                    <Star size={11} fill="currentColor" strokeWidth={0} aria-hidden="true" />
                    {(e.anime.rating > 10 ? e.anime.rating / 10 : e.anime.rating).toFixed(1)}
                  </span>
                )}
              </div>

              <Link to={toWatch} className="tl__title">
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
                <Clock size={13} aria-hidden="true" />
                <span>{e.time}</span>
              </span>

              <Link className="tl__watch" to={toWatch} title={`Stream ${cleanTitle} Episode ${targetEp}`}>
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
