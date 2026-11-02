import type { Anime } from '../data/model';
import type { HistoryEntry } from '../state/library';

export interface RecommendationItem {
  anime: Anime;
  score: number; // 0.0 to 1.0
  matchPercentage: number; // 0 to 100
  reason: string;
  seedTitle?: string;
}

export interface UserProfileAffinity {
  genreWeights: Record<string, number>;
  favoriteIds: Set<string>;
  watchedIds: Set<string>;
  topSeeds: Anime[];
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'in', 'on', 'at', 'to', 'for', 'with', 'by',
  'about', 'against', 'between', 'into', 'through', 'during', 'before', 'after',
  'above', 'below', 'from', 'up', 'down', 'is', 'am', 'are', 'was', 'were',
  'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'but',
  'if', 'because', 'as', 'until', 'while', 'of', 'this', 'that', 'these',
  'those', 'his', 'her', 'their', 'its', 'he', 'she', 'it', 'they', 'who',
  'which', 'world', 'life', 'one', 'two', 'new', 'time', 'all', 'can', 'will',
]);

/**
 * Extracts normalized tokens from a text string, removing punctuation and common stop words
 */
export function tokenizeText(text: string): Set<string> {
  if (!text) return new Set();
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  return new Set(tokens);
}

/**
 * Calculates Jaccard similarity index between two string arrays or sets
 */
export function calculateJaccard(setA: Set<string> | string[], setB: Set<string> | string[]): number {
  const a = Array.isArray(setA) ? new Set(setA) : setA;
  const b = Array.isArray(setB) ? new Set(setB) : setB;

  if (a.size === 0 && b.size === 0) return 0;

  let intersectionCount = 0;
  for (const item of a) {
    if (b.has(item)) intersectionCount++;
  }

  const unionCount = a.size + b.size - intersectionCount;
  return unionCount === 0 ? 0 : intersectionCount / unionCount;
}

/**
 * Computes hybrid similarity between two anime titles (0.0 to 1.0)
 */
export function calculateAnimeSimilarity(a: Anime, b: Anime): { score: number; sharedGenres: string[] } {
  if (a.id === b.id) return { score: 1.0, sharedGenres: a.genres || [] };

  const genresA = a.genres || [];
  const genresB = b.genres || [];
  const sharedGenres = genresA.filter((g) => genresB.includes(g));

  // 1. Genre Overlap (Weight: 45%)
  const genreScore = calculateJaccard(genresA, genresB);

  // 2. Format / Kind Overlap (Weight: 10%)
  const kindScore = a.kind && b.kind && a.kind === b.kind ? 1.0 : 0.4;

  // 3. Rating Quality Multiplier (Weight: 15%)
  const ratingNormalized = Math.min(1.0, Math.max(0, (b.rating || 7.0) / 10));

  // 4. Synopsis Token Overlap (Weight: 30%)
  const tokensA = tokenizeText(a.synopsis || a.title);
  const tokensB = tokenizeText(b.synopsis || b.title);
  const tokenScore = calculateJaccard(tokensA, tokensB);

  // Composite hybrid score
  const score =
    genreScore * 0.45 +
    kindScore * 0.10 +
    ratingNormalized * 0.15 +
    tokenScore * 0.30;

  return {
    score: Math.min(1.0, Math.max(0, score)),
    sharedGenres,
  };
}

/**
 * Builds user genre preference profile and seed anime from watch history and favorites
 */
export function buildUserProfile(
  history: HistoryEntry[] = [],
  favourites: Set<string> = new Set(),
  savedItems: Anime[] = []
): UserProfileAffinity {
  const genreWeights: Record<string, number> = {};
  const favoriteIds = new Set(favourites);
  const watchedIds = new Set<string>();
  const topSeeds: Anime[] = [];

  // Track unique anime seen in history
  const seenAnimeIds = new Set<string>();

  for (const entry of history) {
    if (!entry.anime || !entry.anime.id) continue;
    const anime = entry.anime;
    watchedIds.add(anime.id);

    // Watch completion ratio: 0.1 to 1.0
    const ratio =
      entry.runtimeSeconds > 0
        ? Math.min(1.0, entry.seconds / entry.runtimeSeconds)
        : 0.5;

    // Favorited bonus: 1.5x multiplier
    const isFav = favoriteIds.has(anime.id);
    const weight = (0.5 + ratio * 0.5) * (isFav ? 1.5 : 1.0);

    for (const g of anime.genres || []) {
      genreWeights[g] = (genreWeights[g] || 0) + weight;
    }

    if (!seenAnimeIds.has(anime.id)) {
      seenAnimeIds.add(anime.id);
      topSeeds.push(anime);
    }
  }

  // Also factor saved items in watchlist
  for (const saved of savedItems) {
    if (!saved || !saved.id) continue;
    if (!seenAnimeIds.has(saved.id)) {
      seenAnimeIds.add(saved.id);
      topSeeds.push(saved);
      for (const g of saved.genres || []) {
        genreWeights[g] = (genreWeights[g] || 0) + 0.8;
      }
    }
  }

  // Normalize genre weights
  const totalWeight = Object.values(genreWeights).reduce((sum, v) => sum + v, 0);
  if (totalWeight > 0) {
    for (const k of Object.keys(genreWeights)) {
      genreWeights[k] = genreWeights[k] / totalWeight;
    }
  }

  return {
    genreWeights,
    favoriteIds,
    watchedIds,
    topSeeds: topSeeds.slice(0, 10),
  };
}

