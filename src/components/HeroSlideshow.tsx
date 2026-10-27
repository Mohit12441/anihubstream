import { useEffect, useRef, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Play, Info, ChevronLeft, ChevronRight, Flame, Star, Sparkles } from 'lucide-react';
import { Embers } from './Embers';
import { genreIcon } from './genreIcons';
import { artKeyUrl } from '../data/model';
import type { Anime, Genre } from '../data/model';
import { usePrefersReducedMotion } from '../lib/motion';

interface Props {
  items: Anime[];
  genres: Genre[];
}

const AUTOPLAY_DELAY_MS = 6000;

export function HeroSlideshow({ items, genres }: Props) {
  const reduced = usePrefersReducedMotion();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const containerRef = useRef<HTMLElement>(null);
  const touchStartX = useRef<number | null>(null);

  const activeItems = items.length > 0 ? items.slice(0, 8) : [];
  const count = activeItems.length;

  const nextSlide = useCallback(() => {
    if (count <= 1) return;
    setCurrentIndex((prev) => (prev + 1) % count);
  }, [count]);

  const prevSlide = useCallback(() => {
    if (count <= 1) return;
    setCurrentIndex((prev) => (prev - 1 + count) % count);
  }, [count]);

  // Autoplay timer
  useEffect(() => {
    if (reduced || isPaused || count <= 1) return;

    timerRef.current = setInterval(() => {
      nextSlide();
    }, AUTOPLAY_DELAY_MS);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [reduced, isPaused, count, nextSlide, currentIndex]);

  // Pause when document is hidden (user switched tabs) or hero is scrolled out of viewport
  useEffect(() => {
    const onVisibilityChange = () => {
      setIsPaused(document.hidden);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) {
          setIsPaused(!entry.isIntersecting);
        }
      },
      { threshold: 0.15 }
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      observer.disconnect();
    };
  }, []);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      prevSlide();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      nextSlide();
    }
  };

  // Touch swipe support for mobile
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const touchEndX = e.changedTouches[0].clientX;
    const diff = touchStartX.current - touchEndX;
    if (Math.abs(diff) > 40) {
      if (diff > 0) nextSlide();
      else prevSlide();
    }
    touchStartX.current = null;
  };

  // Preload next slide backdrop for instantaneous transition
  useEffect(() => {
    if (count <= 1) return;
    const nextIdx = (currentIndex + 1) % count;
    const nextAnime = activeItems[nextIdx];
    if (nextAnime) {
      const imgUrl = nextAnime.key ? artKeyUrl(nextAnime.key) : nextAnime.poster ? artKeyUrl(nextAnime.poster) : '';
      if (imgUrl) {
        const img = new Image();
        img.src = imgUrl;
      }
    }
  }, [currentIndex, count, activeItems]);

  if (count === 0) {
    return (
      <section className="hero-slideshow hero-slideshow--empty" aria-label="Featured Anime Slideshow">
        <div className="hero-slideshow__skeleton shell">
          <div className="hero-slideshow__skeleton-pill" />
          <div className="hero-slideshow__skeleton-title" />
          <div className="hero-slideshow__skeleton-meta" />
          <div className="hero-slideshow__skeleton-copy" />
        </div>
      </section>
    );
  }

  const current = activeItems[currentIndex];
  const accentColor = current.accent || '#ff1f4a';
  const genresToShow = genres.slice(0, 8);

  return (
    <section
      ref={containerRef}
      className="hero-slideshow"
      aria-label="Trending Anime Slideshow"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onFocus={() => setIsPaused(true)}
      onBlur={() => setIsPaused(false)}
      onKeyDown={handleKeyDown}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      tabIndex={0}
      style={{ '--hero-accent': accentColor } as React.CSSProperties}
    >
      {/* Background slide backdrops */}
      <div className="hero-slideshow__backdrop-layer">
        {activeItems.map((anime, idx) => {
          const isActive = idx === currentIndex;
          const bgUrl = anime.key ? artKeyUrl(anime.key) : anime.poster ? artKeyUrl(anime.poster) : '';
          return (
            <div
              key={anime.id}
              className={`hero-slideshow__bg-slide ${isActive ? 'hero-slideshow__bg-slide--active' : ''}`}
              aria-hidden={!isActive}
            >
              {bgUrl && (
                <img
                  src={bgUrl}
                  alt=""
                  aria-hidden="true"
                  fetchPriority={idx === 0 ? 'high' : 'low'}
                  decoding="async"
                  className="hero-slideshow__bg-img"
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Cinematic gradient overlays & vignettes */}
      <div className="hero-slideshow__scrim" />
      <div className="hero-slideshow__vignette" />
      <Embers count={22} tone="crimson" className="hero-slideshow__embers" />

      {/* Japanese typography background branding */}
      <div className="vj hero-slideshow__vj" aria-hidden="true">
        <span className="vj__jp" lang="ja">
          {current.native || '人気アニメ'}
        </span>
        <span className="vj__en">{current.title}</span>
      </div>

      {/* Main Slide Content */}
      <div className="hero-slideshow__inner shell">
        <div className="hero-slideshow__content" key={current.id}>
          {/* Trending rank badge */}
          <div className="hero-slideshow__badge-row">
            <span className="hero-slideshow__rank-badge">
              <Flame size={15} aria-hidden="true" className="hero-slideshow__rank-icon" />
              <span>#{currentIndex + 1} Trending This Week</span>
            </span>
            {current.status === 'Ongoing' && (
              <span className="hero-slideshow__status-badge">ONGOING</span>
            )}
          </div>

          {/* Title */}
          <h1 className="hero-slideshow__title">
            <Link to={`/anime/${current.id}`} className="hero-slideshow__title-link">
              {current.title}
            </Link>
          </h1>

          {/* Metadata badges (Rating, Year, Format, Episode Count) */}
          <div className="hero-slideshow__meta">
            {current.rating > 0 && (
              <span className="hero-slideshow__meta-item hero-slideshow__meta-item--rating">
                <Star size={14} fill="currentColor" aria-hidden="true" />
                <span>{current.rating.toFixed(1)}</span>
              </span>
            )}
            {current.year > 0 && (
              <span className="hero-slideshow__meta-item">{current.year}</span>
            )}
            {current.kind && (
              <span className="hero-slideshow__meta-item hero-slideshow__meta-item--kind">
                {current.kind}
              </span>
            )}
            <span className="hero-slideshow__meta-item">
              {current.episodeCount > 0
                ? `${current.episodeCount} ${current.episodeCount === 1 ? 'Episode' : 'Episodes'}`
                : current.episodeTotal
                ? `${current.episodeTotal} Episodes`
                : 'Full Season'}
            </span>
            {current.genres && current.genres.length > 0 && (
              <div className="hero-slideshow__tags">
                {current.genres.slice(0, 3).map((g) => (
                  <Link
                    key={g}
                    to={`/anime?genre=${encodeURIComponent(g.toLowerCase())}`}
                    className="hero-slideshow__tag-pill"
                  >
                    {g}
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Synopsis */}
          <p className="hero-slideshow__synopsis">{current.synopsis}</p>

          {/* Action CTA Buttons */}
          <div className="hero-slideshow__actions">
            <Link
              to={`/watch/${current.id}/1`}
              className="btn btn--primary hero-slideshow__btn-watch"
            >
              <Play size={18} fill="currentColor" strokeWidth={0} aria-hidden="true" />
              <span>Watch Now</span>
            </Link>
            <Link
              to={`/anime/${current.id}`}
              className="btn btn--ghost hero-slideshow__btn-details"
            >
              <Info size={17} aria-hidden="true" />
              <span>Details</span>
            </Link>
          </div>
        </div>

        {/* Carousel controls & pagination */}
        <div className="hero-slideshow__controls">
          <div className="hero-slideshow__arrows">
            <button
              type="button"
              className="hero-slideshow__arrow-btn"
              onClick={prevSlide}
              aria-label="Previous trending anime"
            >
              <ChevronLeft size={20} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="hero-slideshow__arrow-btn"
              onClick={nextSlide}
              aria-label="Next trending anime"
            >
              <ChevronRight size={20} aria-hidden="true" />
            </button>
          </div>

          {/* Slide indicator dots */}
          <div className="hero-slideshow__indicators" role="tablist" aria-label="Slideshow pages">
            {activeItems.map((item, idx) => {
              const isActive = idx === currentIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-label={`Go to slide ${idx + 1}: ${item.title}`}
                  className={`hero-slideshow__dot ${isActive ? 'hero-slideshow__dot--active' : ''}`}
                  onClick={() => setCurrentIndex(idx)}
                >
                  {isActive && !isPaused && !reduced && (
                    <span
                      className="hero-slideshow__dot-fill"
                      style={{ animationDuration: `${AUTOPLAY_DELAY_MS}ms` }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Direct Genre Navigation Strip */}
      <div className="hero-slideshow__genre-strip shell">
        <div className="hero-slideshow__genre-strip-inner" role="navigation" aria-label="Explore Anime by Genre">
          <span className="hero-slideshow__genre-label">
            <Sparkles size={14} aria-hidden="true" />
            <span>Explore Genres:</span>
          </span>
          <div className="hero-slideshow__genre-list">
            {genresToShow.map((g) => {
              const Icon = genreIcon(g.id);
              return (
                <Link
                  key={g.id}
                  to={`/anime?genre=${encodeURIComponent(g.id)}`}
                  className="hero-slideshow__genre-pill"
                  style={{ '--pc': g.accent } as React.CSSProperties}
                  title={`Browse all ${g.label} anime`}
                >
                  <span className="hero-slideshow__genre-icon">
                    <Icon size={14} aria-hidden="true" />
                  </span>
                  <span>{g.label}</span>
                </Link>
              );
            })}
            <Link to="/genres" className="hero-slideshow__genre-pill hero-slideshow__genre-pill--all">
              <span>All Genres &rarr;</span>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
