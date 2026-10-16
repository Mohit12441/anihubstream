import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowDownUp, LayoutGrid, List, Search, SlidersHorizontal, X } from 'lucide-react';
import { AnimeCard } from '../components/AnimeCard';
import { CatalogueError, CatalogueLoading } from '../components/CatalogueState';
import { GenreChips } from '../components/GenreChips';
import { listCatalogue } from '../data/api';
import { hydrateCard, type Anime, type AnimeKind, type AnimeStatus } from '../data/model';
import { useCatalogue } from '../state/catalogue';
import '../styles/pages.css';

const KINDS: (AnimeKind | 'All')[] = ['All', 'TV', 'Movie', 'OVA', 'ONA', 'Special'];
const STATUSES: (AnimeStatus | 'All')[] = ['All', 'Ongoing', 'Finished', 'Upcoming'];
const SORTS = [
  { id: 'relevance', label: 'Best match' },
  { id: 'popularity', label: 'Popularity' },
  { id: 'rating', label: 'Rating' },
  { id: 'year', label: 'Year' },
  { id: 'added', label: 'Recently added' },
  { id: 'az', label: 'A → Z' },
] as const;
type SortId = (typeof SORTS)[number]['id'];

/* The catalogue lives in the database now — this page asks for one ranked
   window per request and appends the next on "Load more". */
const SERVER_SORT: Record<SortId, string> = {
  relevance: 'relevance',
  popularity: 'rank',
  rating: 'rating',
  year: 'year',
  added: 'added',
  az: 'title',
};
const PAGE_SIZE = 48;

