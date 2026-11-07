import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  Clock,
  Eye,
  LayoutGrid,
  List,
  ListVideo,
  PanelRightClose,
  PanelRightOpen,
  Search,
  SkipBack,
  SkipForward,
  Theater,
  X,
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
  onSelectSeason?: (seasonId: string) => void;
  autoNext: boolean;
  onAutoNext: (v: boolean) => void;
  positions: PositionMap;
  theatre: boolean;
  onTheatre: (v: boolean) => void;
  isDrawer?: boolean;
  onCloseDrawer?: () => void;
}

const state = (ep: Episode, anime: Anime, positions: PositionMap) => {
  const p = positions[positionKey(anime.id, ep.n)];
  if (!p || (!p.finished && p.t <= 1)) return { status: 'new' as const, ratio: 0 };
  const d = toSeconds(ep.runtime);
  if (p.finished || (d > 0 && p.t / d >= 0.93)) return { status: 'watched' as const, ratio: 1 };
  return { status: 'progress' as const, ratio: d > 0 ? Math.min(1, p.t / d) : 0 };
};

const BATCH_SIZE = 50;

export function EpisodeSidebar({
  anime,
  current,
  onSelect,
  onSelectSeason,
  autoNext,
  onAutoNext,
  positions,
  theatre,
  onTheatre,
  isDrawer,
  onCloseDrawer,
}: Props) {
  const [term, setTerm] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState(true);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');

  const seasonsList = useMemo(() => {
    if (anime.seasons && anime.seasons.length > 0) return anime.seasons;
    return [{ id: anime.id, title: anime.title, season: anime.season, year: anime.year }];
  }, [anime]);
  const total = anime.episodes.length;
  const next = anime.episodes[current] ?? null;

  const hasBatches = total > BATCH_SIZE;
  const [selectedBatch, setSelectedBatch] = useState(() => Math.floor(Math.max(0, current - 1) / BATCH_SIZE));

  useEffect(() => {
    if (hasBatches) {
      const currentBatch = Math.floor(Math.max(0, current - 1) / BATCH_SIZE);
      setSelectedBatch(currentBatch);
    }
  }, [current, hasBatches]);

  const list = useMemo(() => {
    const needle = term.trim().toLowerCase();
    const sourceEpisodes = (!needle && hasBatches)
      ? anime.episodes.slice(selectedBatch * BATCH_SIZE, (selectedBatch + 1) * BATCH_SIZE)
      : anime.episodes;

    return sourceEpisodes.filter((ep) => {
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
  }, [anime, positions, term, filter, hasBatches, selectedBatch]);

  const watched = anime.episodes.filter((ep) => state(ep, anime, positions).status === 'watched').length;

  const handleSelectEp = (n: number) => {
    onSelect(n);
    if (isDrawer && onCloseDrawer) {
      onCloseDrawer();
    }
  };

  const asideContent = (
    <aside className={`eps${theatre ? ' is-theatre' : ''}${isDrawer ? ' eps--drawer' : ''}`} aria-label="Episodes">
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
        <div className="eps__head-actions">
          <button
            type="button"
            className="eps__view-btn"
            onClick={() => setViewMode((m) => (m === 'list' ? 'grid' : 'list'))}
            title={viewMode === 'list' ? 'Grid view' : 'List view'}
            aria-label={viewMode === 'list' ? 'Switch to grid view' : 'Switch to list view'}
          >
            {viewMode === 'list' ? <LayoutGrid size={15} /> : <List size={15} />}
          </button>
          {!isDrawer && (
            <button
              type="button"
              className="eps__fold"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-label={open ? 'Collapse episode list' : 'Expand episode list'}
            >
              {open ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
            </button>
          )}
          {isDrawer && onCloseDrawer && (
            <button
              type="button"
              className="eps__fold eps__close"
              onClick={onCloseDrawer}
              aria-label="Close episodes drawer"
              title="Close (Esc)"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      <label className="eps__season">
        <span>SEASON / PART</span>
        <div className="eps__season-wrap">
          <select
            value={anime.id}
            onChange={(e) => {
              const targetId = e.target.value;
              if (targetId && targetId !== anime.id && onSelectSeason) {
                onSelectSeason(targetId);
              }
            }}
          >
            {seasonsList.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}{s.season ? ` (${s.season})` : s.year ? ` (${s.year})` : ''}
              </option>
            ))}
          </select>
          <ChevronDown size={14} className="eps__season-arrow" aria-hidden="true" />
        </div>
      </label>

      {hasBatches && !term && (
        <label className="eps__season" style={{ borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
          <span>Episode Range</span>
          <select
            value={selectedBatch}
            onChange={(e) => setSelectedBatch(Number(e.target.value))}
            aria-label="Select episode range"
          >
            {Array.from({ length: Math.ceil(total / BATCH_SIZE) }, (_, i) => {
              const start = i * BATCH_SIZE + 1;
              const end = Math.min((i + 1) * BATCH_SIZE, total);
              return (
                <option key={i} value={i}>
                  Episodes {start} - {end}
                </option>
              );
            })}
          </select>
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
              onClick={() => handleSelectEp(next.n)}
              onMouseEnter={() => {
                warmStreamOrigins();
                prefetchEpisode(anime.title, next.n, 'sub');
              }}
            >
              <div className="eps__next-thumb">
                <Art sources={[next.thumb, anime.key, anime.poster]} alt="" iconSize={16} />
              </div>
              <div className="eps__next-info">
                <span className="eps__next-kicker">NEXT UP · EPISODE {next.n}</span>
                <b className="eps__next-title">{next.title}</b>
                <span className="eps__next-dur">
                  <Clock size={11} aria-hidden="true" /> {next.runtime && next.runtime !== '—' ? next.runtime : '23:00'}
                  {positions[positionKey(anime.id, next.n)] ? ' · started' : ''}
                </span>
              </div>
            </button>
          )}

          <ul className={`eps__list no-bar${viewMode === 'grid' ? ' eps__list--grid' : ''}`}>
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
                    onClick={() => handleSelectEp(ep.n)}
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
                      <b className="eps__ep-title-row">
                        <span>Episode {ep.n}</span>
                        {s.status === 'watched' && (
                          <em className="eps__seen">
                            <Check size={11} aria-hidden="true" /> Watched
                          </em>
                        )}
                        {s.status === 'progress' && (
                          <em className="eps__seen eps__seen--part">
                            {Math.round(s.ratio * 100)}%
                          </em>
                        )}
                      </b>
                      {ep.title && ep.title.trim().toLowerCase() !== `episode ${ep.n}` ? (
                        <span className="eps__title">{ep.title}</span>
                      ) : null}
                      <span className="eps__run">
                        <span className="eps__time-val">
                          <Clock size={11} aria-hidden="true" />
                          {ep.runtime && ep.runtime !== '—' ? ep.runtime : '23:00'}
                        </span>
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
                onClick={() => handleSelectEp(Math.max(1, current - 1))}
                disabled={current <= 1}
              >
                <SkipBack size={14} aria-hidden="true" /> Previous
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => handleSelectEp(Math.min(total, current + 1))}
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
                ? `Episodes 1 to ${total} are listed below out of ${anime.episodeTotal} total episodes. `
                : 'Browse episodes, release dates, and runtimes. '}
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

  if (isDrawer) {
    return (
      <div className="eps-drawer">
        <div className="eps-drawer__backdrop" onClick={onCloseDrawer} aria-hidden="true" />
        <div className="eps-drawer__sheet" role="dialog" aria-modal="true" aria-label="Episodes Drawer">
          <div className="eps-drawer__handle-bar" onClick={onCloseDrawer}>
            <div className="eps-drawer__handle" />
          </div>
          {asideContent}
        </div>
      </div>
    );
  }

  return asideContent;
}
