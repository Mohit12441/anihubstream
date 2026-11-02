import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, RefreshCw, Sparkles, Wand2 } from 'lucide-react';
import { AnimeCard } from './AnimeCard';
import { AnimeCarousel } from './AnimeCarousel';
import { useCatalogue } from '../state/catalogue';
import { useLibrary } from '../state/library';
import {
  buildUserProfile,
  getPersonalizedRecommendations,
  getContentRecommendations,
  type RecommendationItem,
} from '../lib/recommendations';
import type { Anime } from '../data/model';
import '../styles/recommended-shelf.css';

interface Props {
  targetAnime?: Anime | null;
  title?: string;
  subtitle?: string;
  limit?: number;
}

export function RecommendedShelf({
  targetAnime,
  title,
  subtitle,
  limit = 12,
}: Props) {
  const { home, popular } = useCatalogue();
  const { history, favourites, items: savedItems } = useLibrary();
  const [shuffleKey, setShuffleKey] = useState(0);

  // Pool of candidate anime available in catalogue home feeds
  const candidatePool = useMemo<Anime[]>(() => {
    const map = new Map<string, Anime>();

    const addList = (list?: Anime[]) => {
      if (!list) return;
      for (const a of list) {
        if (a && a.id && !map.has(a.id)) {
          map.set(a.id, a);
        }
      }
    };

    addList(popular?.());
    addList(home.trending);
    addList(home.top);
    addList(home.fresh);
    addList(home.ongoing);
    addList(home.added);

    return Array.from(map.values());
  }, [home, popular]);

  // Compute recommendations
  const recommendations = useMemo<RecommendationItem[]>(() => {
    if (candidatePool.length === 0) return [];

    // Case 1: Target Anime given (Content-based on detail/watch page)
    if (targetAnime) {
      return getContentRecommendations(targetAnime, candidatePool, limit);
    }

    // Case 2: Personalized for User (Homepage / Discovery)
    const profile = buildUserProfile(history, favourites, savedItems);
    const recs = getPersonalizedRecommendations(candidatePool, profile, limit * 2);

    // Shuffle rotation if requested
    if (shuffleKey > 0 && recs.length > limit) {
      const offset = (shuffleKey * 3) % (recs.length - limit);
      return recs.slice(offset, offset + limit);
    }

    return recs.slice(0, limit);
  }, [targetAnime, candidatePool, history, favourites, savedItems, limit, shuffleKey]);

  if (recommendations.length === 0) {
    return null;
  }

  const defaultTitle = targetAnime ? 'More Like This' : 'Recommended For You';
  const defaultSubtitle = targetAnime
    ? `Titles similar in tone, themes, and genre to ${targetAnime.title}`
    : history.length > 0
      ? 'Tailored to your recent watch history and favorite genres'
      : 'Curated high-affinity anime gems from the community';

  return (
    <section className="home__row recommended-shelf" aria-labelledby="row-recommended">
      <div className="sec-head">
        <div className="rec-title-wrap">
          <h2 id="row-recommended">
            <Sparkles size={21} aria-hidden="true" className="rec-sparkle-icon" />
            {title || defaultTitle}
            <Link to="/anime?sort=rating" className="sec-head__link" aria-label="Browse full anime catalog">
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
          </h2>
          <span className="sec-head__hint">{subtitle || defaultSubtitle}</span>
        </div>

        <button
          type="button"
          className="rec-shuffle-btn"
          onClick={() => setShuffleKey((k) => k + 1)}
          title="Shuffle recommendations"
          aria-label="Shuffle recommendations"
        >
          <RefreshCw size={14} />
          <span>Refresh Picks</span>
        </button>
      </div>

      <AnimeCarousel label={title || defaultTitle}>
        {recommendations.map((item) => (
          <div key={item.anime.id} className="rec-card-container">
            {/* Match Percentage Badge */}
            <div className="rec-match-badge-wrap">
              <span
                className={`rec-match-badge ${
                  item.matchPercentage >= 85
                    ? 'is-high-match'
                    : item.matchPercentage >= 75
                      ? 'is-mid-match'
                      : ''
                }`}
              >
                <Wand2 size={10} aria-hidden="true" />
                {item.matchPercentage}% Match
              </span>
            </div>

            <AnimeCard anime={item.anime} variant="key" />

            {/* Recommendation Reason Pill */}
            {item.reason && (
              <div className="rec-reason-caption" title={item.reason}>
                {item.reason}
              </div>
            )}
          </div>
        ))}
      </AnimeCarousel>
    </section>
  );
}
