import { useMemo, useState } from 'react';
import { CalendarDays, Clock, Globe, Info } from 'lucide-react';
import { CatalogueError, CatalogueLoading } from '../components/CatalogueState';
import { Embers } from '../components/Embers';
import { ScheduleList } from '../components/ScheduleList';
import { artUrl, currentSeasonKey } from '../data/model';
import type { SeasonKey } from '../data/model';
import { convertSlotTimezone, getUserTimezoneLabel } from '../lib/scheduleTime';
import { useSEO } from '../lib/useSEO';
import { useCatalogue } from '../state/catalogue';
import '../styles/pages.css';

export function Schedule() {
  const { status, error, reload, DAYS, SEASONS, scheduleFor } = useCatalogue();
  const [season, setSeason] = useState<SeasonKey | 'All' | null>(null);
  const [year, setYear] = useState('All years');
  const [day, setDay] = useState<number | null>(null);
  const [useLocalTime, setUseLocalTime] = useState(true);

  useSEO({
    title: 'Anime Broadcast Schedule — Airing This Week | AniHubStream',
    description: 'Live weekly anime release schedule. Check episode air dates, broadcast times, and currently airing seasons.',
    canonicalUrl: 'https://anihubstream.com/schedule',
  });

  const tzLabel = useMemo(() => getUserTimezoneLabel(), []);
  const current = currentSeasonKey();
  const activeSeason = season ?? (SEASONS.includes(current) ? current : SEASONS[0] ?? 'All');
  const all = useMemo(() => scheduleFor(activeSeason), [activeSeason, scheduleFor]);
  const allScheduleEntries = useMemo(() => scheduleFor('All'), [scheduleFor]);

  // Fix year filter: list all unique years present across all schedule entries
  const years = useMemo(() => {
    const set = new Set<string>();
    for (const e of allScheduleEntries) {
      if (e.anime.year && Number.isFinite(e.anime.year) && e.anime.year > 1900) {
        set.add(String(e.anime.year));
      }
    }
    for (const e of all) {
      if (e.anime.year && Number.isFinite(e.anime.year) && e.anime.year > 1900) {
        set.add(String(e.anime.year));
      }
    }
    const sorted = [...set].sort((a, b) => Number(b) - Number(a));
    return ['All years', ...sorted];
  }, [allScheduleEntries, all]);

  const activeYear = years.includes(year) ? year : 'All years';

  // Convert slots to viewer's local timezone (or keep UTC when toggled)
  const convertedAll = useMemo(
    () =>
      all.map((e) => {
        const converted = convertSlotTimezone(e, useLocalTime);
        return {
          ...e,
          day: converted.day,
          dayLabel: converted.dayLabel,
          time: converted.time,
          date: converted.date,
        };
      }),
    [all, useLocalTime],
  );

  const entries = useMemo(() => {
    let list = convertedAll;
    if (activeYear !== 'All years' && !list.some((e) => String(e.anime.year) === activeYear)) {
      list = allScheduleEntries.map((e) => {
        const converted = convertSlotTimezone(e, useLocalTime);
        return {
          ...e,
          day: converted.day,
          dayLabel: converted.dayLabel,
          time: converted.time,
          date: converted.date,
        };
      });
    }
    return list
      .filter((e) => (day === null ? true : e.day === day))
      .filter((e) => (activeYear === 'All years' ? true : String(e.anime.year) === activeYear))
      .sort((a, b) => a.day - b.day || a.time.localeCompare(b.time));
  }, [convertedAll, allScheduleEntries, day, activeYear, useLocalTime]);

  const now = new Date();
  const todayDay = useLocalTime
    ? (now.getDay() === 0 ? 7 : now.getDay())
    : (now.getUTCDay() === 0 ? 7 : now.getUTCDay());
  const airingToday = entries.find((e) => e.day === todayDay)?.anime?.id ?? null;

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
            <button
              type="button"
              className={`pill pill--sm${useLocalTime ? ' is-active' : ''}`}
              onClick={() => setUseLocalTime(!useLocalTime)}
              title={useLocalTime ? 'Click to show times in UTC' : `Click to show times in your local timezone (${tzLabel})`}
              aria-pressed={useLocalTime}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
            >
              {useLocalTime ? <Clock size={13} aria-hidden="true" /> : <Globe size={13} aria-hidden="true" />}
              {useLocalTime ? 'Local Time' : 'UTC'}
            </button>
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
            <span>{convertedAll.length} slots</span>
          </button>
          {DAYS.map((d, i) => {
            const isToday = i + 1 === todayDay;
            const n = convertedAll.filter((e) => e.day === i + 1).length;
            return (
              <button
                key={d}
                type="button"
                role="tab"
                aria-selected={day === i + 1}
                className={`day${day === i + 1 ? ' is-on' : ''}${isToday ? ' is-today' : ''}`}
                onClick={() => setDay(day === i + 1 ? null : i + 1)}
                title={isToday ? `${d} (Today)` : d}
              >
                <b>
                  {d}
                  {isToday && <span className="day__today-pill">Today</span>}
                </b>
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
          <p className="sec-head__hint">
            {useLocalTime ? `Times shown in ${tzLabel}` : 'Times shown in UTC'}
          </p>
        </div>

        {status === 'error' && <CatalogueError error={error} onRetry={reload} />}
        {status === 'loading' && <CatalogueLoading grid={false} rows={6} />}
        {status === 'ready' && (
          <div>
            <ScheduleList entries={entries} todayDay={todayDay} highlightId={airingToday} />
          </div>
        )}

        <p className="note">
          <Info size={14} aria-hidden="true" />
          Air times are automatically converted to your local timezone ({tzLabel}) with UTC toggle available.
          Titles appear according to their weekly broadcast slots in the active season.
        </p>
      </div>
    </div>
  );
}
