import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  BookmarkPlus,
  Calendar,
  ChevronRight,
  Clock,
  Film,
  Globe,
  Heart,
  Layers,
  Music,
  Play,
  Radio,
  Server,
  Shield,
  Sparkles,
  Star,
  Zap,
} from 'lucide-react';
import { useAnimeDetail, useCatalogue } from '../state/catalogue';
import { useLibrary } from '../state/library';
import { useSEO } from '../lib/useSEO';
import { CatalogueError, CatalogueLoading } from '../components/CatalogueState';
import { AiringCountdown } from '../components/AiringCountdown';
import { FranchiseTimeline } from '../components/franchise/FranchiseTimeline';
import { RecommendedShelf } from '../components/RecommendedShelf';
import { ratingLabel, type AnimeTheme } from '../data/model';
import { getPlay } from '../data/api';
import { SLUG_REDIRECTS } from '../data/redirects';
import { DEFAULT_PLAY_SERVERS } from './Watch';
import '../styles/anime-detail.css';

interface ServerPreview {
  id: string;
  name: string;
  status: string;
  provider?: string;
  unavailableReason?: string;
  quality?: string;
  audio?: string;
  streamUrl?: string | null;
  audioTracks?: any[];
  subtitles?: any[];
}

function getProviderIcon(provId: string) {
  switch (provId) {
    case 'anikoto':
      return <Zap size={14} className="text-amber-400" />;
    case 'hianime':
      return <Sparkles size={14} className="text-sky-400" />;
    case 'aniwatch':
      return <Globe size={14} className="text-emerald-400" />;
    case 'anipm':
      return <Shield size={14} className="text-rose-400" />;
    case 'torrent':
    case 'p2p':
      return <Radio size={14} className="text-purple-400" />;
    default:
      return <Server size={14} className="text-blue-400" />;
  }
}

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

  const [servers, setServers] = useState<ServerPreview[]>(DEFAULT_PLAY_SERVERS);
  const [serversLoading, setServersLoading] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState<string>('anikoto');
  const [themes, setThemes] = useState<AnimeTheme[]>([]);

  const groupedProviders = useMemo(() => {
    const map = new Map<string, {
      id: string;
      name: string;
      status: string;
      unavailableReason?: string;
      mirrorCount: number;
      hasDub: boolean;
    }>();

    for (const s of servers) {
      const provKey = (s.provider || (s.id?.includes(':') ? s.id.split(':')[0] : 'anikoto')).toLowerCase();
      const existing = map.get(provKey);
      const isUnavailable = s.status === 'unavailable' || (provKey === 'anipm' && (!s.streamUrl || s.status === 'unavailable'));
      const hasDub = Boolean(s.id?.includes('-dub') || s.audio === 'dub');

      if (!existing) {
        map.set(provKey, {
          id: provKey,
          name: provKey === 'anikoto' ? 'AniKoto' : provKey === 'hianime' ? 'HiAnime' : provKey === 'aniwatch' ? 'AniWatch' : provKey === 'anipm' ? 'AniPM' : 'P2P Swarm',
          status: isUnavailable ? 'unavailable' : 'ready',
          unavailableReason: s.unavailableReason || (provKey === 'anipm' ? 'Cloudflare WAF (Requires VPS Bridge)' : undefined),
          mirrorCount: isUnavailable ? 0 : 1,
          hasDub,
        });
      } else {
        if (!isUnavailable) {
          existing.mirrorCount++;
          existing.status = 'ready';
        }
        if (hasDub) existing.hasDub = true;
      }
    }

    return Array.from(map.values());
  }, [servers]);

  // Theme songs (OP/ED) arrive directly with anime detail
  useEffect(() => {
    setThemes(anime?.themes || []);
  }, [anime?.themes]);

  // Fetch servers available for episode 1 (/api/play?id=) only for aired anime
  useEffect(() => {
    if (!id || anime?.status === 'Upcoming' || anime?.status === 'NOT_YET_RELEASED') {
      setServersLoading(false);
      return;
    }
    let active = true;
    setServersLoading(true);

    getPlay({ id, ep: 1 })
      .then((data) => {
        if (!active || !data) return;
        if (Array.isArray(data.servers)) {
          const mapped: ServerPreview[] = data.servers.map((s: any) => ({
            id: s.id || s.name,
            name: s.name || 'HD Server',
            provider: s.provider,
            status: s.status || 'ready',
            unavailableReason: s.unavailableReason,
            quality: s.quality || '1080p',
            audio: s.audio || (s.id?.includes('-dub') ? 'dub' : 'sub'),
            audioTracks: s.audioTracks || [],
            subtitles: s.subtitles || [],
          }));
          setServers(mapped);
          setSelectedProviderId((prev) => {
            const valid = mapped.some((s) => (s.provider || '').toLowerCase() === prev && s.status !== 'unavailable');
            if (valid) return prev;
            const ready = mapped.find((s) => s.status !== 'unavailable');
            return (ready?.provider || 'anikoto').toLowerCase();
          });
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setServersLoading(false);
      });

    return () => {
      active = false;
    };
  }, [id, anime?.status]);

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
  const targetEp = resume?.episodeNumber && resume.episodeNumber > 0 ? resume.episodeNumber : 1;
  const epCount = isUpcoming ? 0 : (anime.episodes?.length || anime.episodeCount || 0);
  const ratingFormatted = anime.rating ? (anime.rating > 10 ? (anime.rating / 10).toFixed(1) : anime.rating.toFixed(1)) : '—';

  const getWatchUrl = (targetEpNum: number, provId = selectedProviderId) => {
    return `/watch/${encodeURIComponent(anime.id)}/${targetEpNum}?provider=${encodeURIComponent(provId)}`;
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
                <Link
                  to={getWatchUrl(targetEp)}
                  className="ad-cta-btn"
                >
                  <Play size={18} fill="currentColor" />
                  <span>{resume?.episodeNumber ? `Resume Episode ${resume.episodeNumber}` : 'Watch Episode 1'}</span>
                </Link>
              )}
            </div>

            {/* Multi-Source Streaming Providers */}
            <div className="ad-servers-box">
              <div className="ad-servers-header">
                <Server size={15} color="#38bdf8" />
                <span>Multi-Source Streaming Providers</span>
              </div>
              <div className="mt-3">
                {serversLoading ? (
                  <span style={{ fontSize: '0.85rem', color: '#64748b' }}>Checking provider availability...</span>
                ) : groupedProviders.length > 0 ? (
                  <div className="ad-providers-grid">
                    {groupedProviders.map((p) => {
                      const isSelected = selectedProviderId === p.id;
                      const isUnavailable = p.status === 'unavailable';
                      return (
                        <button
                          key={p.id}
                          type="button"
                          disabled={isUnavailable}
                          onClick={() => {
                            setSelectedProviderId(p.id);
                            navigate(getWatchUrl(targetEp, p.id));
                          }}
                          className={`ad-provider-card${isSelected ? ' is-selected' : ''}${isUnavailable ? ' is-unavailable' : ''}`}
                        >
                          <div className="ad-provider-top">
                            <span className="ad-provider-icon">{getProviderIcon(p.id)}</span>
                            {isUnavailable ? (
                              <span className="ad-provider-badge ad-provider-badge--unavailable">
                                <span className="ad-provider-pulse-dot" />
                                <span>Unavailable</span>
                              </span>
                            ) : isSelected ? (
                              <span className="ad-provider-badge ad-provider-badge--selected">
                                <span className="ad-provider-pulse-dot" />
                                <span>Selected</span>
                              </span>
                            ) : (
                              <span className="ad-provider-badge ad-provider-badge--ready">
                                <span className="ad-provider-pulse-dot" />
                                <span>Ready</span>
                              </span>
                            )}
                          </div>
                          <div className="ad-provider-body">
                            <span className="ad-provider-name">{p.name}</span>
                          </div>
                          <div className="ad-provider-meta">
                            {isUnavailable ? (
                              <span className="ad-provider-reason" title={p.unavailableReason}>
                                {p.unavailableReason || 'Offline'}
                              </span>
                            ) : (
                              <>
                                <span className="ad-provider-mirrors">
                                  <Layers size={12} className="opacity-70" />
                                  <span>{p.mirrorCount} Mirror{p.mirrorCount === 1 ? '' : 's'}</span>
                                </span>
                                <div className="ad-provider-tags">
                                  <span className="ad-provider-tag ad-provider-tag--sub">SUB</span>
                                  {p.hasDub && <span className="ad-provider-tag ad-provider-tag--dub">DUB</span>}
                                </div>
                              </>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <span style={{ fontSize: '0.85rem', color: '#64748b' }}>Fast Edge CDN & P2P available on player</span>
                )}
              </div>
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
                  to={`/watch/${anime.id}/${n}`}
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
