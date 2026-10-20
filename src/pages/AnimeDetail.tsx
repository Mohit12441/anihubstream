import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BookmarkPlus, Calendar, ChevronRight, Clock, Film, Heart, Play, Server, Star } from 'lucide-react';
import { useAnimeDetail, useCatalogue } from '../state/catalogue';
import { useLibrary } from '../state/library';
import { useSEO } from '../lib/useSEO';
import { CatalogueError, CatalogueLoading } from '../components/CatalogueState';
import { AnimeCard } from '../components/AnimeCard';
import { ratingLabel } from '../data/model';
import { SLUG_REDIRECTS } from '../data/redirects';
import '../styles/watch.css';

interface ServerPreview {
  name: string;
  status: string;
}

export function AnimeDetail() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();

  useEffect(() => {
    if (id && SLUG_REDIRECTS[id]) {
      navigate(`/anime/${SLUG_REDIRECTS[id]}`, { replace: true });
    }
  }, [id, navigate]);

  const { status, error, missing, anime, related, reload } = useAnimeDetail(id);
  const { genreLabel } = useCatalogue();
  const { has, isBusy, toggle, favourites, toggleFavourite } = useLibrary();

  const [servers, setServers] = useState<ServerPreview[]>([]);
  const [serversLoading, setServersLoading] = useState(true);

  // Fetch servers available for episode 1
  useEffect(() => {
    if (!id) return;
    let active = true;
    setServersLoading(true);

    fetch(`/api/play?id=${encodeURIComponent(id)}&ep=1`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active || !data) return;
        if (Array.isArray(data.servers)) {
          setServers(data.servers.map((s: { name?: string; status?: string }) => ({
            name: s.name || 'HD Server',
            status: s.status || 'ready',
          })));
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setServersLoading(false);
      });

    return () => {
      active = false;
    };
  }, [id]);

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

  const inList = has(anime.id);
  const isFav = favourites.has(anime.id);
  const epCount = anime.episodes?.length || anime.episodeCount || 1;
  const ratingFormatted = anime.rating ? (anime.rating > 10 ? (anime.rating / 10).toFixed(1) : anime.rating.toFixed(1)) : '—';

  return (
    <div className="watch-page" style={{ paddingBottom: '4rem' }}>
      {/* Hero Banner Backdrop */}
      <div
        className="watch-backdrop"
        style={{
          backgroundImage: `url(${anime.poster})`,
          height: '340px',
          filter: 'blur(32px) brightness(0.28)',
        }}
      />

      <div className="watch-shell" style={{ position: 'relative', zIndex: 2, paddingTop: '1.5rem' }}>
        {/* Breadcrumb Navigation */}
        <nav className="watch-breadcrumb" aria-label="Breadcrumb">
          <Link to="/">Home</Link>
          <ChevronRight size={14} />
          <Link to="/anime">Anime</Link>
          <ChevronRight size={14} />
          <span aria-current="page">{anime.title}</span>
        </nav>

        {/* Anime Header Card */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: '2rem',
            background: 'rgba(15, 17, 23, 0.75)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '16px',
            padding: '2rem',
            backdropFilter: 'blur(20px)',
            marginTop: '1rem',
          }}
        >
          {/* Poster Column */}
          <div style={{ maxWidth: '280px', margin: '0 auto', width: '100%' }}>
            <img
              src={anime.poster}
              alt={anime.title}
              style={{
                width: '100%',
                borderRadius: '12px',
                boxShadow: '0 12px 36px rgba(0,0,0,0.6)',
                aspectRatio: '2/3',
                objectFit: 'cover',
              }}
            />
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
              <button
                type="button"
                className={`watch-action-btn ${inList ? 'active' : ''}`}
                onClick={() => toggle(anime.id)}
                disabled={isBusy(anime.id)}
                style={{ flex: 1, justifyContent: 'center' }}
              >
                <BookmarkPlus size={16} />
                <span>{inList ? 'In Watchlist' : 'Add to Watchlist'}</span>
              </button>
              <button
                type="button"
                className={`watch-action-btn ${isFav ? 'active' : ''}`}
                onClick={() => toggleFavourite(anime.id)}
                title="Favorite"
              >
                <Heart size={16} fill={isFav ? 'currentColor' : 'none'} />
              </button>
            </div>
          </div>

          {/* Metadata & Actions Column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              {anime.native && (
                <div lang="ja" style={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.9rem', marginBottom: '0.25rem' }}>
                  {anime.native}
                </div>
              )}
              <h1 style={{ fontSize: '2rem', fontWeight: 800, margin: '0 0 0.5rem', lineHeight: 1.2 }}>
                {anime.title}
              </h1>
            </div>

            {/* Badges Row */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', alignItems: 'center' }}>
              <span className="badge" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', background: 'rgba(234, 179, 8, 0.15)', color: '#eab308' }}>
                <Star size={14} fill="currentColor" />
                {ratingFormatted} {ratingLabel(anime.rating)}
              </span>
              <span className="badge" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                <Film size={14} />
                {anime.kind || 'TV'} · {epCount} EP
              </span>
              {anime.year && (
                <span className="badge" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                  <Calendar size={14} />
                  {anime.year}
                </span>
              )}
              {anime.status && (
                <span className="badge" style={{ textTransform: 'capitalize' }}>
                  {anime.status}
                </span>
              )}
            </div>

            {/* Genres */}
            {anime.genres && anime.genres.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.25rem' }}>
                {anime.genres.map((g) => (
                  <Link
                    key={g}
                    to={`/genres?genre=${encodeURIComponent(g)}`}
                    className="pill-tag"
                    style={{ fontSize: '0.8rem', padding: '0.25rem 0.6rem', textDecoration: 'none' }}
                  >
                    {genreLabel(g)}
                  </Link>
                ))}
              </div>
            )}

            {/* Synopsis */}
            <div style={{ marginTop: '0.5rem' }}>
              <h3 style={{ fontSize: '1.05rem', fontWeight: 600, marginBottom: '0.4rem' }}>Synopsis</h3>
              <p style={{ color: 'rgba(255, 255, 255, 0.8)', fontSize: '0.95rem', lineHeight: 1.6, margin: 0 }}>
                {anime.synopsis || 'No synopsis available for this title.'}
              </p>
            </div>

            {/* Play CTA Button */}
            <div style={{ marginTop: '1rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
              <Link
                to={`/watch/${anime.id}/1`}
                className="btn-primary"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.6rem',
                  padding: '0.85rem 1.75rem',
                  borderRadius: '12px',
                  fontWeight: 700,
                  fontSize: '1.05rem',
                  textDecoration: 'none',
                }}
              >
                <Play size={18} fill="currentColor" />
                <span>Watch Episode 1</span>
              </Link>
            </div>

            {/* Available Servers Preview */}
            <div style={{ marginTop: '0.5rem', padding: '1rem', background: 'rgba(0,0,0,0.3)', borderRadius: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <Server size={16} color="#60a5fa" />
                <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>Streaming Providers & Servers</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {serversLoading ? (
                  <span style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.5)' }}>Checking server availability...</span>
                ) : servers.length > 0 ? (
                  servers.map((s) => (
                    <span
                      key={s.name}
                      style={{
                        fontSize: '0.8rem',
                        padding: '0.2rem 0.6rem',
                        borderRadius: '6px',
                        background: 'rgba(255,255,255,0.06)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.3rem',
                      }}
                    >
                      <span
                        style={{
                          width: '6px',
                          height: '6px',
                          borderRadius: '50%',
                          background: s.status === 'ready' ? '#22c55e' : '#f59e0b',
                        }}
                      />
                      {s.name}
                    </span>
                  ))
                ) : (
                  <span style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.5)' }}>Multi-source servers available on player</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Episodes Section */}
        <section style={{ marginTop: '2.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 700, margin: 0 }}>
              Episodes ({anime.episodes?.length || epCount})
            </h2>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: '1rem',
            }}
          >
            {anime.episodes && anime.episodes.length > 0 ? (
              anime.episodes.map((ep) => (
                <Link
                  key={ep.n}
                  to={`/watch/${anime.id}/${ep.n}`}
                  className="episode-card"
                  style={{
                    display: 'flex',
                    gap: '0.75rem',
                    padding: '0.75rem',
                    background: 'rgba(15, 17, 23, 0.6)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '10px',
                    textDecoration: 'none',
                    color: 'inherit',
                    transition: 'all 0.2s ease',
                  }}
                >
                  {ep.thumb && (
                    <img
                      src={ep.thumb}
                      alt={ep.title || `Episode ${ep.n}`}
                      style={{
                        width: '100px',
                        height: '62px',
                        borderRadius: '6px',
                        objectFit: 'cover',
                        flexShrink: 0,
                      }}
                      loading="lazy"
                    />
                  )}
                  <div style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.2rem' }}>
                      EP {ep.n}: {ep.title || `Episode ${ep.n}`}
                    </div>
                    {ep.runtime && (
                      <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.5)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <Clock size={12} />
                        {ep.runtime}
                      </div>
                    )}
                  </div>
                </Link>
              ))
            ) : (
              // Fallback numerical episode grid
              Array.from({ length: epCount }, (_, i) => i + 1).map((n) => (
                <Link
                  key={n}
                  to={`/watch/${anime.id}/${n}`}
                  style={{
                    padding: '1rem',
                    background: 'rgba(15, 17, 23, 0.6)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '10px',
                    textDecoration: 'none',
                    color: 'inherit',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <span style={{ fontWeight: 600 }}>Episode {n}</span>
                  <Play size={16} color="#60a5fa" />
                </Link>
              ))
            )}
          </div>
        </section>

        {/* Related Titles */}
        {related && related.length > 0 && (
          <section style={{ marginTop: '3rem' }}>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: '1.25rem' }}>You Might Also Like</h2>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                gap: '1.25rem',
              }}
            >
              {related.slice(0, 6).map((item) => (
                <AnimeCard key={item.id} anime={item} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
