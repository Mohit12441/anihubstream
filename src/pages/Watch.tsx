import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { BookmarkPlus, ChevronRight, Download, Heart, Play, Share2 } from 'lucide-react';
import { AdvancedPlayer } from '../components/player/AdvancedPlayer';
import { AnimeCard } from '../components/AnimeCard';
import { CatalogueError, CatalogueLoading } from '../components/CatalogueState';
import { EpisodeSidebar } from '../components/EpisodeSidebar';
import { ratingLabel, toSeconds } from '../data/model';
import { useToast } from '../lib/Toast';
import { accentVars, usePlayerPreferences } from '../lib/usePlayerPrefs';
import { positionKey } from '../lib/playerPrefs';
import { useAnimeDetail, useCatalogue } from '../state/catalogue';
import { useLibrary } from '../state/library';
import '../styles/watch.css';
import '../styles/player.css';

export function Watch() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const { notify } = useToast();
  const { status, error, missing, anime, related, reload } = useAnimeDetail(id);
  const { genreLabel } = useCatalogue();
  const { has, isBusy, toggle, favourites, toggleFavourite, recordPosition } = useLibrary();
  const { prefs, patch, patchSubs, restoreSubs, restoreAppearance, positions, record } = usePlayerPreferences();

  const [epNum, setEpNum] = useState(1);
  const [theatre, setTheatre] = useState(false);

  /* ?ep= is only read when the title resolves — the list arrives after mount. */
  const initialised = useRef('');
  useEffect(() => {
    if (!anime || initialised.current === anime.id) return;
    initialised.current = anime.id;
    const fromUrl = Number.parseInt(params.get('ep') ?? '', 10);
    const wanted = Number.isFinite(fromUrl) && fromUrl >= 1 ? fromUrl : Math.min(8, anime.episodes.length);
    setEpNum(Math.min(Math.max(wanted, 1), anime.episodes.length));
  }, [anime, params]);

  const episode = useMemo(() => {
    if (!anime) return undefined;
    return anime.episodes[Math.min(Math.max(epNum, 1), anime.episodes.length) - 1];
  }, [anime, epNum]);

  const idx = episode?.n ?? 1;
  const key = anime ? positionKey(anime.id, idx) : '';
  const runtime = episode ? toSeconds(episode.runtime) : 0;

  const selectEpisode = useCallback(
    (n: number) => {
      if (!anime) return;
      const clamped = Math.min(Math.max(n, 1), anime.episodes.length);
      setEpNum(clamped);
      const next = new URLSearchParams(params);
      next.set('ep', String(clamped));
      setParams(next, { replace: true });
    },
    [anime, params, setParams],
  );

  const save = async () => {
    if (!anime) return;
    const wasSaved = has(anime.id);
    const ok = await toggle(anime.id);
    if (!ok) notify('The library service did not answer — nothing was changed.');
    else notify(wasSaved ? 'Removed from your list.' : 'Saved to your list.');
  };

  const saved = prefs.rememberPosition ? positions[key] : undefined;
  // a finished episode restarts from 0 rather than opening straight onto the end card
  const resumeAt = saved && !saved.finished ? Math.min(saved.t, Math.max(0, runtime - 5)) : 0;

  if (missing) {
    return (
      <div className="page watch__missing shell">
        <h1>This title isn&rsquo;t in the catalogue</h1>
        <p>
          {error ?? `Nothing with the id “${id}” is served by this site.`} Pick one from the catalogue instead.
        </p>
        <div className="watch__missing-cta">
          <Link className="btn btn--primary" to="/anime">
            Browse anime
          </Link>
          <Link className="btn btn--ghost" to="/">
            Back home
          </Link>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="page watch shell">
        <CatalogueError error={error} onRetry={reload} />
      </div>
    );
  }

  if (status !== 'ready' || !anime || !episode) {
    return (
      /* The real watch layout is very tall (the episode rail alone is hundreds of
         rows), so a short skeleton would leave the footer on screen and then drag
         it thousands of pixels down the moment data lands — a huge layout shift.
         Holding the loading state at least a viewport tall keeps the footer below
         the fold in both states, so nothing visible moves when the swap happens. */
      <div className="page watch watch--loading shell">
        <CatalogueLoading grid={false} rows={4} />
      </div>
    );
  }

  const last = anime.episodes.length;
  const inList = has(anime.id);
  const busy = isBusy(anime.id);
  const faved = favourites.has(anime.id);
  const goNext = () => idx < last && selectEpisode(idx + 1);
  const goPrev = () => idx > 1 && selectEpisode(idx - 1);

  const crumbs = [
    { label: 'Home', to: '/' },
    { label: 'Anime', to: '/anime' },
    { label: anime.title, to: `/watch/${anime.id}` },
    ...(anime.genres.length
      ? [{ label: genreLabel(anime.genres[0]), to: `/anime?genre=${anime.genres[0]}` }]
      : []),
  ];

  return (
    <div
      className={`page watch${theatre ? ' is-theatre' : ''}`}
      style={{ '--tint': anime.accent, ...accentVars(prefs.accent) } as React.CSSProperties}
    >
      {theatre && <div className="watch__veil" onClick={() => setTheatre(false)} aria-hidden="true" />}

      <nav className="watch__crumbs shell" aria-label="Breadcrumb">
        <ol>
          {crumbs.map((c) => (
            <li key={c.to}>
              <Link to={c.to}>{c.label}</Link>
              <ChevronRight size={13} aria-hidden="true" />
            </li>
          ))}
          <li>
            <span aria-current="page">Episode {idx}</span>
          </li>
        </ol>
      </nav>

      <div className="watch__grid shell">
        <div className="watch__main">
          <AdvancedPlayer
            anime={anime}
            episode={episode}
            next={anime.episodes[idx] ?? null}
            hasPrev={idx > 1}
            hasNext={idx < last}
            onPrev={goPrev}
            onNext={goNext}
            theatre={theatre}
            onTheatre={setTheatre}
            prefs={prefs}
            patch={patch}
            patchSubs={patchSubs}
            restoreSubs={restoreSubs}
            restoreAppearance={restoreAppearance}
            resumeAt={resumeAt}
            onProgress={(t) => {
              record(key, t, runtime);
              recordPosition(anime, idx, episode.title, t, runtime);
            }}
          />

          <div className="watch__meta">
            <div className="watch__meta-head">
              <h1>
                {anime.title} <span>– {anime.season} Episode {idx}</span>
              </h1>
              <p className="watch__native">{anime.native}</p>
            </div>

            <ul className="watch__badges">
              <li className="badge badge--accent">HD</li>
              <li className="badge">Sub</li>
              {anime.genres.map((g) => (
                <li key={g} className="badge">
                  <Link to={`/genres?genre=${g}`}>{genreLabel(g)}</Link>
                </li>
              ))}
            </ul>

            <p className="watch__syn">{anime.synopsis}</p>
            <p className="watch__syn watch__syn--ep">{episode.synopsis}</p>

            <dl className="watch__facts">
              <div>
                <dt>Rating</dt>
                <dd>{ratingLabel(anime.rating)}</dd>
              </div>
              <div>
                <dt>Year</dt>
                <dd>{anime.year}</dd>
              </div>
              <div>
                <dt>Format</dt>
                <dd>{anime.kind}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{anime.status}</dd>
              </div>
              <div>
                <dt>Runtime</dt>
                <dd>{episode.runtime}</dd>
              </div>
              <div>
                <dt>Your position</dt>
                <dd>{positions[key] ? `${Math.round(positions[key].t / 60)} min in` : 'Not started'}</dd>
              </div>
            </dl>

            <div className="watch__actions">
              <button
                type="button"
                className={`btn btn--ghost${inList ? ' is-on' : ''}`}
                onClick={() => void save()}
                disabled={busy}
                aria-live="polite"
              >
                <BookmarkPlus size={17} aria-hidden="true" />
                {busy ? 'Saving…' : inList ? 'In My List' : 'Add to List'}
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => notify('Downloads are not offered for bridge streams.')}
              >
                <Download size={17} aria-hidden="true" />
                Download
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(window.location.href)
                    .then(() => notify('Link copied to your clipboard.'))
                    .catch(() => notify(window.location.href));
                }}
              >
                <Share2 size={17} aria-hidden="true" />
                Share
              </button>
              <button
                type="button"
                className={`btn btn--icon watch__fav${faved ? ' is-on' : ''}`}
                aria-pressed={faved}
                aria-label={faved ? 'Remove from favourites' : 'Add to favourites'}
                onClick={() => {
                  toggleFavourite(anime.id);
                  notify(faved ? 'Removed from favourites on this device.' : 'Saved to favourites on this device.');
                }}
              >
                <Heart size={18} fill={faved ? 'currentColor' : 'none'} />
              </button>
            </div>
          </div>
        </div>

        <EpisodeSidebar
          anime={anime}
          current={idx}
          onSelect={selectEpisode}
          autoNext={prefs.autoNext}
          onAutoNext={(v) => patch({ autoNext: v })}
          positions={positions}
          theatre={theatre}
          onTheatre={setTheatre}
        />
      </div>

      <section className="watch__more shell" aria-labelledby="watch-more">
        <div className="sec-head">
          <h2 id="watch-more">
            <Play size={19} aria-hidden="true" />
            More from this shelf
          </h2>
        </div>
        <div className="watch__more-grid">
          {related.length ? (
            related.map((a) => <AnimeCard key={a.id} anime={a} variant="key" />)
          ) : (
            <p className="empty-row">No related titles are linked to this one in the database.</p>
          )}
        </div>
      </section>
    </div>
  );
}
