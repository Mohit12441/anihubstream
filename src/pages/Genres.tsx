import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowDownUp, Sparkles, X } from 'lucide-react';
import { AnimeCard } from '../components/AnimeCard';
import { GenreGrid } from '../components/GenreGrid';
import { CatalogueError, CatalogueLoading } from '../components/CatalogueState';
import { Embers } from '../components/Embers';
import { listCatalogue } from '../data/api';
import { artUrl, hydrateCard, type Anime, type AnimeKind } from '../data/model';
import { useCatalogue } from '../state/catalogue';
import '../styles/pages.css';

const KINDS: (AnimeKind | 'All')[] = ['All', 'TV', 'Movie', 'OVA', 'ONA', 'Special'];
const SORTS = [
  { id: 'popularity', label: 'Popularity' },
  { id: 'year', label: 'Year' },
  { id: 'status', label: 'Status' },
  { id: 'rating', label: 'Rating' },
] as const;

type SortId = (typeof SORTS)[number]['id'];

/* Counts and results both come from the database — the browser never holds the
   whole catalogue, so "N titles" has to be answered where the rows live. */
const SERVER_SORT: Record<SortId, string> = {
  popularity: 'rank',
  year: 'year',
  status: 'status',
  rating: 'rating',
};
const PAGE_SIZE = 24;

