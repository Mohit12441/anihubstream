import { Link } from 'react-router-dom';
import { Clock, Play } from 'lucide-react';
import { Art } from './Art';
import { CardMeta } from './CardMeta';
import { type ScheduleEntry } from '../data/model';

interface Props {
  entries: ScheduleEntry[];
  highlightId?: string | null;
  todayDay?: number;
}

export function ScheduleList({ entries, highlightId, todayDay }: Props) {
  if (!entries.length) {
    return (
      <div className="empty" role="status">
        <p>
          <b>No anime scheduled to air on this day.</b>
          Pick another day or switch the season filter back to All.
        </p>
      </div>
    );
  }

  return (
    <ol className="tl">
      {entries.map((e) => (
        <li
          key={`${e.anime.id}-${e.time}`}
          className="tl__row"
          data-today={todayDay !== undefined ? (e.day === todayDay || undefined) : (e.anime.id === highlightId || undefined)}
        >
          <div className="tl__day">
            <span className="tl__dot" aria-hidden="true" />
            <b>{e.dayLabel}</b>
            <span>{e.date}</span>
          </div>

          <Link to={`/watch/${e.anime.id}`} className="tl__thumb" tabIndex={-1} aria-hidden="true">
            <Art sources={[e.anime.key, e.anime.poster]} alt="" hideWhenEmpty />
          </Link>

          <div className="tl__body">
            <Link to={`/watch/${e.anime.id}`} className="tl__title">
              {e.anime.title}
            </Link>
            <CardMeta anime={e.anime} className="tl__meta" />
            <p className="tl__syn">{e.anime.synopsis}</p>
          </div>

          <div className="tl__end">
            <span className="tl__time">
              <Clock size={12} aria-hidden="true" />
              {e.time}
            </span>
            <Link className="btn btn--sm tl__watch" to={`/watch/${e.anime.id}`}>
              <Play size={13} fill="currentColor" strokeWidth={0} aria-hidden="true" />
              Watch
              <span className="sr-only"> — {e.anime.title} episode airing {e.dayLabel}</span>
            </Link>
          </div>
        </li>
      ))}
    </ol>
  );
}
