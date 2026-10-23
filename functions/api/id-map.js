// @ts-check
import { HttpError, errorResponse, json, ok } from './_lib.js';

/**
 * ID Mapping Edge API:
 * Resolves cross-referenced IDs (AniList, Kitsu, MyAnimeList) and provider slugs.
 * Used by Federated Search and Playback to correlate metadata providers with streaming sources.
 */

export const onRequestGet = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const animeId = url.searchParams.get('animeId');
    const malId = url.searchParams.get('malId');
    const anilistId = url.searchParams.get('anilistId');
    const kitsuId = url.searchParams.get('kitsuId');

    if (!animeId && !malId && !anilistId && !kitsuId) {
      throw new HttpError(400, 'bad_request', 'At least one identifier (animeId, malId, anilistId, kitsuId) must be provided');
    }

    let row = null;

    if (animeId) {
      row = await env.ANIHUB.prepare(
        `SELECT anime_id, mal_id, anilist_id, kitsu_id, anikoto_slug, hianime_slug, aniwatch_slug, adb_slug, waw_slug, updated_at
         FROM anime_id_map WHERE anime_id = ?1`
      ).bind(animeId).first();
    } else if (malId) {
      row = await env.ANIHUB.prepare(
        `SELECT anime_id, mal_id, anilist_id, kitsu_id, anikoto_slug, hianime_slug, aniwatch_slug, adb_slug, waw_slug, updated_at
         FROM anime_id_map WHERE mal_id = ?1`
      ).bind(Number(malId)).first();
    } else if (anilistId) {
      row = await env.ANIHUB.prepare(
        `SELECT anime_id, mal_id, anilist_id, kitsu_id, anikoto_slug, hianime_slug, aniwatch_slug, adb_slug, waw_slug, updated_at
         FROM anime_id_map WHERE anilist_id = ?1`
      ).bind(Number(anilistId)).first();
    } else if (kitsuId) {
      row = await env.ANIHUB.prepare(
        `SELECT anime_id, mal_id, anilist_id, kitsu_id, anikoto_slug, hianime_slug, aniwatch_slug, adb_slug, waw_slug, updated_at
         FROM anime_id_map WHERE kitsu_id = ?1`
      ).bind(Number(kitsuId)).first();
    }

    // Fallback: Check anime table if not yet cached in anime_id_map
    if (!row && animeId) {
      const animeRow = await env.ANIHUB.prepare(
        'SELECT id, source_ids, skip_key_id, skip_key_space FROM anime WHERE id = ?1'
      ).bind(animeId).first();

      if (animeRow) {
        let sources = {};
        try {
          sources = JSON.parse(animeRow.source_ids || '{}');
        } catch {
          sources = {};
        }

        const mal = sources.mal || (animeRow.skip_key_space === 'mal' ? animeRow.skip_key_id : null);
        const anilist = sources.anilist || null;
        const kitsu = sources.kitsu || (animeRow.skip_key_space === 'kitsu' ? animeRow.skip_key_id : null);

        return ok({
          animeId: animeRow.id,
          malId: mal ? Number(mal) : null,
          anilistId: anilist ? Number(anilist) : null,
          kitsuId: kitsu ? Number(kitsu) : null,
          anikotoSlug: null,
          hianimeSlug: null,
          aniwatchSlug: null,
          adbSlug: null,
          wawSlug: null,
          fromCatalogue: true,
        });
      }
    }

    if (!row) {
      return json({ found: false }, { status: 404, cache: 'public, max-age=300' });
    }

    let providers = [];
    try {
      const targetId = row ? row.anime_id : animeId;
      if (targetId) {
        const { results: provs } = await env.ANIHUB.prepare(
          `SELECT provider_id, provider_slug, confidence FROM anime_provider_mapping WHERE anime_id = ?1`
        ).bind(targetId).all();
        providers = provs || [];
      }
    } catch {}

    return ok({
      animeId: row.anime_id,
      malId: row.mal_id,
      anilistId: row.anilist_id,
      kitsuId: row.kitsu_id,
      anikotoSlug: row.anikoto_slug,
      hianimeSlug: row.hianime_slug,
      aniwatchSlug: row.aniwatch_slug,
      adbSlug: row.adb_slug,
      wawSlug: row.waw_slug,
      providers,
      updatedAt: row.updated_at,
      found: true,
    });
  } catch (err) {
    return errorResponse(err);
  }
};

export const onRequestPost = async ({ request, env }) => {
  try {
    const body = await request.json().catch(() => null);
    if (!body || !body.animeId) {
      throw new HttpError(400, 'bad_request', 'animeId is required');
    }

    const animeId = String(body.animeId).trim();
    const malId = body.malId ? Number(body.malId) : null;
    const anilistId = body.anilistId ? Number(body.anilistId) : null;
    const kitsuId = body.kitsuId ? Number(body.kitsuId) : null;
    const anikotoSlug = body.anikotoSlug ? String(body.anikotoSlug).trim() : null;
    const hianimeSlug = body.hianimeSlug ? String(body.hianimeSlug).trim() : null;
    const aniwatchSlug = body.aniwatchSlug ? String(body.aniwatchSlug).trim() : null;
    const adbSlug = body.adbSlug ? String(body.adbSlug).trim() : null;
    const wawSlug = body.wawSlug ? String(body.wawSlug).trim() : null;

    await env.ANIHUB.prepare(
      `INSERT INTO anime_id_map (
        anime_id, mal_id, anilist_id, kitsu_id,
        anikoto_slug, hianime_slug, aniwatch_slug, adb_slug, waw_slug, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, datetime('now'))
      ON CONFLICT(anime_id) DO UPDATE SET
        mal_id = coalesce(excluded.mal_id, anime_id_map.mal_id),
        anilist_id = coalesce(excluded.anilist_id, anime_id_map.anilist_id),
        kitsu_id = coalesce(excluded.kitsu_id, anime_id_map.kitsu_id),
        anikoto_slug = coalesce(excluded.anikoto_slug, anime_id_map.anikoto_slug),
        hianime_slug = coalesce(excluded.hianime_slug, anime_id_map.hianime_slug),
        aniwatch_slug = coalesce(excluded.aniwatch_slug, anime_id_map.aniwatch_slug),
        adb_slug = coalesce(excluded.adb_slug, anime_id_map.adb_slug),
        waw_slug = coalesce(excluded.waw_slug, anime_id_map.waw_slug),
        updated_at = datetime('now')`
    ).bind(
      animeId, malId, anilistId, kitsuId,
      anikotoSlug, hianimeSlug, aniwatchSlug, adbSlug, wawSlug
    ).run();

    // Synchronize into normalized anime_provider_mapping table
    const providerEntries = [
      { id: 'anikoto', slug: anikotoSlug },
      { id: 'hianime', slug: hianimeSlug },
      { id: 'aniwatch', slug: aniwatchSlug },
      { id: 'watchanimeworld', slug: wawSlug },
    ];

    for (const p of providerEntries) {
      if (p.slug) {
        await env.ANIHUB.prepare(
          `INSERT INTO anime_provider_mapping (anime_id, provider_id, provider_slug, confidence)
           VALUES (?1, ?2, ?3, 1.0)
           ON CONFLICT(anime_id, provider_id) DO UPDATE SET
             provider_slug = excluded.provider_slug,
             updated_at = datetime('now')`
        ).bind(animeId, p.id, p.slug).run().catch(() => null);
      }
    }

    return ok({ success: true, animeId });
  } catch (err) {
    return errorResponse(err);
  }
};