export function Genres() {
  const { status, error, reload, GENRES, genreLabel, stats } = useCatalogue();
  const [params, setParams] = useSearchParams();
  const genre = params.get('genre');
  const [kind, setKind] = useState<AnimeKind | 'All'>('All');
  const [sort, setSort] = useState<SortId>('popularity');

  const pick = (id: string) => {
    if (genre === id) setParams(new URLSearchParams());
    else setParams({ genre: id });
  };

  const counts = stats?.genres ?? {};

  const query = useMemo(
    () => ({
      genre: genre ?? undefined,
      kind: kind !== 'All' ? kind : undefined,
      sort: SERVER_SORT[sort],
      limit: PAGE_SIZE,
    }),
    [genre, kind, sort],
  );

  const [rows, setRows] = useState<Anime[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [busy, setBusy] = useState<'load' | 'more' | null>('load');
  const [fetchError, setFetchError] = useState<string | null>(null);
  const pageNo = useRef(1);

  useEffect(() => {
    let live = true;
    setBusy('load');
    setFetchError(null);
    pageNo.current = 1;
    listCatalogue({ ...query, page: 1 })
      .then((r) => {
        if (!live) return;
        setRows(r.results.map(hydrateCard));
        setTotal(r.total);
        setBusy(null);
      })
      .catch((err: Error) => {
        if (!live) return;
        setFetchError(err.message);
        setBusy(null);
      });
    return () => {
      live = false;
    };
  }, [query]);

  const loadMore = () => {
    if (busy) return;
    const next = pageNo.current + 1;
    setBusy('more');
    setFetchError(null);
    listCatalogue({ ...query, page: next })
      .then((r) => {
        pageNo.current = next;
        setRows((prev) => [...prev, ...r.results.map(hydrateCard)]);
        setTotal(r.total);
        setBusy(null);
      })
      .catch((err: Error) => {
        setFetchError(err.message);
        setBusy(null);
      });
  };

  const active = genre ? genreLabel(genre) : undefined;

  return (
    <div className="page genres">
      <header className="banner banner--purple">
        <img className="banner__img" src={artUrl('/art/genres-purple.jpg')} alt="" aria-hidden="true" decoding="async" />
        <div className="banner__veil" />
        <Embers count={16} tone="violet" />
        <div className="banner__inner shell">
          <div>
            <p className="banner__kicker">Browse the library</p>
            <h1 className="banner__title">
              <span className="banner__title-a">Explore</span>
              <span className="banner__title-b">Genres</span>
            </h1>
            <p className="banner__sub">Find your next favorite anime</p>
            <p className="banner__lede">
              Twelve shelves, one catalogue. Pick a genre to filter the grid below — every count comes from the
              titles this site's database returns.
            </p>
          </div>
        </div>
      </header>

      {status !== 'ready' && (
        <div className="shell genres__body">
          {status === 'error' ? (
            <CatalogueError error={error} onRetry={reload} />
          ) : (
            <CatalogueLoading grid rows={8} />
          )}
        </div>
      )}

      {status === 'ready' && (
      <div className="shell genres__body">
        <GenreGrid genres={GENRES} active={genre} counts={counts} onSelect={pick} />

        <section className="genres__results" aria-labelledby="genres-results" aria-busy={busy === 'load'}>
          <div className="filters">
            <div className="filters__group" role="group" aria-label="Filter by format">
              {KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`pill${kind === k ? ' is-active' : ''}`}
                  onClick={() => setKind(k)}
                  aria-pressed={kind === k}
                >
                  {k}
                </button>
              ))}
            </div>

            <div className="filters__group filters__group--right">
              <label className="select">
                <ArrowDownUp size={14} aria-hidden="true" />
                <span className="sr-only">Sort anime</span>
                <select value={sort} onChange={(e) => setSort(e.target.value as SortId)}>
                  {SORTS.map((s) => (
                    <option key={s.id} value={s.id}>
                      Sort: {s.label}
                    </option>
                  ))}
                </select>
              </label>
              {genre && (
                <button type="button" className="pill" style={{ '--pc': '#a24bff' } as React.CSSProperties} onClick={() => setParams(new URLSearchParams())}>
                  <X size={13} aria-hidden="true" /> {active}
                </button>
              )}
            </div>
          </div>

          <div className="sec-head">
            <h2 id="genres-results">
              <Sparkles size={19} aria-hidden="true" />
              {active ? `${active} anime` : 'All anime'}
            </h2>
            <p className="sec-head__hint">
              {total === null ? '—' : total} {total === 1 ? 'result' : 'results'}
              {kind !== 'All' ? ` · ${kind} only` : ''}
            </p>
          </div>

          {busy === 'load' && rows.length === 0 ? (
            <CatalogueLoading grid rows={6} />
          ) : fetchError && rows.length === 0 ? (
            <CatalogueError error={fetchError} onRetry={() => setParams(new URLSearchParams(params))} />
          ) : rows.length ? (
            <>
              <ul className="pgrid">
                {rows.map((a) => (
                  <li key={a.id}>
                    <AnimeCard
                      anime={a}
                      variant="poster"
                      badge={a.status === 'Ongoing' ? 'ONGOING' : a.status === 'Upcoming' ? 'UPCOMING' : undefined}
                      episode={`${a.kind} · ${a.year}`}
                    />
                  </li>
                ))}
              </ul>
              <div className="catalogue__more">
                {busy === 'more' ? (
                  <span className="btn btn--ghost" role="status">
                    Loading more…
                  </span>
                ) : fetchError ? (
                  <>
                    <span className="catalogue__more-err" role="alert">
                      {fetchError}
                    </span>
                    <button type="button" className="btn btn--sm btn--ghost" onClick={loadMore}>
                      Try again
                    </button>
                  </>
                ) : total !== null && rows.length < total ? (
                  <button type="button" className="btn btn--ghost" onClick={loadMore}>
                    Load more — {rows.length} of {total}
                  </button>
                ) : (
                  <span className="catalogue__more-end" role="status">
                    All {rows.length} shown.
                  </span>
                )}
              </div>
            </>
          ) : (
            <div className="empty" role="status">
              <p>
                <b>No titles in the catalogue match this combination.</b>
                Try a different format, or clear the genre filter.
              </p>
              <button
                type="button"
                className="btn btn--sm btn--ghost"
                onClick={() => {
                  setKind('All');
                  setParams(new URLSearchParams());
                }}
              >
                Reset filters
              </button>
            </div>
          )}
        </section>
      </div>
      )}
    </div>
  );
}
