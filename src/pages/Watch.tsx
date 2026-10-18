import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { BookmarkPlus, ChevronRight, Clock, Download, Heart, Play, Share2 } from 'lucide-react';
import { AdvancedPlayer } from '../components/player/AdvancedPlayer';
import { DownloadModal } from '../components/player/DownloadModal';
import { AnimeCard } from '../components/AnimeCard';
import { CatalogueError, CatalogueLoading } from '../components/CatalogueState';
import { EpisodeSidebar } from '../components/EpisodeSidebar';
import { ratingLabel, toSeconds } from '../data/model';
import { useToast } from '../lib/Toast';
import { accentVars, usePlayerPreferences } from '../lib/usePlayerPrefs';
import { positionKey } from '../lib/playerPrefs';
import { useAnimeDetail, useCatalogue } from '../state/catalogue';
import { useLibrary } from '../state/library';
import { useSEO } from '../lib/useSEO';
import { SLUG_REDIRECTS } from '../data/redirects';
import { prefetchEpisode, type BridgeSource } from '../lib/streamBridge';
import { warmStreamOrigins } from '../lib/warmConnections';
import '../styles/watch.css';
import '../styles/player.css';

export function Watch() {
  const { id = '', ep } = useParams<{ id: string; ep?: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    if (id && SLUG_REDIRECTS[id]) {
      const canonical = SLUG_REDIRECTS[id];
      const target = ep ? `/watch/${canonical}/${ep}` : `/watch/${canonical}`;
      navigate(target, { replace: true });
    }
  }, [id, ep, navigate]);

  const { notify } = useToast();
  const { status, error, missing, anime, related, reload } = useAnimeDetail(id);
  const { genreLabel } = useCatalogue();
  const { has, isBusy, toggle, favourites, toggleFavourite, recordPosition } = useLibrary();
  const { prefs, patch, patchSubs, restoreSubs, restoreAppearance, positions, record } = usePlayerPreferences();

  const [epNum, setEpNum] = useState(1);
  const [theatre, setTheatre] = useState(false);
  const [isStreamResolved, setIsStreamResolved] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [currentStream, setCurrentStream] = useState<BridgeSource | null>(null);

  /* Reset stream resolved state on anime or episode change */
  useEffect(() => {
    setIsStreamResolved(false);
    setCurrentStream(null);
  }, [id, epNum]);

  /* Path param :ep sync with edge-case clamping and resume fallback */
  useEffect(() => {
    if (!anime || anime.episodes.length === 0) return;

    if (ep !== undefined) {
      const parsed = Number.parseInt(ep, 10);
      const total = anime.episodes.length;
      if (!Number.isFinite(parsed) || parsed < 1) {
        // Non-numeric or < 1 -> default to 1, replace URL
        navigate(`/watch/${anime.id}/1`, { replace: true });
        setEpNum(1);
      } else if (parsed > total) {
        // Exceeds total -> clamp to max episode, replace URL
        navigate(`/watch/${anime.id}/${total}`, { replace: true });
        setEpNum(total);
      } else {
        // Valid episode -> set player
        setEpNum(parsed);
      }
    } else {
      // /watch/:id without :ep -> redirect to saved resume episode (or ep 1)
      const queryEp = Number.parseInt(params.get('ep') ?? '', 10);
      let targetEp = 1;
      if (Number.isFinite(queryEp) && queryEp >= 1) {
        targetEp = Math.min(queryEp, anime.episodes.length);
      } else {
        const savedKey = Object.keys(positions).find((k) => k.startsWith(`${anime.id}#`));
        if (savedKey) {
          const match = /#(\d+)$/.exec(savedKey);
          if (match) {
            const resumeEp = Number.parseInt(match[1], 10);
            if (Number.isFinite(resumeEp) && resumeEp >= 1 && resumeEp <= anime.episodes.length) {
              targetEp = resumeEp;
            }
          }
        }
      }
      navigate(`/watch/${anime.id}/${targetEp}`, { replace: true });
      setEpNum(targetEp);
    }
  }, [anime, ep, params, navigate, positions]);

  const episode = useMemo(() => {
    if (!anime) return undefined;
    return anime.episodes[Math.min(Math.max(epNum, 1), anime.episodes.length) - 1];
  }, [anime, epNum]);

  const cleanSynopsis = useMemo(() => {
    if (!anime?.synopsis) return 'Watch high definition anime with English subtitles and dub on AniHubStream.';
    return anime.synopsis.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150);
  }, [anime?.synopsis]);

  const canonicalUrl = useMemo(() => {
    if (!anime) return undefined;
    return epNum && epNum >= 1
      ? `https://anihubstream.com/watch/${anime.id}/${epNum}`
      : `https://anihubstream.com/watch/${anime.id}`;
  }, [anime, epNum]);

  const jsonLd = useMemo(() => {
    if (!anime) return null;
    const origin = 'https://anihubstream.com';
    const mainEntity = {
      '@type': episode ? 'TVEpisode' : 'TVSeries',
      name: episode ? `${anime.title} Episode ${episode.n}` : anime.title,
      alternateName: anime.native || undefined,
      description: cleanSynopsis,
      image: anime.key || anime.poster,
      url: canonicalUrl,
      ...(episode ? { episodeNumber: episode.n } : {}),
      ...(!episode && anime.episodeTotal ? { numberOfEpisodes: anime.episodeTotal } : {}),
      ...(anime.rating > 0
        ? {
            aggregateRating: {
              '@type': 'AggregateRating',
              ratingValue: anime.rating,
              bestRating: 10,
              worstRating: 0,
              ratingCount: 150,
            },
          }
        : {}),
    };

    const breadcrumbs = {
      '@type': 'BreadcrumbList',
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          name: 'Home',
          item: origin,
        },
        {
          '@type': 'ListItem',
          position: 2,
          name: 'Anime',
          item: `${origin}/anime`,
        },
        {
          '@type': 'ListItem',
          position: 3,
          name: anime.title,
          item: `${origin}/watch/${anime.id}`,
        },
        ...(episode ? [{
          '@type': 'ListItem',
          position: 4,
          name: `Episode ${episode.n}`,
          item: canonicalUrl,
        }] : []),
      ],
    };

    return {
      '@context': 'https://schema.org',
      '@graph': [mainEntity, breadcrumbs],
    };
  }, [anime, episode, cleanSynopsis, canonicalUrl]);

  useSEO({
    title: anime
      ? `${anime.title}${episode ? ` Ep ${episode.n}` : anime.year ? ` (${anime.year})` : ''} — Watch Free | AniHubStream`
      : 'Watch Anime Free | AniHubStream',
    description: cleanSynopsis,
    image: anime?.key || anime?.poster,
    type: episode ? 'video.episode' : 'video.tv_show',
    canonicalUrl,
    jsonLd,
  });

  const idx = episode?.n ?? 1;
  const key = anime ? positionKey(anime.id, idx) : '';
  const runtime = episode ? toSeconds(episode.runtime) : 0;

  const selectEpisode = useCallback(
    (n: number) => {
      if (!anime || anime.episodes.length === 0) return;
      const clamped = Math.min(Math.max(n, 1), anime.episodes.length);
      setEpNum(clamped);
      navigate(`/watch/${anime.id}/${clamped}`);
    },
    [anime, navigate],
  );

  const prefetchedNext = useRef<number | null>(null);

  useEffect(() => {
    prefetchedNext.current = null;
    warmStreamOrigins();
  }, [anime?.id, epNum]);

  // Prefetch next episode after 2 minutes on watch page
  useEffect(() => {
    if (!anime) return;
    const nextEp = epNum + 1;
    if (nextEp > anime.episodes.length) return;
    const timer = window.setTimeout(() => {
      if (prefetchedNext.current !== nextEp) {
        prefetchedNext.current = nextEp;
        void prefetchEpisode(anime.title, nextEp, prefs.audio ?? 'sub');
      }
    }, 120_000);
    return () => window.clearTimeout(timer);
  }, [anime, epNum, prefs.audio]);

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

  if (status !== 'ready' || !anime) {
    return (
      <div className="page watch watch--loading shell">
        <CatalogueLoading grid={false} rows={4} />
      </div>
    );
  }

  // Graceful empty state for newly announced/ongoing shows that have no episodes released yet
  if (anime.episodes.length === 0 || !episode) {
    return (
      <div className="page watch shell" style={{ '--tint': anime.accent, ...accentVars(prefs.accent) } as React.CSSProperties}>
        <nav className="watch__crumbs" aria-label="Breadcrumb">
          <ol>
            <li><Link to="/">Home</Link><ChevronRight size={13} aria-hidden="true" /></li>
            <li><Link to="/anime">Anime</Link><ChevronRight size={13} aria-hidden="true" /></li>
            <li><span aria-current="page">{anime.title}</span></li>
          </ol>
        </nav>
        <div className="watch__empty-banner" style={{ textAlign: 'center', padding: '60px 20px', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', margin: '20px 0' }}>
          <Clock size={48} style={{ opacity: 0.6, marginBottom: '16px' }} />
          <h2>Episodes Coming Soon</h2>
          <p style={{ maxWidth: '500px', margin: '12px auto 24px', opacity: 0.8 }}>
            <strong>{anime.title}</strong> is currently {anime.status.toLowerCase()} ({anime.season || anime.year}). Episodes will appear here as soon as they air.
          </p>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
            <Link className="btn btn--primary" to="/schedule">Check Release Schedule</Link>
            <Link className="btn btn--ghost" to="/anime">Browse Catalogue</Link>
          </div>
        </div>
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
              // Prefetch next episode when reaching 80% progress
              if (runtime > 0 && t / runtime >= 0.8 && anime && idx < anime.episodes.length) {
                const nextEp = idx + 1;
                if (prefetchedNext.current !== nextEp) {
                  prefetchedNext.current = nextEp;
                  void prefetchEpisode(anime.title, nextEp, prefs.audio ?? 'sub');
                }
              }
            }}
            onStreamResolved={setIsStreamResolved}
            onStreamInfo={setCurrentStream}
          />

          <div className="watch__meta">
            <div className="watch__meta-head">
              <h1>
                {anime.title}{anime.season ? <span> – {anime.season} Episode {idx}</span> : <span> – Episode {idx}</span>}
              </h1>
              <p className="watch__native" lang="ja">{anime.native}</p>
            </div>

            <ul className="watch__badges">
              {isStreamResolved && <li className="badge badge--accent">HD</li>}
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
                <dd>{episode.runtime && episode.runtime !== '0:00' && episode.runtime !== '0m' ? episode.runtime : '—'}</dd>
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
                onClick={() => setDownloadOpen(true)}
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

      <DownloadModal
        isOpen={downloadOpen}
        onClose={() => setDownloadOpen(false)}
        anime={anime}
        episode={episode}
        currentStream={currentStream}
        notify={notify}
      />
    </div>
  );
}
