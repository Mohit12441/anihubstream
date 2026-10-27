import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, PlayCircle, X } from 'lucide-react';
import { getPositions, removePosition } from '../data/api';
import { artKeyUrl, cleanAnimeTitle, type ApiPosition } from '../data/model';
import { AnimeCarousel } from './AnimeCarousel';
import '../styles/continue-watching.css';

interface Props {
  onLoaded?: (positions: ApiPosition[]) => void;
}

export function ContinueWatchingRow({ onLoaded }: Props) {
  const [positions, setPositions] = useState<ApiPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    getPositions()
      .then((res) => {
        if (!active) return;
        setPositions(res.items || []);
        onLoaded?.(res.items || []);
      })
      .catch(() => {
        if (active) setPositions([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [onLoaded]);

  const handleDismiss = async (e: React.MouseEvent, episodeId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setPositions((prev) => prev.filter((p) => p.episodeId !== episodeId));
    try {
      await removePosition(episodeId);
    } catch {
      // ignore
    }
  };

  if (loading || positions.length === 0) {
    return null;
  }

  return (
    <section className="home__row continue-watching" aria-labelledby="row-continue">
      <div className="sec-head">
        <h2 id="row-continue">
          <PlayCircle size={21} aria-hidden="true" style={{ color: 'var(--crimson, #ff1f4a)' }} />
          Continue Watching
        </h2>
        <span className="sec-head__hint">Jump straight back into your active shows</span>
      </div>

      <AnimeCarousel label="Continue Watching">
        {positions.map((item) => {
          const anime = item.anime;
          const animeId = anime?.id || item.episodeId.split('#')[0];
          const title = cleanAnimeTitle(anime?.title || animeId);
          const thumb = artKeyUrl(item.episodeArt || anime?.keyArt || anime?.art);
          const duration = item.runtimeSeconds || 1440;
          const progressPercent = Math.min(100, Math.max(5, Math.round((item.seconds / duration) * 100)));
          const secondsLeft = Math.max(0, duration - item.seconds);
          const minutesLeft = Math.ceil(secondsLeft / 60);

          return (
            <article
              key={item.episodeId}
              className="cw-card"
              onClick={() => navigate(`/watch/${encodeURIComponent(animeId)}/${item.episodeNumber}?time=${Math.floor(item.seconds)}`)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  navigate(`/watch/${encodeURIComponent(animeId)}/${item.episodeNumber}?time=${Math.floor(item.seconds)}`);
                }
              }}
              aria-label={`Resume ${title} Episode ${item.episodeNumber}`}
            >
              <div className="cw-card__thumb-box">
                <img
                  src={thumb}
                  alt=""
                  aria-hidden="true"
                  className="cw-card__img"
                  loading="lazy"
                  decoding="async"
                />
                <div className="cw-card__overlay">
                  <span className="cw-card__play-btn" aria-hidden="true">
                    <Play size={20} fill="currentColor" />
                  </span>
                </div>

                <button
                  type="button"
                  className="cw-card__dismiss"
                  onClick={(e) => handleDismiss(e, item.episodeId)}
                  title="Remove from history"
                  aria-label={`Remove ${title} from continue watching`}
                >
                  <X size={14} />
                </button>

                <div className="cw-card__progress-track" aria-hidden="true">
                  <div className="cw-card__progress-bar" style={{ width: `${progressPercent}%` }} />
                </div>
              </div>

              <div className="cw-card__meta">
                <h3 className="cw-card__title" title={title}>
                  {title}
                </h3>
                <div className="cw-card__sub">
                  <span className="cw-card__ep">EP {item.episodeNumber}</span>
                  <span className="cw-card__dot" aria-hidden="true">·</span>
                  <span className="cw-card__left">
                    {minutesLeft > 1 ? `${minutesLeft}m left` : 'Ending'}
                  </span>
                </div>
              </div>
            </article>
          );
        })}
      </AnimeCarousel>
    </section>
  );
}
