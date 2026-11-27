import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Play, Film, ExternalLink, Info } from 'lucide-react';
import { cleanAnimeTitle, type Anime } from '../data/model';
import { soundFx } from '../lib/soundFx';
import '../styles/trailer-modal.css';

export function TrailerModal() {
  const [anime, setAnime] = useState<Anime | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const handleOpen = (e: Event) => {
      const custom = e as CustomEvent<Anime>;
      if (custom.detail) {
        setAnime(custom.detail);
        soundFx.playChime();
      }
    };

    window.addEventListener('anihub:open-trailer', handleOpen);
    return () => window.removeEventListener('anihub:open-trailer', handleOpen);
  }, []);

  useEffect(() => {
    if (!anime) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAnime(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [anime]);

  if (!anime) return null;

  const cleanTitle = cleanAnimeTitle(anime.title);
  const isUpcoming = anime.status === 'Upcoming' || anime.status === 'NOT_YET_RELEASED';

  const getTrailerEmbedUrl = (a: Anime) => {
    const raw = a.trailer?.trim();
    if (raw) {
      if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) {
        return `https://www.youtube-nocookie.com/embed/${raw}?autoplay=1&rel=0&modestbranding=1`;
      }
      const match = raw.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
      if (match && match[1]) {
        return `https://www.youtube-nocookie.com/embed/${match[1]}?autoplay=1&rel=0&modestbranding=1`;
      }
    }
    const query = encodeURIComponent(`${cleanTitle} official anime trailer`);
    return `https://www.youtube-nocookie.com/embed?listType=search&list=${query}&autoplay=1&rel=0&modestbranding=1`;
  };

  const embedUrl = getTrailerEmbedUrl(anime);
  const youtubeSearchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(cleanTitle + ' anime trailer')}`;

  const handleWatchNow = () => {
    soundFx.playClick();
    setAnime(null);
    navigate(isUpcoming ? `/anime/${anime.id}` : `/watch/${anime.id}/1`);
  };

  const handleViewDetails = () => {
    soundFx.playClick();
    setAnime(null);
    navigate(`/anime/${anime.id}`);
  };

  return (
    <div
      className="trailer-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`${cleanTitle} Trailer`}
      onClick={() => setAnime(null)}
    >
      <div className="trailer-modal" onClick={(e) => e.stopPropagation()}>
        <div className="trailer-modal__header">
          <div className="trailer-modal__title-row">
            <Film size={18} className="trailer-modal__film-icon" aria-hidden="true" />
            <h2 className="trailer-modal__title">{cleanTitle}</h2>
            <span className="trailer-modal__badge">Official Trailer</span>
          </div>
          <button
            type="button"
            className="trailer-modal__close-btn"
            onClick={() => setAnime(null)}
            aria-label="Close trailer"
          >
            <X size={20} />
          </button>
        </div>

        <div className="trailer-modal__player-wrap">
          <iframe
            src={embedUrl}
            title={`${cleanTitle} Official Trailer`}
            className="trailer-modal__iframe"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        </div>

        <div className="trailer-modal__footer">
          <div className="trailer-modal__meta">
            {anime.rating > 0 && <span className="trailer-modal__rating">★ {anime.rating.toFixed(1)}</span>}
            {anime.year > 0 && <span>{anime.year}</span>}
            {anime.kind && <span className="trailer-modal__kind">{anime.kind}</span>}
          </div>

          <div className="trailer-modal__actions">
            <a
              href={youtubeSearchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="trailer-modal__btn-ext"
              title="Open in YouTube"
            >
              <ExternalLink size={15} />
              <span>YouTube</span>
            </a>

            <button
              type="button"
              className="trailer-modal__btn-details"
              onClick={handleViewDetails}
            >
              <Info size={16} />
              <span>Details</span>
            </button>

            <button
              type="button"
              className="trailer-modal__btn-watch"
              onClick={handleWatchNow}
            >
              <Play size={16} fill="currentColor" strokeWidth={0} />
              <span>{isUpcoming ? 'View Series' : 'Watch Episode 1'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
