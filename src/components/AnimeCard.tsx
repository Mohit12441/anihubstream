import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Play, Star } from 'lucide-react';
import { Art } from './Art';
import { stamp } from '../lib/time';
import { type Anime } from '../data/model';
import { CardMeta } from './CardMeta';
import { useCatalogue } from '../state/catalogue';
import { useLibrary } from '../state/library';
import { warmStreamOrigins } from '../lib/warmConnections';

interface Props {
  anime: Anime;
  variant?: 'key' | 'poster' | 'wide';
  rank?: number;
  badge?: string;
  episode?: string;
}

const rankTint = ['#8fe9ff', '#b57bff', '#ff5470', '#ff9420', '#ffc247'];

export function AnimeCard({ anime, variant = 'key', rank, badge, episode }: Props) {
  const { genreLabel } = useCatalogue();
  const { history } = useLibrary();
  const resume = history.find((h) => h.anime.id === anime.id);
  const targetEp = resume?.episodeNumber && resume.episodeNumber > 0 ? resume.episodeNumber : 1;
  const to = `/watch/${anime.id}/${targetEp}`;
  const tint = rank ? rankTint[(rank - 1) % rankTint.length] : anime.accent;

  const hoverTimer = useRef<number | null>(null);
  const handleMouseEnter = () => {
    hoverTimer.current = window.setTimeout(() => {
      warmStreamOrigins();
    }, 300);
  };
  const handleMouseLeave = () => {
    if (hoverTimer.current) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
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
          <div className="acard__scrim" />
          {badge && <span className="acard__flag">{badge}</span>}
          {/* A title the databases have no score for yet shows no score rather than a zero. */}
          {anime.rating > 0 && (
            <span className="acard__rating">
              <Star size={11} fill="currentColor" strokeWidth={0} aria-hidden="true" />
              {anime.rating.toFixed(1)}
            </span>
          )}
          <span className="acard__play" aria-hidden="true">
            <Play size={18} fill="currentColor" strokeWidth={0} />
          </span>
        </div>
        <div className="acard__foot">
          <h3 className="acard__title">{anime.title}</h3>
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
            <h3 className="acard__title">{anime.title}</h3>
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
        <div className="acard__scrim" />
        {badge && <span className="acard__flag">{badge}</span>}
      </div>
      <div className="acard__foot">
        {rank && (
          <span className="acard__rank" aria-label={`Rank ${rank}`}>
            {String(rank).padStart(2, '0')}
          </span>
        )}
        <div className="acard__names">
          <h3 className="acard__title">{anime.title}</h3>
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
