// functions/api/_anipm.js

const KNOWN_SLUGS = {
  195604: 'black-clover-season-2',
  151807: 'solo-leveling',
  16498: 'attack-on-titan',
  21: 'one-piece',
  1735: 'naruto-shippuuden',
  20: 'naruto',
  113415: 'jujutsu-kaisen',
  145064: 'jujutsu-kaisen-2nd-season',
  101922: 'demon-slayer-kimetsu-no-yaiba',
  154587: 'frieren-beyond-journeys-end',
  127230: 'chainsaw-man',
  153518: 'bleach-sennen-kessen-hen',
  166610: 'dandadan',
  153288: 'kaiju-no-8',
  137822: 'spy-x-family',
  140960: 'spy-x-family-season-2',
  11061: 'hunter-x-hunter-2011',
  160688: 'mashle-magic-and-muscles-the-divine-visionary-candidate-exam-arc',
  154116: 'boku-no-hero-academia-7th-season',
  163132: 'oshi-no-ko-2nd-season',
};

/**
 * Resolves AniPM Beta Master playlist dynamically for any anime.
 * 1. Resolves AniList ID from ID, trailing ID patterns, known slugs, or AniList GraphQL search.
 * 2. Fetches AniPM Beta server metadata (open, non-WAF endpoint) for the exact canonical slug,
 *    availability status, available episodes, and audio/subtitles tracks.
 * 3. Wraps the master.m3u8 URL in the Vercel-routed proxy.
 */
