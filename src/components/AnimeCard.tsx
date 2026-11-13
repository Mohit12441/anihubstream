import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Info, Play, Star } from 'lucide-react';
import { Art } from './Art';
import { AiringCountdown } from './AiringCountdown';
import { stamp } from '../lib/time';
import { type Anime, cleanAnimeTitle } from '../data/model';
import { CardMeta } from './CardMeta';
import { useCatalogue } from '../state/catalogue';
import { useLibrary } from '../state/library';
import { warmStreamOrigins } from '../lib/warmConnections';
import { soundFx } from '../lib/soundFx';

interface Props {
  anime: Anime;
  variant?: 'key' | 'poster' | 'wide';
  rank?: number;
  badge?: string;
  episode?: string;
  provider?: string;
}

const rankTint = ['#8fe9ff', '#b57bff', '#ff5470', '#ff9420', '#ffc247'];

export function AnimeCard({ anime, variant = 'key', rank, badge, episode }: Props) {
  const { genreLabel } = useCatalogue();
  const { history } = useLibrary();
  const resume = history.find((h) => h.anime.id === anime.id);
  const cleanTitle = cleanAnimeTitle(anime.title);
  const to = `/anime/${anime.id}`;
  const tint = rank ? rankTint[(rank - 1) % rankTint.length] : anime.accent;

  const hoverTimer = useRef<number | null>(null);
  const previewTimer = useRef<number | null>(null);
  const [videoPreview, setVideoPreview] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const handleMouseEnter = () => {
    hoverTimer.current = window.setTimeout(() => {
      warmStreamOrigins();
    }, 300);

    if (anime.trailer) {
      previewTimer.current = window.setTimeout(() => {
        setVideoPreview(true);
      }, 1300);
    }
  };

  const handleMouseLeave = () => {
    if (hoverTimer.current) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    if (previewTimer.current) {
      window.clearTimeout(previewTimer.current);
      previewTimer.current = null;
    }
    setVideoPreview(false);
  };

  if (variant === 'poster') {
    return (
      <Link
        to={to}
        className="acard acard--poster"
        style={{ '--tint': anime.accent } as React.CSSProperties}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <div className="acard__media acard__media--poster">
          <Art sources={[anime.poster, anime.key]} alt={`${anime.title} poster art`} fill width={280} height={400} />
          {videoPreview && anime.trailer && (
            <video
              ref={videoRef}
              className="acard__preview-video"
              src={anime.trailer}
              autoPlay
              loop
              muted={soundFx.isMuted()}
              playsInline
              onError={() => setVideoPreview(false)}
              onCanPlay={() => {
                if (videoRef.current && !soundFx.isMuted()) {
                  videoRef.current.volume = 0.15;
                }
              }}
            />
          )}
          <div className="acard__scrim" />
          {badge ? (
            <span className="acard__flag">{badge}</span>
          ) : (
            anime.schedule?.day && anime.schedule?.time && (
              <AiringCountdown anime={anime} variant="compact" showRemindMe={false} />
            )
          )}
          {/* A title the databases have no score for yet shows no score rather than a zero. */}
          {anime.rating > 0 && (
            <span className="acard__rating">
              <Star size={11} fill="currentColor" strokeWidth={0} aria-hidden="true" />
              {(anime.rating > 10 ? anime.rating / 10 : anime.rating).toFixed(1)}
            </span>
          )}
          <span className="acard__play" aria-hidden="true">
            <Play size={18} fill="currentColor" strokeWidth={0} />
          </span>
          <button
            type="button"
            className="acard__info-btn"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              window.dispatchEvent(new CustomEvent('anihub:quick-view', { detail: anime }));
            }}
            aria-label={`Quick preview for ${cleanTitle}`}
            title="Quick preview"
          >
            <Info size={13} aria-hidden="true" />
          </button>
          {resume && resume.seconds > 0 && (
            <div className="acard__progress-track" aria-hidden="true">
              <div
                className="acard__progress-bar"
                style={{
                  width: `${Math.min(100, Math.max(5, Math.round((resume.seconds / 1440) * 100)))}%`,
                }}
              />
            </div>
          )}
        </div>
        <div className="acard__foot">
          <h3 className="acard__title">{cleanTitle}</h3>
          <CardMeta anime={anime} episode={episode} />
        </div>
      </Link>
    );
  }

  if (variant === 'wide') {
    return (
      <Link
        to={to}
        className="acard acard--wide"
        style={{ '--tint': anime.accent } as React.CSSProperties}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <div className="acard__media acard__media--wide">
          <Art sources={[anime.key, anime.poster]} alt={`${anime.title} key art`} fill width={320} height={180} />
          <div className="acard__scrim" />
        </div>
        <div className="acard__body">
          <div className="acard__row">
            <h3 className="acard__title">{cleanTitle}</h3>
            {badge && <span className="acard__flag acard__flag--inline">{badge}</span>}
          </div>
          <CardMeta anime={anime} episode={episode} />
          <p className="acard__syn">{anime.synopsis}</p>
          <div className="acard__tags">
            {anime.genres.slice(0, 3).map((g) => (
              <span key={g} className="badge">
                {genreLabel(g)}
              </span>
            ))}
          </div>
        </div>
        <span className="acard__go" aria-hidden="true">
          <ArrowRight size={17} />
        </span>
      </Link>
    );
  }

  return (
    <Link
      to={to}
      className={`acard acard--key${rank ? ' acard--ranked' : ''}`}
      style={{ '--tint': tint } as React.CSSProperties}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="acard__media acard__media--key">
        <Art sources={[anime.key, anime.poster]} alt={`${anime.title} key art`} fill width={360} height={202} />
        {videoPreview && anime.trailer && (
          <video
            ref={videoRef}
            className="acard__preview-video"
            src={anime.trailer}
            autoPlay
            loop
            muted={soundFx.isMuted()}
            playsInline
            onError={() => setVideoPreview(false)}
            onCanPlay={() => {
              if (videoRef.current && !soundFx.isMuted()) {
                videoRef.current.volume = 0.15;
              }
            }}
          />
        )}
        <div className="acard__scrim" />
        {badge ? (
          <span className="acard__flag">{badge}</span>
        ) : (
          anime.schedule?.day && anime.schedule?.time && (
            <AiringCountdown anime={anime} variant="compact" showRemindMe={false} />
          )
        )}
        <span className="acard__play" aria-hidden="true">
          <Play size={18} fill="currentColor" strokeWidth={0} />
        </span>
        <button
          type="button"
          className="acard__info-btn"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            window.dispatchEvent(new CustomEvent('anihub:quick-view', { detail: anime }));
          }}
          aria-label={`Quick preview for ${cleanTitle}`}
          title="Quick preview"
        >
          <Info size={13} aria-hidden="true" />
        </button>
        {resume && resume.seconds > 0 && (
          <div className="acard__progress-track" aria-hidden="true">
            <div
              className="acard__progress-bar"
              style={{
                width: `${Math.min(100, Math.max(5, Math.round((resume.seconds / 1440) * 100)))}%`,
              }}
            />
          </div>
        )}
      </div>
      <div className="acard__foot">
        {rank && (
          <span className="acard__rank" aria-label={`Rank ${rank}`}>
            {String(rank).padStart(2, '0')}
          </span>
        )}
        <div className="acard__names">
          <h3 className="acard__title">{cleanTitle}</h3>
          {resume ? (
            <p className="acard__meta">
              Resume EP {resume.episodeNumber} · {stamp(resume.seconds)}
            </p>
          ) : (
            <CardMeta anime={anime} episode={episode} />
          )}
        </div>
        <span className="acard__go" aria-hidden="true">
          <ArrowRight size={16} />
        </span>
      </div>
    </Link>
  );
}
