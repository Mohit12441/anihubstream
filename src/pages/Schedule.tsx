import { useMemo, useState } from 'react';
import { CalendarDays, Info } from 'lucide-react';
import { CatalogueError, CatalogueLoading } from '../components/CatalogueState';
import { Embers } from '../components/Embers';
import { ScheduleList } from '../components/ScheduleList';
import { artUrl, currentSeasonKey } from '../data/model';
import type { SeasonKey } from '../data/model';
import { useCatalogue } from '../state/catalogue';
import '../styles/pages.css';

export function Schedule() {
  const { status, error, reload, DAYS, SEASONS, scheduleFor } = useCatalogue();
  /* Nothing is hard-coded to a season: the database decides which ones exist, and the page
     opens on the quarter that is running now — the newest season may belong to a title
     whose next slot is months out, and it should not be the default view. */
  const [season, setSeason] = useState<SeasonKey | 'All' | null>(null);
  const [year, setYear] = useState('All years');
  const [day, setDay] = useState<number | null>(null);

  const current = currentSeasonKey();
  const activeSeason = season ?? (SEASONS.includes(current) ? current : SEASONS[0] ?? 'All');
  const all = useMemo(() => scheduleFor(activeSeason), [activeSeason, scheduleFor]);

  /* Both lists come from the rows the database actually has, so a season that no longer
     exists — or a year picked under one season and now absent from the next — falls back
     to "all" instead of showing an empty page. */
  const years = useMemo(
    () => ['All years', ...new Set(all.map((e) => String(e.anime.year)).sort((a, b) => Number(b) - Number(a)))],
    [all],
  );
  const activeYear = years.includes(year) ? year : 'All years';

  const entries = useMemo(
    () =>
      all
        .filter((e) => (day === null ? true : e.day === day))
        .filter((e) => (activeYear === 'All years' ? true : String(e.anime.year) === activeYear)),
    [all, day, activeYear],
  );

  /* Today's slot, by the same clock the schedule is published in (UTC). */
  const now = new Date();
  const utcToday = now.getUTCDay() === 0 ? 7 : now.getUTCDay();
  const airingToday = entries.find((e) => e.day === utcToday)?.anime?.id ?? null;

  return (
    <div className="page schedule">
      <header className="banner banner--blue">
        <img className="banner__img" src={artUrl('/art/schedule-blue.jpg')} alt="" aria-hidden="true" decoding="async" />
        <div className="banner__veil" />
        <Embers count={12} tone="cyan" />
        <div className="banner__inner shell">
          <div>
            <p className="banner__kicker">Weekly line-up</p>
            <h1 className="banner__title">
              <span className="banner__title-a">Ongoing</span>
              <span className="banner__title-b">This Season</span>
            </h1>
            <p className="banner__sub">Never miss a new episode</p>
          </div>
          <p className="banner__aside">
            New episodes
            <b>every week</b>
          </p>
        </div>
      </header>

      <div className="shell schedule__body">
        <div className="filters filters--wrap">
          <div className="filters__group" role="group" aria-label="Filter by season">
            {(['All', ...SEASONS] as (SeasonKey | 'All')[]).map((s) => (
              <button
                key={s}
                type="button"
                className={`pill${activeSeason === s ? ' is-active' : ''}`}
                onClick={() => setSeason(s)}
                aria-pressed={activeSeason === s}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="filters__group filters__group--right">
            <label className="select">
              <CalendarDays size={14} aria-hidden="true" />
              <span className="sr-only">Filter by year</span>
              <select value={activeYear} onChange={(e) => setYear(e.target.value)}>
                {years.map((y) => (
                  <option key={y}>{y}</option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="days" role="tablist" aria-label="Day of week">
          <button
            type="button"
            role="tab"
            aria-selected={day === null}
            className={`day${day === null ? ' is-on' : ''}`}
            onClick={() => setDay(null)}
          >
            <b>ALL</b>
            <span>{all.length} slots</span>
          </button>
          {DAYS.map((d, i) => {
            const n = all.filter((e) => e.day === i + 1).length;
            return (
              <button
                key={d}
                type="button"
                role="tab"
                aria-selected={day === i + 1}
                className={`day${day === i + 1 ? ' is-on' : ''}`}
                onClick={() => setDay(day === i + 1 ? null : i + 1)}
              >
                <b>{d}</b>
                <span>{n ? `${n} airing` : '—'}</span>
              </button>
            );
          })}
        </div>

        <div className="sec-head">
          <h2 id="schedule-list">
            {day === null ? 'Full week' : DAYS[day - 1]}
            <span className="sec-head__count">{entries.length}</span>
          </h2>
          <p className="sec-head__hint">Times shown in UTC</p>
        </div>

      {status === 'error' && <CatalogueError error={error} onRetry={reload} />}
      {status === 'loading' && <CatalogueLoading grid={false} rows={6} />}
      {status === 'ready' && (
        <div>
          <ScheduleList entries={entries} highlightId={airingToday} />
        </div>
      )}

        <p className="note">
          <Info size={14} aria-hidden="true" />
          Air times are the next broadcast slot each title's AniList record publishes, shown in UTC. A title only
          appears here while it has a slot; the slots are re-read from AniList about once an hour into this site's
          own database, so they can be up to an hour old — and nothing is fetched from anywhere while you browse.
        </p>
      </div>
    </div>
  );
}