/**
 * Computes personalized recommendations for a user profile from a pool of candidate anime
 */
export function getPersonalizedRecommendations(
  candidates: Anime[],
  profile: UserProfileAffinity,
  limit: number = 12
): RecommendationItem[] {
  if (!candidates || candidates.length === 0) return [];

  // If user has no history or profile, fallback to highest rated / popular titles
  if (profile.topSeeds.length === 0 && Object.keys(profile.genreWeights).length === 0) {
    return candidates
      .slice()
      .sort((a, b) => (b.rating || 0) - (a.rating || 0))
      .slice(0, limit)
      .map((anime, index) => {
        const match = Math.max(82, Math.min(98, Math.round(98 - index * 1.5)));
        return {
          anime,
          score: match / 100,
          matchPercentage: match,
          reason: 'Curated high-rating community favorite',
        };
      });
  }

  const results: RecommendationItem[] = [];

  for (const candidate of candidates) {
    // Filter out already watched or currently watching titles
    if (profile.watchedIds.has(candidate.id)) continue;

    // Calculate score across all seed titles
    let bestSimilarity = 0;
    let bestSeed: Anime | null = null;
    let bestSharedGenres: string[] = [];

    for (const seed of profile.topSeeds) {
      const { score, sharedGenres } = calculateAnimeSimilarity(seed, candidate);
      if (score > bestSimilarity) {
        bestSimilarity = score;
        bestSeed = seed;
        bestSharedGenres = sharedGenres;
      }
    }

    // Genre Affinity bonus from user's global profile
    let profileGenreBonus = 0;
    for (const g of candidate.genres || []) {
      if (profile.genreWeights[g]) {
        profileGenreBonus += profile.genreWeights[g];
      }
    }

    // Rating quality bias (0 to 0.15)
    const ratingBias = ((candidate.rating || 7.0) / 10) * 0.15;

    // Final blended score (0.0 to 1.0)
    const finalScore = Math.min(
      0.99,
      bestSimilarity * 0.65 + profileGenreBonus * 0.20 + ratingBias
    );

    if (finalScore >= 0.20) {
      const matchPercentage = Math.round(Math.min(99, Math.max(65, 52 + finalScore * 48)));
      let reason = 'Based on your overall watch preferences';

      if (bestSeed && bestSharedGenres.length > 0) {
        reason = `Because you watched ${bestSeed.title} · ${bestSharedGenres.slice(0, 2).join(', ')}`;
      } else if (bestSeed) {
        reason = `Similar themes to ${bestSeed.title}`;
      } else if (candidate.genres && candidate.genres.length > 0) {
        reason = `Matches your affinity for ${candidate.genres[0]}`;
      }

      results.push({
        anime: candidate,
        score: finalScore,
        matchPercentage,
        reason,
        seedTitle: bestSeed?.title,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

/**
 * Computes content-based recommendations for a single target anime
 */
export function getContentRecommendations(
  target: Anime,
  candidates: Anime[],
  limit: number = 8
): RecommendationItem[] {
  if (!target || !candidates || candidates.length === 0) return [];

  const results: RecommendationItem[] = [];

  for (const candidate of candidates) {
    if (candidate.id === target.id) continue;

    const { score, sharedGenres } = calculateAnimeSimilarity(target, candidate);
    const matchPercentage = Math.round(Math.min(99, Math.max(60, 50 + score * 50)));

    let reason = 'Similar tone and style';
    if (sharedGenres.length > 0) {
      reason = `Shared ${sharedGenres.slice(0, 3).join(', ')}`;
    }

    results.push({
      anime: candidate,
      score,
      matchPercentage,
      reason,
      seedTitle: target.title,
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}
