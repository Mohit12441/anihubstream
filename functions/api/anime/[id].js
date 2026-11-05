import { CARD_COLUMNS, HttpError, cardFromRow, cleanDisplayTitle, deriveSlugCandidates, episodeFromRow, errorResponse, findAnimeByCandidates, ok, resolveFranchiseSeasons, withEdgeCache } from '../_lib.js';

const SLUG_REDIRECTS = {
  'demon-slayer-kimetsu-no-yaiba': 'demon-slayer',
  'frieren-beyond-journey-s-end': 'sousou-no-frieren',
  'tokyo-revengers-war-of-the-three-titans-arc': 'tokyo-revengers-zokuhen',
  'blue-box-season-2': 'ao-no-hako-2',
  'the-apothecary-diaries-season-3': 'kusuriya-no-hitorigoto-3rd-season',
  'cyberpunk-edgerunners-2': 'cyberpunk-edgerunners-ii',
  'the-laid-off-cheat-granting-mage-enjoys-a-second-lease-on': 'the-laid-off-cheat-granting-mage-enjoys-a-second-lease-on-life',
};

const PROVIDER_PREFIX_REGEX = /^(?:hianime|anikoto|aniwatch|watchanimeworld|animewave|animekai):/i;

export const onRequestGet = async ({ request, params, env, waitUntil }) => {
  return withEdgeCache(request, env, 86400, async () => {
  try {
    const id = decodeURIComponent(params.id);
    if (!/^[A-Za-z0-9_.:\-!()'"+~@, %]{1,200}$/.test(id)) {
      throw new HttpError(400, 'bad_request', 'anime id contains invalid characters');
    }

    if (SLUG_REDIRECTS[id]) {
      const canonical = SLUG_REDIRECTS[id];
      const targetUrl = new URL(request.url);
      targetUrl.pathname = `/api/anime/${canonical}`;
      return Response.redirect(targetUrl.toString(), 301);
    }

    // Unified candidate resolution across canonical and provider mappings
    const candidates = deriveSlugCandidates(id);
    const rawSlug = candidates[1] || id;
    const rawSlugNoHash = candidates[2] || rawSlug;
    const cleanSlug = candidates[3] || rawSlug;
    let card = await findAnimeByCandidates(env.ANIHUB, candidates);

    // 3. Fallback: dynamically fetch from AniList GraphQL API
    if (!card) {
      try {
        const queryTerm = cleanSlug.replace(/[-_]+/g, ' ').trim();
        const aniRes = await fetch('https://graphql.anilist.co', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': 'AniHubStream/1.0' },
          body: JSON.stringify({
            query: `query ($search: String) {
              Media(search: $search, type: ANIME) {
                id
                idMal
                title { romaji english native }
                format
                status
                episodes
                duration
                averageScore
                bannerImage
                coverImage { large extraLarge }
                startDate { year }
                description
                genres
              }
            }`,
            variables: { search: queryTerm },
          }),
          signal: AbortSignal.timeout(2000),
        });
        if (aniRes.ok) {
          const aniJson = await aniRes.json();
          const media = aniJson?.data?.Media;
          if (media && media.title) {
            const canonicalTitle = media.title.english || media.title.romaji || queryTerm;
            const isMovie = media.format === 'MOVIE';
            const epCount = media.episodes || (isMovie ? 1 : 12);
            const poster = media.coverImage?.extraLarge || media.coverImage?.large || '';
            const banner = media.bannerImage || poster;
            card = {
              id: rawSlug,
              title: canonicalTitle,
              native: media.title.native || '',
              year: media.startDate?.year || new Date().getFullYear(),
              rating: media.averageScore ? media.averageScore / 10 : 8.0,
              season: media.startDate?.year ? `Year ${media.startDate.year}` : '',
              kind: isMovie ? 'Movie' : (media.format || 'TV'),
              status: media.status === 'RELEASING' ? 'Ongoing' : (media.status === 'NOT_YET_RELEASED' ? 'Upcoming' : 'Finished'),
              art: poster,
              key_art: banner,
              accent: '#6366f1',
              synopsis: (media.description || `Stream ${canonicalTitle} online on AniHubStream.`).replace(/<[^>]+>/g, ''),
              rank: null,
              trend_rank: null,
              alt_seasons: JSON.stringify([]),
              sched_day: null,
              sched_day_label: null,
              sched_date: null,
              sched_time: null,
              sched_season: null,
              sched_episode: null,
              episode_total: epCount,
              source_ids: JSON.stringify({ anilist: media.id, mal: media.idMal }),
              skip_key_id: media.idMal || null,
              skip_key_space: media.idMal ? 'mal' : null,
            };
          }
        }
      } catch (_) {}
    }

    // 4. If still not found, synthesize an ad-hoc card from query params so search & provider cards load seamlessly
    if (!card) {
      const reqUrl = new URL(request.url);
      const queryTitle = reqUrl.searchParams.get('title') || '';
      const queryPoster = reqUrl.searchParams.get('poster') || '';
      const cleanBase = rawSlugNoHash.replace(/[-_:]+/g, ' ').trim();
      const fallbackTitle = cleanDisplayTitle(queryTitle) || cleanBase.replace(/\b\w/g, (c) => c.toUpperCase());
      const isMovie = cleanBase.toLowerCase().includes('movie');
      const totalEps = isMovie ? 1 : 12;

      return ok({
        id,
        title: fallbackTitle,
        native: '',
        year: new Date().getFullYear(),
        rating: 8.0,
        season: '',
        kind: isMovie ? 'Movie' : 'TV',
        status: 'Finished',
        genres: [],
        art: queryPoster,
        keyArt: queryPoster,
        accent: '#6366f1',
        synopsis: `Stream ${fallbackTitle} online on AniHubStream.`,
        rank: null,
        trendRank: null,
        altSeasons: [],
        seasons: [],
        schedule: null,
        episodeCount: totalEps,
        episodeTotal: totalEps,
        episodes: Array.from({ length: totalEps }, (_, i) => ({
          id: `${id}#${i + 1}`,
          n: i + 1,
          title: `Episode ${i + 1}`,
          runtime: '24m',
          runtimeSeconds: 1440,
          art: queryPoster,
          synopsis: isMovie ? `Stream ${fallbackTitle} online on AniHubStream.` : '',
          markers: [],
          airdate: null,
        })),
        related: [],
      });
    }

    const fallbackArt = card.key_art || card.art || '';
    const { results: episodeRows } = await env.ANIHUB.prepare(
      `SELECT id, n, title, runtime, runtime_seconds, thumb, synopsis, markers, airdate
         FROM episode WHERE anime_id = ?1 ORDER BY n`,
    )
      .bind(card.id)
      .all();

    let episodes = episodeRows.map((r) => episodeFromRow(r, fallbackArt));

    const isUpcoming = card.status === 'Upcoming' || card.status === 'NOT_YET_RELEASED';

    // If database has no explicit episode rows for this anime, synthesize addressable episode entries up to episode_total
      if (episodes.length === 0 && !isUpcoming) {
        const isOngoing = card.status === 'Ongoing' || card.status === 'Airing';
        const count = card.kind === 'Movie' ? 1 : (isOngoing ? 1 : Math.max(1, Math.min(card.episode_total || 1, 2000)));
        episodes = Array.from({ length: count }, (_, i) => ({
          id: `${card.id}#${i + 1}`,
          n: i + 1,
          title: `Episode ${i + 1}`,
          runtime: '24m',
          runtimeSeconds: 1440,
          art: fallbackArt,
          thumb: fallbackArt,
          synopsis: card.kind === 'Movie' ? (card.synopsis || '') : '',
          markers: [],
          airdate: null,
        }));
      }
    }

    // Filter out unreleased episodes so client renders strictly streamable episodes
    if (isUpcoming) {
      episodes = [];
    } else if (card.status === 'Ongoing' || card.status === 'Airing') {
      const today = new Date().toISOString().split('T')[0];
      const nextAiringEp = card.sched_episode && card.sched_episode > 0 ? card.sched_episode : null;
      episodes = episodes.filter((ep) => {
        // If next airing episode is known, any episode >= nextAiringEp has not aired yet
        if (nextAiringEp !== null && ep.n >= nextAiringEp) return false;
        // If airdate is explicitly in the future, it has not aired yet
        if (ep.airdate && ep.airdate > today) return false;
        // If no airdate and no external provider ID and no synopsis, it's an unpopulated phantom shell
        if (!ep.airdate && !ep.external_id && !ep.synopsis && ep.title === `Episode ${ep.n}`) {
          return false;
        }
        return true;
      });
    }

    // Auto-inject cached AniSkip markers if episode rows have empty markers
    const malId = card.skip_key_id || (card.source_ids ? JSON.parse(card.source_ids)?.mal : null);
    if (malId && episodes.length > 0) {
      try {
        const { results: cachedSkip } = await env.ANIHUB.prepare(
          `SELECT key, data FROM stream_cache WHERE key LIKE ?1 AND expires_at > ?2`
        ).bind(`aniskip:${malId}:%`, Date.now()).all();
        if (cachedSkip && cachedSkip.length > 0) {
          const skipMap = new Map();
          for (const row of cachedSkip) {
            const epNum = Number(row.key.split(':')[2]);
            if (epNum) {
              try {
                const parsed = JSON.parse(row.data);
                if (parsed && !parsed.empty) {
                  const mList = [];
                  if (parsed.op) mList.push({ kind: 'intro', start: parsed.op.start, end: parsed.op.end, label: parsed.op.label || 'Opening' });
                  if (parsed.ed) mList.push({ kind: 'outro', start: parsed.ed.start, end: parsed.ed.end, label: parsed.ed.label || 'Ending' });
                  if (parsed.recap) mList.push({ kind: 'recap', start: parsed.recap.start, end: parsed.recap.end, label: parsed.recap.label || 'Recap' });
                  skipMap.set(epNum, mList);
                }
              } catch {}
            }
          }
          for (const ep of episodes) {
            if ((!ep.markers || ep.markers.length === 0) && skipMap.has(ep.n)) {
              ep.markers = skipMap.get(ep.n);
              // Asynchronously backfill into D1 episode table for 0ms future reads
              env.ANIHUB.prepare(
                `UPDATE episode SET markers = ?1 WHERE anime_id = ?2 AND n = ?3`
              ).bind(JSON.stringify(ep.markers), card.id, ep.n).run().catch(() => {});
            }
          }
        }
      } catch {}
    }

    const { results: related } = await env.ANIHUB.prepare(
      `SELECT a.id, a.title, a.native, a.year, a.rating, a.season, a.kind, a.status,
              a.art, a.key_art, a.accent, a.synopsis, a.rank, a.trend_rank, a.alt_seasons,
              a.sched_day, a.sched_day_label, a.sched_date, a.sched_time, a.sched_season,
              a.episode_total, a.source_ids, a.skip_key_id, a.skip_key_space,
              (SELECT group_concat(genre_id) FROM anime_genre ag2 WHERE ag2.anime_id = a.id) AS genre_ids,
              (SELECT count(*) FROM episode e2 WHERE e2.anime_id = a.id) AS episode_count
         FROM anime_genre ag
         JOIN anime a ON a.id = ag.anime_id
        WHERE ag.genre_id IN (SELECT genre_id FROM anime_genre WHERE anime_id = ?1)
          AND a.id <> ?1
        GROUP BY a.id
        ORDER BY count(*) DESC, a.rating DESC
        LIMIT 6`,
    )
      .bind(card.id)
      .all();

    const seasons = await resolveFranchiseSeasons(env.ANIHUB, card);

    const { results: provRows } = await env.ANIHUB.prepare(
      `SELECT provider_id, provider_slug FROM anime_provider_mapping WHERE anime_id = ?1`
    ).bind(card.id).all().catch(() => ({ results: [] }));

    return ok({
      ...cardFromRow(card),
      episodeCount: episodes.length,
      episodes,
      seasons,
      providers: (provRows || []).map((p) => p.provider_id),
      providerMappings: Object.fromEntries((provRows || []).map((p) => [p.provider_id, p.provider_slug])),
      related: related.map(cardFromRow),
    });
  } catch (err) {
    return errorResponse(err);
  }
  }, { allowedParams: [], waitUntil });
};