// tools/anilist-enricher.mjs
// Fetches rich anime industry metadata, studios, directors, and cast via the free AniList GraphQL API

const ANILIST_GRAPHQL_ENDPOINT = 'https://graphql.anilist.co';

const QUERY = `
query ($search: String) {
  Media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
    id
    title {
      romaji
      english
      native
    }
    format
    status
    episodes
    season
    seasonYear
    source
    averageScore
    genres
    description(asHtml: false)
    coverImage {
      large
      extraLarge
    }
    bannerImage
    studios(isMain: true) {
      nodes {
        id
        name
        isAnimationStudio
      }
    }
    staff(perPage: 6, sort: RELEVANCE) {
      edges {
        role
        node {
          name {
            full
          }
        }
      }
    }
    characters(perPage: 4, sort: ROLE) {
      edges {
        role
        node {
          name {
            full
          }
        }
        voiceActors(language: JAPANESE) {
          name {
            full
          }
        }
      }
    }
  }
}
`;

/**
 * Cache for queries during single script run to avoid redundant network hops
 * @type {Map<string, any>}
 */
const enrichmentCache = new Map();

/**
 * Fetch rich production data for an anime title from AniList GraphQL
 * @param {string} animeTitle 
 * @returns {Promise<any | null>}
 */
export async function fetchAniListMetadata(animeTitle) {
  if (!animeTitle || typeof animeTitle !== 'string') return null;
  const cleanTitle = animeTitle.trim();
  if (enrichmentCache.has(cleanTitle.toLowerCase())) {
    return enrichmentCache.get(cleanTitle.toLowerCase());
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const response = await fetch(ANILIST_GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        query: QUERY,
        variables: { search: cleanTitle }
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const media = data?.data?.Media;
    if (!media) return null;

    // Normalize staff members
    const staffList = (media.staff?.edges || []).map(e => ({
      role: e.role,
      name: e.node?.name?.full || 'Unknown'
    }));

    // Main animation studio
    const mainStudio = media.studios?.nodes?.find(s => s.isAnimationStudio)?.name || 
      media.studios?.nodes?.[0]?.name || 'TBA';

    // Top voice actors
    const voiceCast = (media.characters?.edges || [])
      .filter(c => c.voiceActors && c.voiceActors.length > 0)
      .map(c => ({
        character: c.node?.name?.full || '',
        actor: c.voiceActors[0]?.name?.full || ''
      }));

    let bannerImage = media.bannerImage || null;
    let coverImage = media.coverImage?.extraLarge || media.coverImage?.large || null;

    // If AniList did not supply a wide banner, fallback to Kitsu's wide cover image
    if (!bannerImage) {
      try {
        const kitsuRes = await fetch(`https://kitsu.app/api/edge/anime?filter[text]=${encodeURIComponent(cleanTitle)}`, {
          headers: { 'Accept': 'application/vnd.api+json' },
          signal: AbortSignal.timeout(4000)
        });
        if (kitsuRes.ok) {
          const kitsuJson = await kitsuRes.json();
          const kAnime = kitsuJson?.data?.[0]?.attributes;
          if (kAnime?.coverImage?.large || kAnime?.coverImage?.original) {
            bannerImage = kAnime.coverImage.large || kAnime.coverImage.original;
          }
          if (!coverImage && (kAnime?.posterImage?.large || kAnime?.posterImage?.original)) {
            coverImage = kAnime.posterImage.large || kAnime.posterImage.original;
          }
        }
      } catch {
        // Non-fatal
      }
    }

    const result = {
      id: media.id,
      titleEnglish: media.title?.english || media.title?.romaji || cleanTitle,
      titleRomaji: media.title?.romaji || '',
      titleNative: media.title?.native || '',
      format: media.format ? media.format.replace('_', ' ') : 'TV Series',
      status: media.status || 'UNKNOWN',
      episodes: media.episodes || null,
      seasonYear: media.seasonYear || null,
      season: media.season || null,
      source: media.source ? media.source.replace(/_/g, ' ') : 'Original',
      score: media.averageScore ? (media.averageScore / 10).toFixed(1) : null,
      genres: media.genres || [],
      studio: mainStudio,
      staff: staffList,
      voiceCast,
      synopsis: media.description ? media.description.replace(/<[^>]*>?/gm, '').trim() : '',
      coverImage,
      bannerImage
    };

    enrichmentCache.set(cleanTitle.toLowerCase(), result);
    return result;
  } catch (error) {
    // Non-fatal, gracefully return null
    return null;
  }
}