export function AnimeCatalogue() {
  const { status: bootStatus, error: bootError, reload, GENRES, genreLabel, searchExamples, stats } = useCatalogue();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const genre = params.get('genre');
  const status = (params.get('status') ?? 'All') as AnimeStatus | 'All';
  const kind = (params.get('kind') ?? 'All') as AnimeKind | 'All';
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [term, setTerm] = useState(q);

  /* While a search is live the results are already ordered by relevance, so
     that becomes the default; an explicit pick in the sort menu still wins,
     and "Best match" disappears from the menu when there is nothing to rank. */
  const needle = q.trim();
  const searching = needle.length > 0;
  const sortParam = params.get('sort');
  const sort: SortId =
    sortParam === 'relevance' && !searching
      ? 'popularity'
      : (sortParam as SortId | null) ?? (searching ? 'relevance' : 'popularity');

  useEffect(() => setTerm(q), [q]);

  const query = useMemo(
    () => ({
      q: needle || undefined,
      genre: genre ?? undefined,
      status: status !== 'All' ? status : undefined,
      kind: kind !== 'All' ? kind : undefined,
      sort: SERVER_SORT[sort],
      limit: PAGE_SIZE,
    }),
    [needle, genre, status, kind, sort],
  );

  const [rows, setRows] = useState<Anime[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [capped, setCapped] = useState(false);
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
        setCapped(Boolean(r.capped));
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
        setCapped(Boolean(r.capped));
        setBusy(null);
      })
      .catch((err: Error) => {
        setFetchError(err.message);
        setBusy(null);
      });
  };

  const patch = (next: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === '' || v === 'All') p.delete(k);
      else p.set(k, v);
    }
    setParams(p, { replace: true });
  };

  const clearAll = () => setParams(new URLSearchParams(), { replace: true });
  const hasFilters = Boolean(q || genre) || status !== 'All' || kind !== 'All';

  return (
    <div className="page catalogue">
      <div className="shell">
        <header className="catalogue__head">
          <div>
            <p className="eyebrow">Catalogue</p>
            <h1>All Anime</h1>
            <p className="catalogue__lede">
              Every title this site serves —{' '}
              {stats
                ? `${stats.titles} series and films read from the catalogue database.`
                : 'the count appears once the catalogue database answers.'}{' '}
              Filter, sort and open the immersive watch page.
            </p>
          </div>
          <div className="catalogue__stats">
            <span>
              <b>{total ?? '—'}</b>
              matching
            </span>
            <span>
              <b>{stats ? stats.ongoing : '—'}</b>
              airing now
            </span>
          </div>
        </header>

        <div className="catalogue__controls">
          <form
            className="search catalogue__search"
            onSubmit={(e) => {
              e.preventDefault();
              patch({ q: term.trim() || null });
            }}
            role="search"
          >
            <Search size={16} aria-hidden="true" />
            <label className="sr-only" htmlFor="cat-search">
              Search the catalogue
            </label>
            <input
              id="cat-search"
              type="search"
              placeholder="Search title, original name, genre, or format..."
              value={term}
              onChange={(e) => setTerm(e.target.value)}
            />
            {term && (
              <button
                type="button"
                className="search__go"
                aria-label="Clear search"
                onClick={() => {
                  setTerm('');
                  patch({ q: null });
                }}
              >
                <X size={15} />
              </button>
            )}
          </form>

          <div className="catalogue__control-group">
            <label className="select">
              <SlidersHorizontal size={14} aria-hidden="true" />
              <span className="sr-only">Status</span>
              <select value={status} onChange={(e) => patch({ status: e.target.value })}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s === 'All' ? 'Any status' : s}
                  </option>
                ))}
              </select>
            </label>

            <label className="select">
              <ArrowDownUp size={14} aria-hidden="true" />
              <span className="sr-only">Sort</span>
              <select value={sort} onChange={(e) => patch({ sort: e.target.value })}>
                {SORTS.filter((s) => s.id !== 'relevance' || searching).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="segmented" role="group" aria-label="Result layout">
              <button
                type="button"
                className={view === 'grid' ? 'is-on' : ''}
                onClick={() => setView('grid')}
                aria-pressed={view === 'grid'}
                aria-label="Grid layout"
              >
                <LayoutGrid size={16} />
              </button>
              <button
                type="button"
                className={view === 'list' ? 'is-on' : ''}
                onClick={() => setView('list')}
                aria-pressed={view === 'list'}
                aria-label="List layout"
              >
                <List size={16} />
              </button>
            </div>
          </div>
        </div>

        <div className="filters filters--wrap" role="group" aria-label="Format and genre">
          <div className="filters__group">
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                className={`pill${(params.get('kind') ?? 'All') === k ? ' is-active' : ''}`}
                onClick={() => patch({ kind: k })}
                aria-pressed={(params.get('kind') ?? 'All') === k}
              >
                {k}
              </button>
            ))}
          </div>
        </div>

        <div className="catalogue__chips">
          <GenreChips
            genres={GENRES}
            active={genre}
            onSelect={(id) => patch({ genre: genre === id ? null : id })}
          />
        </div>

        {hasFilters && (
          <div className="catalogue__active">
            <p>
              Showing
              {q ? (
                <>
                  {' '}
                  results for <b>“{q}”</b>
                </>
              ) : (
                ' every title'
              )}
              {genre && (
                <>
                  {' '}
                  in <b>{genreLabel(genre)}</b>
                </>
              )}
              {status !== 'All' && (
                <>
                  {' '}
                  · <b>{status}</b>
                </>
              )}
            </p>
            <button type="button" className="btn btn--sm btn--ghost" onClick={clearAll}>
              <X size={14} aria-hidden="true" /> Clear all
            </button>
          </div>
        )}

        {bootStatus === 'loading' && rows.length === 0 ? (
          <CatalogueLoading grid={view === 'grid'} rows={view === 'grid' ? 10 : 5} />
        ) : bootStatus === 'error' ? (
          <CatalogueError error={bootError} onRetry={reload} />
        ) : busy === 'load' && rows.length === 0 ? (
          <CatalogueLoading grid={view === 'grid'} rows={view === 'grid' ? 10 : 5} />
        ) : fetchError && rows.length === 0 ? (
          <CatalogueError error={fetchError} onRetry={() => setParams(new URLSearchParams(params), { replace: true })} />
        ) : rows.length || busy === 'load' ? (
          <>
            <ul className={view === 'grid' ? 'pgrid' : 'lgrid'} aria-busy={busy !== null}>
              {rows.map((a) => (
                <li key={a.id}>
                  <AnimeCard
                    anime={a}
                    variant={view === 'grid' ? 'poster' : 'wide'}
                    badge={a.status === 'Ongoing' ? 'ONGOING' : a.status === 'Upcoming' ? 'UPCOMING' : undefined}
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
                  {capped ? '+' : ''}
                </button>
              ) : (
                <span className="catalogue__more-end" role="status">
                  {capped ? `Showing the first ${rows.length} matches.` : `All ${rows.length} shown.`}
                </span>
              )}
            </div>
          </>
        ) : (
          <div className="empty" role="status">
            <p>
              <b>Nothing matched “{term.trim() || 'that filter'}”.</b>
              {searchExamples.length ? (
                <>
                  The catalogue holds {stats ? stats.titles : 'many'} titles — try{' '}
                  {searchExamples.map((s) => `“${s}”`).join(' or ')} or widen the filters.
                </>
              ) : (
                <>Try a different spelling or clear the filters.</>
              )}
            </p>
            <div className="empty__cta">
              <button type="button" className="btn btn--sm btn--primary" onClick={clearAll}>
                Reset search
              </button>
              <Link className="btn btn--sm btn--ghost" to="/genres">
                Browse genres
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
