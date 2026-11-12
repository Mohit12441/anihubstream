import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bookmark, Check, Play, Star, X } from 'lucide-react';
import { Art } from './Art';
import { cleanAnimeTitle, type Anime } from '../data/model';
import { soundFx } from '../lib/soundFx';
import { useLibrary } from '../state/library';
import { useCatalogue } from '../state/catalogue';

export function QuickViewModal() {
  const [anime, setAnime] = useState<Anime | null>(null);
  const navigate = useNavigate();
  const { has, toggle: toggleWatchlist, history } = useLibrary();
  const { genreLabel } = useCatalogue();

  useEffect(() => {
    const handleQuickView = (e: Event) => {
      const custom = e as CustomEvent<Anime>;
      if (custom.detail) {
        setAnime(custom.detail);
        soundFx.playChime();
      }
    };

    window.addEventListener('anihub:quick-view', handleQuickView);
    return () => window.removeEventListener('anihub:quick-view', handleQuickView);
  }, []);

  useEffect(() => {
    if (!anime) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAnime(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [anime]);

  if (!anime) return null;

  const cleanTitle = cleanAnimeTitle(anime.title);
  const saved = has(anime.id);
  const resume = history.find((h) => h.anime.id === anime.id);
  const targetEp = resume?.episodeNumber && resume.episodeNumber > 0 ? resume.episodeNumber : 1;
  const isUpcoming = anime.status === 'Upcoming' || anime.status === 'NOT_YET_RELEASED';

  const handleWatch = () => {
    soundFx.playClick();
    setAnime(null);
    navigate(isUpcoming ? `/anime/${anime.id}` : `/watch/${anime.id}/${targetEp}`);
  };

  return (
    <div
      className="quick-view-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="qv-title"
      onClick={() => setAnime(null)}
    >
      <div className="quick-view-modal" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="quick-view-close"
          onClick={() => setAnime(null)}
          aria-label="Close preview"
        >
          <X size={18} />
        </button>

        <div className="quick-view-media">
          <Art
            sources={[anime.poster, anime.key]}
            alt={`${cleanTitle} poster`}
            fill
            width={280}
            height={400}
          />
          <div className="quick-view-scrim" />
        </div>

        <div className="quick-view-body">
          <div className="quick-view-tags">
            {anime.kind && <span className="badge badge--accent">{anime.kind}</span>}
            {anime.status && <span className="badge">{anime.status}</span>}
            {anime.year && <span className="badge">{anime.year}</span>}
            {anime.rating > 0 && (
              <span className="quick-view-rating">
                <Star size={13} fill="currentColor" strokeWidth={0} aria-hidden="true" />
                {(anime.rating > 10 ? anime.rating / 10 : anime.rating).toFixed(1)}
              </span>
            )}
          </div>

          <h2 id="qv-title" className="quick-view-title">
            {cleanTitle}
          </h2>

          {anime.native && <p className="quick-view-native">{anime.native}</p>}

          <p className="quick-view-synopsis">
            {anime.synopsis || 'No synopsis provided for this title.'}
          </p>

          <div className="quick-view-genres">
            {anime.genres.slice(0, 5).map((g) => (
              <span key={g} className="badge badge--subtle">
                {genreLabel(g)}
              </span>
            ))}
          </div>

          <div className="quick-view-actions">
            <button
              type="button"
              className="btn btn--primary quick-view-btn-watch"
              onClick={handleWatch}
            >
              <Play size={16} fill="currentColor" strokeWidth={0} />
              {isUpcoming ? 'View Details' : resume ? `Resume EP ${targetEp}` : 'Watch Episode 1'}
            </button>

            <button
              type="button"
              className={`btn btn--ghost ${saved ? 'is-saved' : ''}`}
              onClick={() => {
                soundFx.playClick();
                toggleWatchlist(anime.id);
              }}
              aria-label={saved ? 'Remove from Watchlist' : 'Add to Watchlist'}
            >
              {saved ? (
                <>
                  <Check size={16} /> Saved
                </>
              ) : (
                <>
                  <Bookmark size={16} /> Watchlist
                </>
              )}
            </button>

            <Link
              to={`/anime/${anime.id}`}
              className="btn btn--ghost"
              onClick={() => {
                soundFx.playClick();
                setAnime(null);
              }}
            >
              Full Details →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
