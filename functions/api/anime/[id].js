import { CARD_COLUMNS, HttpError, cardFromRow, episodeFromRow, errorResponse, ok } from '../_lib.js';

const SLUG_REDIRECTS = {
  'demon-slayer-kimetsu-no-yaiba': 'demon-slayer',
  'frieren-beyond-journey-s-end': 'sousou-no-frieren',
  'tokyo-revengers-war-of-the-three-titans-arc': 'tokyo-revengers-zokuhen',
  'blue-box-season-2': 'ao-no-hako-2',
  'the-apothecary-diaries-season-3': 'kusuriya-no-hitorigoto-3rd-season',
  'cyberpunk-edgerunners-2': 'cyberpunk-edgerunners-ii',
  'the-laid-off-cheat-granting-mage-enjoys-a-second-lease-on': 'the-laid-off-cheat-granting-mage-enjoys-a-second-lease-on-life',
};

export const onRequestGet = async ({ request, params, env }) => {
  try {
    const id = decodeURIComponent(params.id);
    if (!/^[A-Za-z0-9_.:-]{1,120}$/.test(id)) {
      throw new HttpError(400, 'bad_request', 'anime id may contain letters, digits, dash, dot, colon, and underscore only');
    }

    if (SLUG_REDIRECTS[id]) {
      const canonical = SLUG_REDIRECTS[id];
      const targetUrl = new URL(request.url);
      targetUrl.pathname = `/api/anime/${canonical}`;
      return Response.redirect(targetUrl.toString(), 301);
    }

    let card = await env.ANIHUB.prepare(`SELECT ${CARD_COLUMNS} FROM anime a WHERE a.id = ?1`)
      .bind(id)
      .first()
      .catch(() => null);

    // If not found directly, try cleaning provider prefixes or looking up anime_id_map
    if (!card) {
      const cleanSlug = id.replace(/^[a-z0-9_-]+:/i, '').replace(/:+/g, '-');
      card = await env.ANIHUB.prepare(`SELECT ${CARD_COLUMNS} FROM anime a WHERE a.id = ?1`)
        .bind(cleanSlug)
        .first()
        .catch(() => null);

      if (!card) {
        try {
          let mapped = await env.ANIHUB.prepare(
            `SELECT anime_id FROM anime_provider_mapping WHERE provider_slug = ?1 LIMIT 1`
          ).bind(id).first().catch(() => null);

          if (!mapped?.anime_id) {
            mapped = await env.ANIHUB.prepare(
              `SELECT anime_id FROM anime_id_map
               WHERE anikoto_slug = ?1 OR hianime_slug = ?1 OR aniwatch_slug = ?1 OR adb_slug = ?1 OR waw_slug = ?1
               LIMIT 1`
            ).bind(id).first().catch(() => null);
          }

          if (mapped?.anime_id) {
            card = await env.ANIHUB.prepare(`SELECT ${CARD_COLUMNS} FROM anime a WHERE a.id = ?1`)
              .bind(mapped.anime_id)
              .first()
              .catch(() => null);
          }
        } catch {
          // provider mapping table optional in edge environment
        }
      }
    }

    // If still not found, synthesize an ad-hoc card from query params so search & provider cards load seamlessly
    if (!card) {
      const reqUrl = new URL(request.url);
      const queryTitle = reqUrl.searchParams.get('title') || '';
      const queryPoster = reqUrl.searchParams.get('poster') || '';
      const fallbackTitle = queryTitle || id.replace(/^[a-z0-9_-]+:/i, '').replace(/[-_:]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      return ok({
        id,
        title: fallbackTitle,
        native: '',
        year: new Date().getFullYear(),
        rating: 8.0,
        season: '',
        kind: 'TV',
        status: 'Finished',
        genres: [],
        art: queryPoster,
        keyArt: queryPoster,
        accent: '#6366f1',
        synopsis: `Stream ${fallbackTitle} online on AniHubStream.`,
        rank: null,
        trendRank: null,
        altSeasons: [],
        schedule: null,
        episodeCount: 1,
        episodeTotal: 24,
        episodes: Array.from({ length: 24 }, (_, i) => ({
          id: `${id}#${i + 1}`,
          n: i + 1,
          title: `Episode ${i + 1}`,
          runtime: '24m',
          runtimeSeconds: 1440,
          art: queryPoster,
          synopsis: '',
          markers: [],
          airdate: null,
        })),
        related: [],
      });
    }

    const { results: episodeRows } = await env.ANIHUB.prepare(
      `SELECT id, n, title, runtime, runtime_seconds, thumb, synopsis, markers, airdate
         FROM episode WHERE anime_id = ?1 ORDER BY n`,
    )
      .bind(id)
      .all();

    let episodes = episodeRows.map(episodeFromRow);

    // If database has no explicit episode rows for this anime, but anime is released/ongoing,
    // synthesize addressable episode entries up to episode_total (or at least episode 1)
    if (episodes.length === 0 && card.status !== 'Upcoming') {
      const count = Math.max(1, Math.min(card.episode_total || 1, 2000));
      episodes = Array.from({ length: count }, (_, i) => ({
        id: `${card.id}#${i + 1}`,
        n: i + 1,
        title: `Episode ${i + 1}`,
        runtime: '24m',
        runtimeSeconds: 1440,
        art: card.art || card.key_art || '',
        synopsis: '',
        markers: [],
        airdate: null,
      }));
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
      .bind(id)
      .all();

    return ok({
      ...cardFromRow(card),
      episodes,
      related: related.map(cardFromRow),
    });
  } catch (err) {
    return errorResponse(err);
  }
};
