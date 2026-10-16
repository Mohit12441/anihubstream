import { useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  Clock,
  Eye,
  ListVideo,
  PanelRightClose,
  PanelRightOpen,
  Search,
  SkipBack,
  SkipForward,
  Theater,
} from 'lucide-react';
import { toSeconds } from '../data/model';
import type { Anime, Episode } from '../data/model';
import { positionKey, type PositionMap } from '../lib/playerPrefs';
import { stamp } from '../lib/time';
import { prefetchEpisode } from '../lib/streamBridge';
import { warmStreamOrigins } from '../lib/warmConnections';
import { Art } from './Art';

type Filter = 'all' | 'todo' | 'done';

interface Props {
  anime: Anime;
  current: number;
  onSelect: (n: number) => void;
  autoNext: boolean;
  onAutoNext: (v: boolean) => void;
  positions: PositionMap;
  theatre: boolean;
  onTheatre: (v: boolean) => void;
}

const state = (ep: Episode, anime: Anime, positions: PositionMap) => {
  const p = positions[positionKey(anime.id, ep.n)];
  if (!p || (!p.finished && p.t <= 1)) return { status: 'new' as const, ratio: 0 };
  const d = toSeconds(ep.runtime);
  if (p.finished || (d > 0 && p.t / d >= 0.93)) return { status: 'watched' as const, ratio: 1 };
  return { status: 'progress' as const, ratio: d > 0 ? Math.min(1, p.t / d) : 0 };
};

