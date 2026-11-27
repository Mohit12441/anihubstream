import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  BookmarkPlus,
  Calendar,
  ChevronRight,
  Clock,
  Film,
  Heart,
  Music,
  Play,
  Star,
} from 'lucide-react';
import { useAnimeDetail, useCatalogue } from '../state/catalogue';
import { useLibrary } from '../state/library';
import { usePlayerPreferences } from '../lib/usePlayerPrefs';
import { positionKey } from '../lib/playerPrefs';
import { useSEO } from '../lib/useSEO';
import { CatalogueError, CatalogueLoading } from '../components/CatalogueState';
import { AiringCountdown } from '../components/AiringCountdown';
import { FranchiseTimeline } from '../components/franchise/FranchiseTimeline';
import { RecommendedShelf } from '../components/RecommendedShelf';
import { ratingLabel, type AnimeTheme } from '../data/model';
import { SLUG_REDIRECTS } from '../data/redirects';
import { getCleanWatchUrl } from '../data/servers';
import { CommentsSection } from '../components/CommentsSection';
import '../styles/anime-detail.css';

export function AnimeDetail() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();

  useEffect(() => {
    if (id && SLUG_REDIRECTS[id] && SLUG_REDIRECTS[id] !== id) {
      navigate(`/anime/${SLUG_REDIRECTS[id]}`, { replace: true });
    }
  }, [id, navigate]);

  const { status, error, missing, anime, reload } = useAnimeDetail(id);
  const { genreLabel } = useCatalogue();
  const { has, isBusy, toggle, favourites, toggleFavourite, history } = useLibrary();
  const { positions } = usePlayerPreferences();

  const [themes, setThemes] = useState<AnimeTheme[]>([]);

  // Theme songs (OP/ED) arrive directly with anime detail
  useEffect(() => {
    setThemes(anime?.themes || []);
  }, [anime?.themes]);

  useSEO({
    title: anime ? `${anime.title} — Watch Online & Episode Guide | AniHubStream` : 'Anime Details | AniHubStream',
    description: anime ? anime.synopsis?.slice(0, 160) : 'Stream and explore high-definition anime series.',
    image: anime?.poster,
    type: 'video.tv_show',
  });

  if (status === 'loading') {
    return <CatalogueLoading rows={4} />;
  }

  if (status === 'error' || missing || !anime) {
    return (
      <CatalogueError
        error={missing ? 'Anime not found in catalogue.' : error || 'Failed to load details.'}
        onRetry={reload}
      />
    );
  }

  const isUpcoming = anime.status === 'Upcoming' || anime.status === 'NOT_YET_RELEASED';
  const hasReleasedEpisodes = Boolean(anime.episodes && anime.episodes.length > 0);
  const inList = has(anime.id);
  const isFav = favourites.has(anime.id);
  const resume = history.find((h) => h.anime.id === anime.id);
  const epCount = isUpcoming ? 0 : (anime.episodes?.length || anime.episodeCount || 0);

  let targetEp = resume?.episodeNumber && resume.episodeNumber > 0 ? resume.episodeNumber : 1;
  let isNextEp = false;
  let hasProgress = false;

  const currentPos = positions[positionKey(anime.id, targetEp)];
  if (currentPos && (currentPos.finished || (currentPos.d > 0 && currentPos.t / currentPos.d >= 0.9))) {
    if (targetEp < epCount) {
      targetEp += 1;
      isNextEp = true;
    }
    hasProgress = true;
  } else if (currentPos && currentPos.t > 1) {
    hasProgress = true;
  } else if (!resume) {
    for (let i = 1; i <= Math.min(epCount, 200); i++) {
      const pos = positions[positionKey(anime.id, i)];
      if (pos && (pos.finished || (pos.d > 0 && pos.t / pos.d >= 0.9))) {
        hasProgress = true;
        if (i < epCount) {
          targetEp = i + 1;
          isNextEp = true;
        } else {
          targetEp = i;
        }
      } else if (pos && pos.t > 1) {
        hasProgress = true;
        targetEp = i;
        isNextEp = false;
        break;
      }
    }
  }

  const ctaLabel = isNextEp
    ? `Continue: Episode ${targetEp}`
    : (resume?.episodeNumber || hasProgress) && targetEp > 1
      ? `Resume Episode ${targetEp}`
      : 'Watch Episode 1';
  const ratingFormatted = anime.rating ? (anime.rating > 10 ? (anime.rating / 10).toFixed(1) : anime.rating.toFixed(1)) : '—';

  const getWatchUrl = (targetEpNum: number) => {
    return getCleanWatchUrl(anime.id, targetEpNum);
  };

  return (
    <div className="ad-page" style={{ '--tint': anime.accent || '#ff2a5f' } as React.CSSProperties}>
      {/* Hero Banner Backdrop */}
      <div className="ad-backdrop">
        <img
          src={anime.key || anime.poster}
          alt=""
          className="ad-backdrop__img"
          aria-hidden="true"
        />
        <div className="ad-backdrop__glow" />
        <div className="ad-backdrop__fade" />
      </div>

      <div className="ad-shell">
        {/* Breadcrumb Navigation */}
        <nav className="ad-crumbs" aria-label="Breadcrumb">
          <Link to="/">Home</Link>
          <ChevronRight size={13} aria-hidden="true" />
          <Link to="/anime">Anime</Link>
          <ChevronRight size={13} aria-hidden="true" />
          <span aria-current="page">{anime.title}</span>
        </nav>

        {/* Anime Header Card */}
        <div className="ad-hero">
          {/* Poster Column */}
          <div className="ad-poster-wrap">
            <img
              src={anime.poster}
              alt={anime.title}
              className="ad-poster"
            />
            <div className="ad-poster-actions">
              <button
                type="button"
                className={`ad-action-btn ${inList ? 'is-active' : ''}`}
                onClick={() => toggle(anime.id)}
                disabled={isBusy(anime.id)}
                style={{ flex: 1 }}
              >
                <BookmarkPlus size={16} />
                <span>{inList ? 'In List' : 'Add to List'}</span>
              </button>
              <button
                type="button"
                className={`ad-action-btn ad-action-btn--fav ${isFav ? 'is-active is-fav' : ''}`}
                onClick={() => toggleFavourite(anime.id)}
                title={isFav ? 'Remove from Favourites' : 'Add to Favourites'}
                aria-label={isFav ? 'Remove from Favourites' : 'Add to Favourites'}
              >
                <Heart size={16} fill={isFav ? 'currentColor' : 'none'} />
              </button>
            </div>
          </div>

          {/* Metadata & Actions Column */}
          <div className="ad-meta">
            <div>
              {anime.native && (
                <div lang="ja" className="ad-native-title">
                  {anime.native}
                </div>
              )}
              <h1 className="ad-title">
                {anime.title}
              </h1>
            </div>

            {/* Badges Row */}
            <div className="ad-badges-row">
              <span className="ad-badge ad-badge--rating">
                <Star size={14} fill="currentColor" />
                {ratingFormatted} {ratingLabel(anime.rating)}
              </span>
              <span className="ad-badge">
                <Film size={14} />
                {anime.kind || 'TV'} · {epCount} EP
              </span>
              {anime.year && (
                <span className="ad-badge">
                  <Calendar size={14} />
                  {anime.year}
                </span>
              )}
              {anime.status && (
                <span className="ad-badge ad-badge--status">
                  {anime.status}
                </span>
              )}
            </div>

            {/* Genres */}
            {anime.genres && anime.genres.length > 0 && (
              <div className="ad-genres-row">
                {anime.genres.map((g) => (
                  <Link
                    key={g}
                    to={`/genres?genre=${encodeURIComponent(g)}`}
                    className="ad-genre-pill"
                  >
                    {genreLabel(g)}
                  </Link>
                ))}
              </div>
            )}

            {/* Synopsis */}
            <div className="ad-synopsis">
              <h2>Synopsis</h2>
              <p>
                {anime.synopsis || 'No synopsis available for this title.'}
              </p>
            </div>

            {/* Airing Countdown & Notification Bell */}
            {anime.schedule?.day && anime.schedule?.time && (
              <AiringCountdown
                anime={{
                  id: anime.id,
                  title: anime.title,
                  poster: anime.poster,
                  status: anime.status,
                  schedule: anime.schedule,
                  episodeTotal: anime.episodeTotal,
                  episodeCount: anime.episodes?.length ?? anime.episodeCount,
                }}
                variant="banner"
                showRemindMe
              />
            )}

            {/* Play / Status CTA Button */}
            <div className="ad-cta-row">
              {isUpcoming || (!hasReleasedEpisodes && anime.status === 'Ongoing') ? (
                <Link
                  to="/schedule"
                  className="ad-cta-btn ad-cta-btn--upcoming"
                >
                  <Clock size={18} />
                  <span>{isUpcoming ? 'Upcoming · View Release Schedule' : 'Coming Soon · View Schedule'}</span>
                </Link>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                  <Link
                    to={getWatchUrl(targetEp)}
                    className="ad-cta-btn"
                  >
                    <Play size={18} fill="currentColor" />
                    <span>{ctaLabel}</span>
                  </Link>
                  {targetEp > 1 && (
                    <Link
                      to={getWatchUrl(1)}
                      className="ad-cta-secondary"
                      title="Watch from Episode 1"
                    >
                      Start from Ep 1
                    </Link>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Franchise Chronology & Visual Timeline */}
        {anime.seasons && anime.seasons.length > 1 && (
          <FranchiseTimeline seasons={anime.seasons} currentAnimeId={anime.id} />
        )}

        {/* Episodes Section */}
        <section className="ad-section">
          <div className="ad-section-head">
            <h2>
              Episodes ({isUpcoming ? 0 : (anime.episodes?.length ?? epCount)})
            </h2>
          </div>

          <div className="ad-episodes-grid">
            {hasReleasedEpisodes ? (
              anime.episodes.map((ep) => (
                <Link
                  key={ep.n}
                  to={getWatchUrl(ep.n)}
                  className="ad-ep-card"
                >
                  {ep.thumb && (
                    <div className="ad-ep-thumb-wrap">
                      <img
                        src={ep.thumb}
                        alt={ep.title || `Episode ${ep.n}`}
                        className="ad-ep-thumb"
                        loading="lazy"
                      />
                    </div>
                  )}
                  <div className="ad-ep-info">
                    <div className="ad-ep-title">
                      EP {ep.n}{ep.title && ep.title.trim().toLowerCase() !== `episode ${ep.n}` ? `: ${ep.title}` : ''}
                    </div>
                    {ep.runtime && (
                      <div className="ad-ep-meta">
                        <Clock size={12} />
                        <span>{ep.runtime}</span>
                      </div>
                    )}
                  </div>
                </Link>
              ))
            ) : isUpcoming || anime.status === 'Ongoing' ? (
              <div className="ad-ep-empty-banner" style={{ gridColumn: '1 / -1' }}>
                <Clock size={40} style={{ opacity: 0.5, marginBottom: '0.75rem', color: '#94a3b8' }} />
                <h3>
                  {isUpcoming ? 'No Episodes Released Yet' : 'Episodes Coming Soon'}
                </h3>
                <p>
                  {isUpcoming
                    ? `${anime.title} is an upcoming title. Episodes will appear here as soon as they air.`
                    : 'Episodes for this ongoing title will appear here once broadcast commences.'}
                </p>
              </div>
            ) : (
              // Fallback numerical episode grid only for finished series
              Array.from({ length: epCount }, (_, i) => i + 1).map((n) => (
                <Link
                  key={n}
                  to={getWatchUrl(n)}
                  className="ad-ep-card"
                  style={{ alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <span style={{ fontWeight: 700, fontSize: '13.5px' }}>Episode {n}</span>
                  <Play size={15} color="#38bdf8" />
                </Link>
              ))
            )}
          </div>
        </section>

        {/* Theme Songs */}
        {themes.length > 0 && (
          <section className="ad-section">
            <div className="ad-section-head">
              <h2>
                <Music size={19} color="#38bdf8" aria-hidden="true" />
                <span>Theme Songs</span>
              </h2>
            </div>
            <div className="ad-themes-grid">
              {themes.map((t, idx) => (
                <div
                  key={`${t.kind}-${t.sequence}-${idx}`}
                  className="ad-theme-card"
                >
                  <span
                    className={`ad-theme-badge ${t.kind === 'OP' ? 'ad-theme-badge--op' : 'ad-theme-badge--ed'}`}
                  >
                    {t.kind} {t.sequence}
                  </span>
                  <div className="ad-theme-info">
                    <span className="ad-theme-title">"{t.title}"</span>
                    <span className="ad-theme-artist">by {t.artist}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Comments & Community Discussion */}
        <div style={{ marginTop: '3rem' }}>
          <CommentsSection animeId={anime.id} animeTitle={anime.title} />
        </div>

        {/* Recommendations */}
        {anime && (
          <div style={{ marginTop: '3rem' }}>
            <RecommendedShelf
              targetAnime={anime}
              title="You Might Also Like"
              subtitle={`Curated titles sharing themes and genres with ${anime.title}`}
              limit={8}
            />
          </div>
        )}
      </div>
    </div>
  );
}
