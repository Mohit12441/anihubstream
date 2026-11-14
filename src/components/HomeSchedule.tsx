import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Calendar, CheckCircle2, Clock, Play } from 'lucide-react';
import { Art } from './Art';
import { cleanAnimeTitle, DAYS } from '../data/model';
import { formatScheduleEntry, getEpisodeReleaseStatus } from '../lib/scheduleTime';
import { useCatalogue } from '../state/catalogue';
import { soundFx } from '../lib/soundFx';
import '../styles/home-schedule.css';

export function HomeSchedule() {
  const { scheduleFor } = useCatalogue();
  const allEntries = useMemo(() => scheduleFor('All'), [scheduleFor]);

  const [now, setNow] = useState(() => new Date());
  const [audio, setAudio] = useState<'sub' | 'dub'>('sub');

  // Compute today's day (1 = Mon, ..., 7 = Sun) in viewer's local time
  const todayDay = useMemo(() => {
    const d = now.getDay();
    return d === 0 ? 7 : d;
  }, [now]);

  const [selectedDay, setSelectedDay] = useState<number>(todayDay);

  // Update clock every 15s to keep release countdowns fresh
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(timer);
  }, []);

  // Update selectedDay if todayDay shifts
  useEffect(() => {
    setSelectedDay(todayDay);
  }, [todayDay]);

  // Convert timezone to local time and filter by selected day and audio format
  const dayEntries = useMemo(() => {
    return allEntries
      .map((e) => formatScheduleEntry(e, true, audio))
      .filter((e) => e.day === selectedDay)
      .sort((a, b) => a.time.localeCompare(b.time));
  }, [allEntries, selectedDay, audio]);

  if (!allEntries.length) return null;

  return (
    <section className="home__row home-schedule" aria-labelledby="row-schedule">
      <div className="sec-head">
        <h2 id="row-schedule">
          <Calendar size={21} aria-hidden="true" style={{ color: 'var(--cyan, #24d3ee)' }} />
          Episode Airing Schedule
          <Link to="/schedule" className="sec-head__link" aria-label="Open full weekly calendar">
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </h2>
        <div className="home-schedule__header-tools">
          {/* Sub / Dub selector */}
          <div className="home-schedule__audio-switch" role="radiogroup" aria-label="Audio format">
            <button
              type="button"
              className={`home-schedule__audio-btn ${audio === 'sub' ? 'is-active' : ''}`}
              onClick={() => {
                soundFx.playClick();
                setAudio('sub');
              }}
              role="radio"
              aria-checked={audio === 'sub'}
            >
              SUB
            </button>
            <button
              type="button"
              className={`home-schedule__audio-btn ${audio === 'dub' ? 'is-active' : ''}`}
              onClick={() => {
                soundFx.playClick();
                setAudio('dub');
              }}
              role="radio"
              aria-checked={audio === 'dub'}
            >
              DUB
            </button>
          </div>
          <Link to="/schedule" className="sec-head__hint home-schedule__view-all">
            Full Weekly View →
          </Link>
        </div>
      </div>

      {/* Day Selector Pills */}
      <div className="home-schedule__days" role="tablist" aria-label="Schedule days of the week">
        {DAYS.map((label, idx) => {
          const dayNum = idx + 1;
          const isToday = dayNum === todayDay;
          const isSelected = dayNum === selectedDay;

          return (
            <button
              key={label}
              type="button"
              role="tab"
              aria-selected={isSelected}
              className={`home-schedule__day-pill ${isSelected ? 'is-selected' : ''} ${
                isToday ? 'is-today' : ''
              }`}
              onClick={() => {
                soundFx.playClick();
                setSelectedDay(dayNum);
              }}
            >
              <span className="home-schedule__day-name">{label}</span>
              {isToday && <span className="home-schedule__today-badge">TODAY</span>}
            </button>
          );
        })}
      </div>

      {/* Episode Cards Grid */}
      {dayEntries.length > 0 ? (
        <div className="home-schedule__grid">
          {dayEntries.map((entry) => {
            const anime = entry.anime;
            const cleanTitle = cleanAnimeTitle(anime.title);
            const targetTs = audio === 'dub' ? (entry.sched_dub_at ?? entry.dubAt) : (entry.sched_sub_at ?? entry.subAt);
            const status = getEpisodeReleaseStatus(entry.day, entry.time, todayDay, now, true, entry.date, targetTs);

            const nextEp = entry.episode && entry.episode > 0
              ? entry.episode
              : (anime.schedule?.episode && anime.schedule.episode > 0
                ? anime.schedule.episode
                : null);

            const isReleased = status.type === 'released';

            const targetEp = isReleased
              ? (nextEp ?? (anime.episodeCount && anime.episodeCount > 0 ? anime.episodeCount : 1))
              : (nextEp && nextEp > 1
                ? nextEp - 1
                : (anime.episodeCount && anime.episodeCount > 0 ? anime.episodeCount : 1));

            const hasDub = Boolean(entry.sched_dub_at || entry.dubAt || anime.sched_dub_at || anime.schedule?.dubAt);
            const toWatch = `/watch/${anime.id}/${targetEp}`;
            const watchTarget = audio === 'dub' && hasDub ? `${toWatch}?audio=dub` : toWatch;
            const destination = isReleased ? watchTarget : `/anime/${anime.id}`;
            const epDisplay = isReleased ? targetEp : (nextEp ?? targetEp);

            return (
              <article key={anime.id} className="home-sched-card">
                <Link
                  to={destination}
                  className="home-sched-card__media-wrap"
                >
                  <Art
                    sources={[anime.poster, anime.key]}
                    alt={`${cleanTitle} poster`}
                    width={90}
                    height={125}
                    imgClass="home-sched-card__art"
                  />
                  <div className="home-sched-card__play" aria-hidden="true">
                    <Play size={16} fill="currentColor" strokeWidth={0} />
                  </div>
                </Link>

                <div className="home-sched-card__info">
                  <div className="home-sched-card__meta-top">
                    <span className="home-sched-card__time">
                      <Clock size={12} aria-hidden="true" />
                      {entry.time}
                    </span>
                    <span className="home-sched-card__ep">EP {epDisplay}</span>
                    <span className="home-sched-card__format">{anime.kind || 'TV'}</span>
                    {audio === 'dub' && !hasDub && (
                      <span className="home-sched-card__format" style={{ opacity: 0.75, color: '#f59e0b' }}>
                        SUB ONLY
                      </span>
                    )}
                  </div>

                  <h3 className="home-sched-card__title">
                    <Link to={destination}>
                      {cleanTitle}
                    </Link>
                  </h3>

                  <div className="home-sched-card__footer">
                    {isReleased ? (
                      <span className="home-sched-card__status home-sched-card__status--released">
                        <CheckCircle2 size={12} aria-hidden="true" />
                        {selectedDay === todayDay ? 'Aired Today' : 'Released'}
                      </span>
                    ) : (
                      <span className="home-sched-card__status home-sched-card__status--countdown">
                        {status.countdown ? `Airing in ${status.countdown}` : (selectedDay === todayDay ? 'Coming Today' : 'Upcoming')}
                      </span>
                    )}

                    <Link
                      to={destination}
                      className="home-sched-card__btn"
                    >
                      {isReleased ? 'Watch' : 'Details'}
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="home-schedule__empty">
          <p>No broadcast episodes scheduled for {DAYS[selectedDay - 1]}.</p>
          <Link to="/schedule" className="btn btn--sm btn--ghost">
            Check Weekly Calendar
          </Link>
        </div>
      )}
    </section>
  );
}
