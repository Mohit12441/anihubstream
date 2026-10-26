import { formatEpisodeCount, type Anime } from '../data/model.ts';

/**
 * Shared card meta template formatting:
 * "{Format} · {Year} · {epCount} EP"
 * - Uses "TBA" when episode count is unknown or 0.
 * - Deduplicates repeated tokens.
 * - Single-occurrence, identical meta across all card surfaces.
 */
export function formatCardMeta(
  anime: Pick<Anime, 'kind' | 'year' | 'episodeCount' | 'episodeTotal'>,
  episode?: string,
): string {
  const parts: string[] = [];

  let format = anime.kind ? String(anime.kind).trim() : '';
  const total = anime.episodeTotal || anime.episodeCount || 0;
  if (total === 1 && (format.toLowerCase() === 'special' || format.toLowerCase() === 'movie' || format.toLowerCase() === 'ona' || format.toLowerCase() === 'ova')) {
    if (format.toLowerCase() === 'movie') {
      format = 'Movie';
    } else {
      format = 'Special';
    }
  }
  if (format && format !== '—' && format !== 'null' && format !== 'undefined') {
    parts.push(format);
  }

  const year = anime.year && Number.isFinite(anime.year) && anime.year > 1900 ? String(anime.year) : '';
  if (year) {
    parts.push(year);
  }

  let ep = '';
  if (episode && episode.trim()) {
    const trimmed = episode.trim();
    if (/^\d+$/.test(trimmed)) {
      ep = `${trimmed} EP`;
    } else {
      ep = trimmed;
    }
  } else {
    ep = formatEpisodeCount(anime);
  }

  if (ep) {
    parts.push(ep);
  }

  // Deduplicate tokens case-insensitively while preserving order
  const seen = new Set<string>();
  const uniqueParts: string[] = [];
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      uniqueParts.push(part);
    }
  }

  return uniqueParts.join(' · ');
}