export function EpisodeSidebar({ anime, current, onSelect, autoNext, onAutoNext, positions, theatre, onTheatre }: Props) {
  const [term, setTerm] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState(true);
  const [season, setSeason] = useState(anime.season);

  const seasons = [anime.season, ...(anime.altSeasons ?? [])];
  const total = anime.episodes.length;
  const next = anime.episodes[current] ?? null;

  const list = useMemo(() => {
    const needle = term.trim().toLowerCase();
    return anime.episodes.filter((ep) => {
      const s = state(ep, anime, positions);
      if (filter === 'todo' && s.status === 'watched') return false;
      if (filter === 'done' && s.status !== 'watched') return false;
      if (!needle) return true;
      return (
        String(ep.n) === needle ||
        `ep ${ep.n}`.includes(needle) ||
        `episode ${ep.n}`.includes(needle) ||
        ep.title.toLowerCase().includes(needle)
      );
    });
  }, [anime, positions, term, filter]);

  const watched = anime.episodes.filter((ep) => state(ep, anime, positions).status === 'watched').length;

  return (
    <aside className={`eps${theatre ? ' is-theatre' : ''}`} aria-label="Episodes">
      <div className="eps__head">
        <div>
          <h2>
            <ListVideo size={16} aria-hidden="true" /> Episodes
          </h2>
          <p className="eps__sub">
            {anime.season} ·{' '}
            {anime.episodeTotal && anime.episodeTotal > total
              ? `${total} of ${anime.episodeTotal} episodes`
              : `${total} episodes`}{' '}
            · {watched} watched
          </p>
        </div>
        <button
          type="button"
          className="eps__fold"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? 'Collapse episode list' : 'Expand episode list'}
        >
          {open ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
        </button>
      </div>

      {seasons.length > 1 && (
        <label className="eps__season">
          <span>Season</span>
          <select value={season} onChange={(e) => setSeason(e.target.value)}>
            {seasons.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {season !== anime.season && (
            <p className="eps__warn" role="status">
              {season} has no episode list on this site — the list below is still {anime.season}.
            </p>
          )}
        </label>
      )}

      {open && (
        <>
          <div className="eps__tools">
            <span className="eps__search">
              <Search size={14} aria-hidden="true" />
              <input
                type="search"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder={`Search ${total} episodes`}
                aria-label="Search episodes by number or title"
              />
            </span>
            <div className="eps__filters" role="group" aria-label="Filter episodes">
              {(
                [
                  { id: 'all', label: 'All' },
                  { id: 'todo', label: 'Unwatched' },
                  { id: 'done', label: 'Watched' },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={`eps__chip${filter === f.id ? ' is-on' : ''}`}
                  aria-pressed={filter === f.id}
                  onClick={() => setFilter(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {next && (
            <button
              type="button"
              className="eps__next"
              onClick={() => onSelect(next.n)}
              onMouseEnter={() => {
                warmStreamOrigins();
                prefetchEpisode(anime.title, next.n, 'sub');
              }}
            >
              <Art sources={[next.thumb, anime.key, anime.poster]} alt="" iconSize={16} />
              <span>
                <b>Next up · Episode {next.n}</b>
                <span>{next.title}</span>
                <small>
                  {next.runtime && next.runtime !== '—' && (
                    <>
                      <Clock size={11} aria-hidden="true" /> {next.runtime}
                    </>
                  )}
                  {positions[positionKey(anime.id, next.n)] ? ' · started' : ''}
                </small>
              </span>
            </button>
          )}

          <ul className="eps__list no-bar">
            {list.map((ep) => {
              const isCurrent = ep.n === current;
              const s = state(ep, anime, positions);
              const op = ep.markers.find((m) => m.kind === 'intro');
              const ed = ep.markers.find((m) => m.kind === 'outro');
              return (
                <li key={ep.n}>
                  <button
                    type="button"
                    className={`eps__item${isCurrent ? ' is-current' : ''}`}
                    onClick={() => onSelect(ep.n)}
                    onMouseEnter={() => {
                      warmStreamOrigins();
                      prefetchEpisode(anime.title, ep.n, 'sub');
                    }}
                    aria-current={isCurrent ? 'true' : undefined}
                  >
                    <span className="eps__thumb">
                      <Art sources={[ep.thumb, anime.key, anime.poster]} alt="" fill />
                      {isCurrent && <span className="eps__now" aria-hidden="true" />}
                      {s.ratio > 0 && (
                        <span className="eps__prog" style={{ width: `${s.ratio * 100}%` }} aria-hidden="true" />
                      )}
                    </span>
                    <span className="eps__body">
                      <b>
                        Episode {ep.n}
                        {s.status === 'watched' && (
                          <em className="eps__seen">
                            <Check size={11} aria-hidden="true" /> Watched
                          </em>
                        )}
                        {s.status === 'progress' && (
                          <em className="eps__seen eps__seen--part">
                            {Math.round(s.ratio * 100)}% · {stamp(s.ratio * toSeconds(ep.runtime))}
                          </em>
                        )}
                      </b>
                      <span className="eps__title">{ep.title}</span>
                      <span className="eps__run">
                        {ep.runtime && ep.runtime !== '—' && (
                          <>
                            <Clock size={11} aria-hidden="true" />
                            {ep.runtime}
                          </>
                        )}
                        {op && <i className="eps__mk eps__mk--op">OP {stamp(op.start)}</i>}
                        {ed && <i className="eps__mk eps__mk--ed">ED {stamp(ed.start)}</i>}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
            {!list.length && (
              <li className="eps__empty">
                No episode matches “{term.trim()}”{filter !== 'all' ? ` in ${filter === 'done' ? 'watched' : 'unwatched'}` : ''}.
              </li>
            )}
          </ul>

          <div className="eps__foot">
            <div className="eps__step">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => onSelect(Math.max(1, current - 1))}
                disabled={current <= 1}
              >
                <SkipBack size={14} aria-hidden="true" /> Previous
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => onSelect(Math.min(total, current + 1))}
                disabled={current >= total}
              >
                Next <SkipForward size={14} aria-hidden="true" />
              </button>
              <button
                type="button"
                className={`btn btn--ghost btn--sm${theatre ? ' is-on' : ''}`}
                aria-pressed={theatre}
                onClick={() => onTheatre(!theatre)}
              >
                <Theater size={14} aria-hidden="true" /> Theatre
              </button>
            </div>

            <label className="switch">
              <span>Auto play next</span>
              <input
                type="checkbox"
                checked={autoNext}
                onChange={(e) => onAutoNext(e.target.checked)}
                aria-label="Automatically play the next episode"
              />
              <i aria-hidden="true" />
            </label>
            <p className="eps__note">
              {anime.episodeTotal && anime.episodeTotal > total
                ? `Titles this long are listed here from episode 1 up to ${total}; the source lists ${anime.episodeTotal} in all. `
                : 'Episode titles, air dates and run times are read from this site’s own catalogue database. '}
              Your position in each one is kept in this browser and mirrored to your anonymous viewer record on the
              server.
            </p>
          </div>
        </>
      )}

      {!open && (
        <button type="button" className="eps__unfold" onClick={() => setOpen(true)}>
          <ChevronDown size={15} aria-hidden="true" />
          Show episode list
          <Eye size={14} aria-hidden="true" className="eps__unfold-i" />
        </button>
      )}
    </aside>
  );
}
