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

    // 3. Fallback: dynamically fetch from HiAnime API
    if (!card) {
      try {
        const fetchTarget = encodeURIComponent(rawSlug).replace(/%3A/gi, ':');
        const hianimeRes = await fetch(`https://animehot.cc/api/anime/${fetchTarget}`, {
          headers: { referer: 'https://animehot.cc/', 'user-agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(1500),
        });
        if (hianimeRes.ok) {
          const hData = await hianimeRes.json();
          const hAnime = hData?.anime;
          if (hAnime && hAnime.title) {
            // Check if HiAnime provides a mal_id, match it with our local D1 database!
            if (hAnime.mal_id) {
              const byMal = await env.ANIHUB.prepare(
                `SELECT ${CARD_COLUMNS} FROM anime a 
                 LEFT JOIN anime_id_map m ON a.id = m.anime_id 
                 WHERE m.mal_id = ?1 OR a.skip_key_id = ?1 OR json_extract(a.source_ids, '$.mal') = ?1 
                 LIMIT 1`
              ).bind(hAnime.mal_id).first().catch(() => null);

              if (byMal) {
                card = byMal;
                try {
                  await env.ANIHUB.prepare(
                    `INSERT OR REPLACE INTO anime_provider_mapping (anime_id, provider_id, provider_slug, confidence, updated_at)
                     VALUES (?1, 'hianime', ?2, 1.0, datetime('now'))`
                  ).bind(card.id, rawSlug).run();
                } catch (_) {}
              }
            }

            // If not matched in D1 by mal_id, check title similarity in D1
            if (!card && hAnime.title) {
              const cleanTitle = cleanDisplayTitle(hAnime.title);
              const byTitle = await env.ANIHUB.prepare(
                `SELECT ${CARD_COLUMNS} FROM anime a WHERE lower(a.title) = lower(?1) LIMIT 1`
              ).bind(cleanTitle).first().catch(() => null);
              if (byTitle) {
                card = byTitle;
                try {
                  await env.ANIHUB.prepare(
                    `INSERT OR REPLACE INTO anime_provider_mapping (anime_id, provider_id, provider_slug, confidence, updated_at)
                     VALUES (?1, 'hianime', ?2, 0.9, datetime('now'))`
                  ).bind(card.id, rawSlug).run();
                } catch (_) {}
              }
            }

            // If still not in D1, construct complete HiAnime profile with real episodes
            if (!card) {
              let hiEpisodes = [];
              const epCount = Number(hAnime.totalEpisodes) || Number(hAnime.totalSubbed) || (Array.isArray(hAnime.episodes) ? hAnime.episodes.length : 1);
              if (hAnime._id && epCount > 1) {
                try {
                  const epFetch = await fetch(`https://animehot.cc/api/episodes/${hAnime._id}?start=1&end=${epCount}`, {
                    headers: { referer: 'https://animehot.cc/', 'user-agent': 'Mozilla/5.0' },
                    signal: AbortSignal.timeout(3500),
                  });
                  if (epFetch.ok) {
                    const epJson = await epFetch.json();
                    if (Array.isArray(epJson?.episodes) && epJson.episodes.length > 0) {
                      hiEpisodes = epJson.episodes.map((ep, i) => ({
                        id: `${rawSlug}#${ep.episodeNumber || i + 1}`,
                        n: Number(ep.episodeNumber) || i + 1,
                        title: cleanDisplayTitle(ep.title?.trim() || `Episode ${ep.episodeNumber || i + 1}`),
                        runtime: hAnime.Duration || '24m',
                        runtimeSeconds: 1440,
                        art: hAnime.image || '',
                        thumb: hAnime.image || '',
                        synopsis: ep.synopsis || (epCount === 1 ? (hAnime.synopsis || '') : ''),
                        markers: [],
                        airdate: null,
                      }));
                    }
                  }
                } catch (_) {}
              }

              if (hiEpisodes.length === 0 && Array.isArray(hAnime.episodes) && hAnime.episodes.length > 0) {
                hiEpisodes = hAnime.episodes.map((ep, i) => ({
                  id: `${rawSlug}#${ep.episodeNumber || i + 1}`,
                  n: Number(ep.episodeNumber) || i + 1,
                  title: cleanDisplayTitle(ep.title?.trim() || `Episode ${ep.episodeNumber || i + 1}`),
                  runtime: hAnime.Duration || '24m',
                  runtimeSeconds: 1440,
                  art: hAnime.image || '',
                  thumb: hAnime.image || '',
                  synopsis: ep.synopsis || (epCount === 1 ? (hAnime.synopsis || '') : ''),
                  markers: [],
                  airdate: null,
                }));
              }

              const score = Number(hAnime.Score);
              const normRating = !isNaN(score) && score > 0 ? (score > 10 ? score / 10 : score) : 8.0;
              const isMovie = (hAnime.Type || '').toLowerCase().includes('movie') || cleanSlug.includes('movie');
              const finalTitle = cleanDisplayTitle(hAnime.title);

              return ok({
                id,
                title: finalTitle,
                native: hAnime.Japanese || '',
                year: hAnime.Aired ? Number.parseInt(hAnime.Aired.slice(0, 4), 10) || new Date().getFullYear() : new Date().getFullYear(),
                rating: Number(normRating.toFixed(1)),
                season: hAnime.Premiered || '',
                kind: (hAnime.Type || (isMovie ? 'Movie' : 'TV')).toUpperCase(),
                status: hAnime.Status?.includes('Finished') ? 'Finished' : 'Ongoing',
                genres: Array.isArray(hAnime.genres) ? hAnime.genres : [],
                art: hAnime.image || '',
                keyArt: hAnime.landScapeImage || hAnime.image || '',
                accent: '#6366f1',
                synopsis: hAnime.synopsis || `Stream ${finalTitle} online on AniHubStream.`,
                rank: null,
                trendRank: null,
                altSeasons: [],
                seasons: [],
                schedule: null,
                episodeCount: hiEpisodes.length || (isMovie ? 1 : epCount),
                episodeTotal: isMovie ? 1 : epCount,
                episodes: hiEpisodes.length > 0 ? hiEpisodes : Array.from({ length: isMovie ? 1 : epCount }, (_, i) => ({
                  id: `${id}#${i + 1}`,
                  n: i + 1,
                  title: `Episode ${i + 1}`,
                  runtime: hAnime.Duration || '24m',
                  runtimeSeconds: 1440,
                  art: hAnime.image || '',
                  thumb: hAnime.image || '',
                  synopsis: isMovie ? (hAnime.synopsis || '') : '',
                  markers: [],
                  airdate: null,
                })),
                providers: ['hianime'],
                providerMappings: { hianime: rawSlug },
                related: [],
              });
            }
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

    // If database has no explicit episode rows for this anime, but anime is released/ongoing,
    // attempt JIT discovery or synthesize addressable episode entries up to episode_total
    if (episodes.length === 0 && card.status !== 'Upcoming') {
      try {
        const provMap = await env.ANIHUB.prepare(
          `SELECT provider_slug FROM anime_provider_mapping WHERE anime_id = ?1 AND provider_id = 'anikoto' LIMIT 1`
        ).bind(card.id).first().catch(() => null);
        const anikotoSlug = provMap?.provider_slug;
        if (anikotoSlug) {
          const watchRes = await fetch(`https://anikoto.cz/watch/${encodeURIComponent(anikotoSlug)}`, {
            headers: { referer: 'https://anikoto.cz/', 'user-agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(1800),
          });
          if (watchRes.ok) {
            const watchHtml = await watchRes.text();
            const watchId = watchHtml.match(/<[^>]+\bid="watch-main"[^>]+\bdata-id="([^"]*)"/i)?.[1];
            if (watchId) {
              const epRes = await fetch(`https://anikoto.cz/ajax/episode/list/${watchId}?vrf=`, {
                headers: {
                  'x-requested-with': 'XMLHttpRequest',
                  referer: `https://anikoto.cz/watch/${anikotoSlug}`,
                  'user-agent': 'Mozilla/5.0',
                },
                signal: AbortSignal.timeout(1800),
              });
              if (epRes.ok) {
                const epJson = await epRes.json();
                const epHtml = epJson?.result || epJson?.html || '';
                const parsedEps = [];
                for (const m of epHtml.matchAll(/<a\b[^>]*data-ids="[^"]*"[^>]*>[\s\S]*?<\/a>/gi)) {
                  const tag = m[0];
                  const numRaw = tag.match(/data-num="([^"]*)"/i)?.[1]?.trim() ?? '';
                  const num = /^\d+$/.test(numRaw) ? Number(numRaw) : parsedEps.length + 1;
                  const ts = tag.match(/data-timestamp="([^"]*)"/i)?.[1]?.trim();
                  const airdate = ts && /^\d+$/.test(ts) ? new Date(Number(ts) * 1000).toISOString().split('T')[0] : null;
                  const epTitle = tag.match(/class="[^"]*d-title[^"]*"[^>]*>([\s\S]*?)<\/[^>]*>/i)?.[1]?.trim() || `Episode ${num}`;
                  parsedEps.push({
                    id: `${card.id}#${num}`,
                    anime_id: card.id,
                    n: num,
                    title: epTitle,
                    runtime: '24m',
                    runtime_seconds: 1440,
                    thumb: fallbackArt,
                    synopsis: '',
                    markers: '[]',
                    airdate,
                    external_id: `anikoto:${watchId}:${num}`,
                  });
                }
                if (parsedEps.length > 0) {
                  episodes = parsedEps.map((p) => ({
                    id: p.id,
                    n: p.n,
                    title: p.title,
                    runtime: p.runtime,
                    runtimeSeconds: p.runtime_seconds,
                    art: p.thumb,
                    thumb: p.thumb,
                    synopsis: p.synopsis,
                    markers: [],
                    airdate: p.airdate,
                  }));
                  for (const p of parsedEps) {
                    env.ANIHUB.prepare(
                      `INSERT OR IGNORE INTO episode (id, anime_id, n, title, runtime, runtime_seconds, thumb, synopsis, markers, airdate, external_id)
                       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`
                    ).bind(p.id, p.anime_id, p.n, p.title, p.runtime, p.runtime_seconds, p.thumb, p.synopsis, p.markers, p.airdate, p.external_id).run().catch(() => {});
                  }
                }
              }
            }
          }
        }
      } catch {}

      if (episodes.length === 0) {
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

    // Filter out unreleased episodes for ongoing shows so Watch page renders strictly streamable episodes
    if (card.status === 'Ongoing' || card.status === 'Airing') {
      const today = new Date().toISOString().split('T')[0];
      episodes = episodes.filter((ep) => {
        if (!ep.airdate) return ep.n === 1 || Boolean(ep.external_id);
        return ep.airdate <= today;
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
      episodes,
      seasons,
      providers: (provRows || []).map((p) => p.provider_id),
      providerMappings: Object.fromEntries((provRows || []).map((p) => [p.provider_id, p.provider_slug])),
      related: related.map(cardFromRow),
    });
  } catch (err) {
    return errorResponse(err);
  }
  }, { waitUntil });
};