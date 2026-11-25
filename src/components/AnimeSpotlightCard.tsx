// @ts-check
import { Link } from 'react-router-dom';
import { Play, Star, Sparkles, Tv, ShieldCheck } from 'lucide-react';
import type { ResolvedAnime } from '../data/animeResolver';
import '../styles/news.css';

interface Props {
  anime: ResolvedAnime;
  variant?: 'inline-banner' | 'compact-chip' | 'live-badge';
  subtitle?: string;
  className?: string;
}

export function AnimeSpotlightCard({ anime, variant = 'inline-banner', subtitle, className = '' }: Props) {
  if (variant === 'compact-chip') {
    return (
      <Link
        to={anime.streamUrl}
        className={`anime-spotlight-chip ${className}`}
        title={`Stream ${anime.title} on AniHubStream`}
      >
        <img
          src={anime.art}
          alt={anime.title}
          className="anime-spotlight-chip__thumb"
          loading="lazy"
          decoding="async"
        />
        <span className="anime-spotlight-chip__title">{anime.title}</span>
        {anime.rating && (
          <span className="anime-spotlight-chip__rating">
            <Star size={11} fill="currentColor" /> {anime.rating}
          </span>
        )}
      </Link>
    );
  }

  if (variant === 'live-badge') {
    return (
      <div className={`anime-live-spotlight ${className}`}>
        <div className="anime-live-spotlight__media">
          <img
            src={anime.art}
            alt={anime.title}
            className="anime-live-spotlight__poster"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div className="anime-live-spotlight__body">
          <div className="anime-live-spotlight__header">
            <span className="pill pill--xs" style={{ background: 'rgba(255, 31, 74, 0.2)', color: 'var(--crimson-soft)', fontWeight: 700, border: '1px solid rgba(255, 31, 74, 0.4)' }}>
              FEATURED SERIES
            </span>
            <span className="anime-live-spotlight__rating">
              <Star size={12} fill="currentColor" style={{ color: 'var(--gold)' }} /> {anime.rating}
            </span>
          </div>

          <h4 className="anime-live-spotlight__title">
            <Link to={anime.streamUrl}>{anime.title}</Link>
          </h4>

          {anime.genres && (
            <div className="anime-live-spotlight__genres">
              {anime.genres.slice(0, 3).map((g) => (
                <span key={g} className="anime-genre-tag">{g}</span>
              ))}
            </div>
          )}

          <div className="anime-live-spotlight__footer">
            <Link to={anime.streamUrl} className="btn btn--xs btn--primary anime-stream-btn">
              <Play size={12} fill="currentColor" /> Stream on AniHub
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Default: 'inline-banner' (used inside articles and hero showcases)
  return (
    <div className={`anime-spotlight-banner ${className}`}>
      <div className="anime-spotlight-banner__backdrop" style={{ backgroundImage: anime.banner ? `url(${anime.banner})` : undefined }} />
      <div className="anime-spotlight-banner__overlay" />

      <div className="anime-spotlight-banner__inner">
        {/* Anime Poster Picture */}
        <Link to={anime.streamUrl} className="anime-spotlight-banner__poster-wrap">
          <img
            src={anime.art}
            alt={anime.title}
            className="anime-spotlight-banner__poster"
            loading="lazy"
            decoding="async"
          />
          <div className="anime-spotlight-banner__play-hover">
            <Play size={24} fill="#fff" />
          </div>
        </Link>

        {/* Anime Details & Name */}
        <div className="anime-spotlight-banner__content">
          <div className="anime-spotlight-banner__tags">
            <span className="pill pill--sm" style={{ background: 'var(--crimson)', color: '#fff', fontWeight: 800 }}>
              <Tv size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} /> {anime.format}
            </span>
            <span className="pill pill--sm" style={{ background: 'rgba(36, 211, 238, 0.15)', color: 'var(--cyan)', border: '1px solid rgba(36, 211, 238, 0.3)', fontWeight: 700 }}>
              <Sparkles size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} /> {anime.status}
            </span>
            <span className="anime-spotlight-banner__score">
              <Star size={13} fill="currentColor" style={{ color: 'var(--gold)', marginRight: 4 }} />
              <b>{anime.rating}</b> / 10
            </span>
          </div>

          <h3 className="anime-spotlight-banner__title">
            <Link to={anime.streamUrl}>{anime.title}</Link>
          </h3>

          {anime.nativeTitle && (
            <div className="anime-spotlight-banner__native">{anime.nativeTitle}</div>
          )}

          <p className="anime-spotlight-banner__desc">
            {subtitle || anime.synopsis || `Watch ${anime.title} with 1080p Ultra HD streaming, synchronized multi-language subtitles, dual Japanese and English audio, and automated skip-intro markers.`}
          </p>

          <div className="anime-spotlight-banner__actions">
            <Link to={anime.streamUrl} className="btn btn--sm btn--primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
              <Play size={14} fill="currentColor" /> Watch on AniHubStream
            </Link>
            <div className="anime-spotlight-banner__perks">
              <span title="Full High Definition 1080p Streaming">
                <ShieldCheck size={14} style={{ color: 'var(--cyan)', verticalAlign: 'middle', marginRight: 4 }} />
                1080p Ultra HD • Sub &amp; Dub
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