export async function resolveAniPmBetaDirect({ anilistId, ep = 1, title = '', slug = '' }) {
  let targetAnilist = anilistId ? Number(anilistId) : 0;
  if (!targetAnilist && /^\d+$/.test(String(slug))) {
    targetAnilist = Number(slug);
  }
  if (!targetAnilist && /^\d+$/.test(String(title))) {
    targetAnilist = Number(title);
  }

  // Check trailing AniList ID pattern (e.g., "solo-leveling-151807" or "anime-101922")
  if (!targetAnilist && slug) {
    const endMatch = String(slug).match(/[-_](\d{4,7})$/);
    if (endMatch) targetAnilist = Number(endMatch[1]);
  }

  // Check pre-indexed high frequency titles
  if (!targetAnilist) {
    for (const [id, s] of Object.entries(KNOWN_SLUGS)) {
      if (slug.includes(s) || (title && title.toLowerCase().includes(s.replace(/-/g, ' ')))) {
        targetAnilist = Number(id);
        break;
      }
    }
  }

  // Fallback: Query AniList GraphQL to resolve ID from title / clean slug
  if (!targetAnilist && (title || slug)) {
    try {
      const cleanName = (title || slug)
        .replace(/^(?:anipm|anikoto|hianime|aniwatch):/i, '')
        .replace(/-(?:tv|ona|ova|movie|special)$/i, '')
        .replace(/[-_]+/g, ' ')
        .trim();
      if (cleanName) {
        const gqlRes = await fetch('https://graphql.anilist.co', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': 'AniHubStream/1.0' },
          body: JSON.stringify({
            query: 'query ($search: String) { Media(search: $search, type: ANIME) { id } }',
            variables: { search: cleanName },
          }),
          signal: AbortSignal.timeout(2000),
        });
        if (gqlRes.ok) {
          const gqlData = await gqlRes.json();
          if (gqlData?.data?.Media?.id) {
            targetAnilist = Number(gqlData.data.Media.id);
          }
        }
      }
    } catch {}
  }

  // If we still cannot resolve an AniList ID, do NOT default to Black Clover!
  if (!targetAnilist) {
    return {
      id: 'anipm:beta',
      provider: 'anipm',
      name: 'AniPM · Beta',
      status: 'unavailable',
      unavailableReason: 'Could not resolve AniList ID for AniPM Beta stream.',
      streamUrl: null,
      audioTracks: [],
      subtitles: [],
    };
  }

  const epNum = Number.parseInt(String(ep || 1).replace(/\D+/g, ''), 10) || 1;
  const paddedEp = 'E' + String(epNum).padStart(4, '0');

  // Query AniPM Beta API for canonical slug & availability
  let betaMeta = null;
  let notFound = false;
  try {
    const metaRes = await fetch(`https://ani.pm/api/anime/beta-server/${targetAnilist}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(2500),
    });
    if (metaRes.status === 404) {
      notFound = true;
    } else if (metaRes.ok) {
      betaMeta = await metaRes.json();
    }
  } catch {}

  if (notFound) {
    return {
      id: 'anipm:beta',
      provider: 'anipm',
      name: 'AniPM · Beta',
      status: 'unavailable',
      unavailableReason: 'This anime is not hosted on AniPM Beta server.',
      streamUrl: null,
      audioTracks: [],
      subtitles: [],
    };
  }

  if (betaMeta) {
    if (!betaMeta.available) {
      return {
        id: 'anipm:beta',
        provider: 'anipm',
        name: 'AniPM · Beta',
        status: 'unavailable',
        unavailableReason: 'This anime is not hosted on AniPM Beta server.',
        streamUrl: null,
        audioTracks: [],
        subtitles: [],
      };
    }

    if (Array.isArray(betaMeta.episodes) && betaMeta.episodes.length > 0 && !betaMeta.episodes.includes(epNum)) {
      return {
        id: 'anipm:beta',
        provider: 'anipm',
        name: 'AniPM · Beta',
        status: 'unavailable',
        unavailableReason: `Episode ${epNum} is not available on AniPM Beta server.`,
        streamUrl: null,
        audioTracks: [],
        subtitles: [],
      };
    }

    const pathMatch = betaMeta.path ? betaMeta.path.replace(/^\/watch\//, '').replace(new RegExp(`-${targetAnilist}$`), '') : '';
    const canonicalSlug = pathMatch || KNOWN_SLUGS[targetAnilist] || 'anime';
    const masterSlug = `${targetAnilist}-${canonicalSlug}`;
    const masterUrl = `https://beta.cno.to/hls/${masterSlug}/${paddedEp}/master.m3u8`;

    const audioTracks = (betaMeta.audio || []).map((lang) => ({
      id: lang,
      label: lang.toUpperCase(),
      language: lang,
    }));
    const subtitles = (betaMeta.subs || []).map((sub) => ({
      id: sub,
      label: sub.toUpperCase(),
      language: sub,
    }));

    return {
      id: 'anipm:beta',
      provider: 'anipm',
      name: 'AniPM · Beta',
      status: 'ready',
      streamUrl: `/api/test-proxy?u=${encodeURIComponent(masterUrl)}`,
      masterUrl,
      referer: 'https://beta.cno.to/',
      referrerPolicy: 'no-referrer',
      quality: '1080p',
      audioTracks,
      subtitles,
    };
  }

  // Deterministic fallback if AniPM API timed out
  let cleanSlug = KNOWN_SLUGS[targetAnilist] || '';
  if (!cleanSlug && slug) {
    cleanSlug = String(slug)
      .replace(/^(?:anipm|anikoto|hianime|aniwatch):/i, '')
      .replace(/-(?:tv|ona|ova|movie|special)$/i, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
  if (!cleanSlug && title) {
    cleanSlug = String(title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  const masterSlug = cleanSlug ? `${targetAnilist}-${cleanSlug}` : String(targetAnilist);
  const masterUrl = `https://beta.cno.to/hls/${masterSlug}/${paddedEp}/master.m3u8`;

  return {
    id: 'anipm:beta',
    provider: 'anipm',
    name: 'AniPM · Beta',
    status: 'ready',
    streamUrl: `/api/test-proxy?u=${encodeURIComponent(masterUrl)}`,
    masterUrl,
    referer: 'https://beta.cno.to/',
    referrerPolicy: 'no-referrer',
    quality: '1080p',
    audioTracks: [],
    subtitles: [],
  };
}
