// @ts-check
/**
 * cloud-sync/sync-hianime.mjs — Automated cloud sync for HiAnime catalog.
 *
 * Walks HiAnime's official JSON catalog endpoint (`POST https://animehot.cc/api/filter`),
 * maps metadata into Cloudflare D1 database (`anime`, `anime_genre`, `source_ids`),
 * preserves distributed leases (`sync_lock`), and persists cursor progress in `sync_meta`.
 *
 * Runs on a recurring schedule in GitHub Actions (`.github/workflows/hianime-sync.yml`)
 * and can be run standalone:
 *
 *   node cloud-sync/sync-hianime.mjs
 */

import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { d1All, d1First, d1Query } from './d1.mjs';
import {
  acquireLease,
  getCursor,
  leaseKeeper,
  recordRun,
  releaseLease,
  setCursor,
  spend,
  utcDay,
} from './state.mjs';
import { slugify } from './sync-anilist.mjs';
import { foldSearch } from '../functions/api/_lib.js';

const RUN_ID = randomUUID();
const ENDPOINT = 'hianime';
const LEASE = 'hianime';
const OWNER = `${ENDPOINT}-${RUN_ID}`;
const CURSOR_KEY = 'cloud_hianime_cursor';
const HIANIME_API = 'https://animehot.cc/api';
const USER_AGENT = 'AniHubStream/1.0 (HiAnime cloud catalog sync; https://anihubstream.com)';

const intEnv = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive integer, got ${raw}`);
  return n;
};

export const PAGES_PER_RUN = intEnv('HIANIME_PAGES_PER_RUN', 4);
export const PAGE_SIZE = Math.min(50, intEnv('HIANIME_PAGE_SIZE', 50));
const TIMEOUT_MS = intEnv('HIANIME_TIMEOUT_MS', 25_000);
const SLEEP_BETWEEN_PAGES_MS = intEnv('HIANIME_PAGE_DELAY_MS', 1_500);

const PALETTE = ['#ff1f4a', '#a24bff', '#3b82ff', '#ff9420', '#ffc247', '#2ee6a8', '#24d3ee', '#ff3d8b', '#8b5cf6', '#2f7bff'];
export const paletteAccent = (id) => PALETTE[Math.abs([...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)) % PALETTE.length];

const KIND_BY_TYPE = {
  tv: 'TV',
  tv_special: 'Special',
  tv_movie: 'Movie',
  ona: 'ONA',
  ova: 'OVA',
  movie: 'Movie',
  special: 'Special',
  music: 'Special',
};

const STATUS_BY_LABEL = {
  'finished airing': 'Finished',
  'currently airing': 'Ongoing',
  'not yet aired': 'Upcoming',
  'finished airing, pending sequel': 'Finished',
  'currently airing, pending sequel': 'Ongoing',
};

function yearOf(aired) {
  const m = /\b(19|20)\d{2}\b/.exec(String(aired ?? ''));
  return m ? Number(m[0]) : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

/**
 * Fetch one batch from HiAnime filter endpoint.
 */
export async function fetchHiAnimePage(page = 1, limit = PAGE_SIZE, signal) {
  const res = await fetch(`${HIANIME_API}/filter`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': USER_AGENT,
      referer: 'https://animehot.cc/',
    },
    body: JSON.stringify({ page, limit, keyword: '' }),
    signal: signal || AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`HiAnime /filter returned HTTP ${res.status}`);
  }

  const json = await res.json();
  return {
    results: Array.isArray(json?.results) ? json.results : [],
    total: Number(json?.total) || 0,
    page: Number(json?.page) || page,
    totalPages: Number(json?.totalPages) || 1,
  };
}

/**
 * Maps a raw HiAnime item into an anime record.
 */
export function mapHiAnimeItem(item, existingRow = null) {
  if (!item?.title || !item?.slug) return null;

  const rawTitle = String(item.title).trim();
  const rawSlug = String(item.slug).trim();
  const id = slugify(rawTitle) || rawSlug;

  const malId = Number.isInteger(Number(item.mal_id)) && Number(item.mal_id) > 0 ? Number(item.mal_id) : null;
  const scoreNum = Number(item.Score);
  const rating = Number.isFinite(scoreNum) && scoreNum > 0 ? Math.round(scoreNum * 10) : null;
  const year = yearOf(item.Aired);
  const kind = KIND_BY_TYPE[String(item.Type || '').toLowerCase()] || 'TV';
  const status = STATUS_BY_LABEL[String(item.Status || '').toLowerCase()] || 'Finished';

  const epTotalNum = Number(item.totalEpisodes);
  const epSubNum = Number(item.totalSub ?? item.totalSubbed);
  const episodeCount = Number.isInteger(epTotalNum) && epTotalNum > 0 ? epTotalNum : Number.isInteger(epSubNum) && epSubNum > 0 ? epSubNum : 1;

  let existingSources = {};
  if (existingRow?.source_ids) {
    try {
      existingSources = typeof existingRow.source_ids === 'string' ? JSON.parse(existingRow.source_ids) : existingRow.source_ids;
    } catch {}
  }

  const mergedSources = {
    ...existingSources,
    hianime: rawSlug,
    ...(malId ? { mal: malId } : {}),
  };

  const synonyms = [...new Set([item.alternateTitle, item.English].filter((v) => v && typeof v === 'string' && v.trim() !== rawTitle))];
  const searchText = foldSearch([rawTitle, item.Japanese, ...synonyms].filter(Boolean).join(' '));

  return {
    id,
    title: rawTitle,
    native: item.Japanese ? String(item.Japanese).trim() : null,
    year,
    rating,
    season: year ? `Year ${year}` : 'Anime',
    kind,
    status,
    art: item.image ? String(item.image).trim() : null,
    key_art: item.landScapeImage ? String(item.landScapeImage).trim() : null,
    accent: paletteAccent(id),
    synopsis: item.synopsis ? String(item.synopsis).trim() : null,
    episode_total: episodeCount,
    episode_count: episodeCount,
    source_ids: JSON.stringify(mergedSources),
    search_text: searchText,
    genres: Array.isArray(item.genres) ? item.genres.map(String).filter(Boolean) : [],
    cloud_synced_at: Date.now(),
  };
}

/**
 * Execute one scheduled sync run.
 */
export async function syncHiAnime({ pagesPerRun = PAGES_PER_RUN, force = false } = {}) {
  const startedAt = Date.now();
  console.log(`[hianime-sync] starting run ${RUN_ID} (pages: ${pagesPerRun})`);

  let leaseHeld = false;
  if (!force) {
    leaseHeld = await acquireLease(LEASE, OWNER);
    if (!leaseHeld) {
      console.warn(`[hianime-sync] lease '${LEASE}' is already held by another runner; exiting cleanly`);
      return { status: 'skipped', reason: 'lease_held' };
    }
  }

  const keeper = leaseKeeper(LEASE, OWNER);
  let cursor = (await getCursor(CURSOR_KEY)) || { page: 1, totalPages: 55, totalSynced: 0 };
  let startPage = Number.isInteger(cursor.page) && cursor.page >= 1 ? cursor.page : 1;
  let itemsProcessed = 0;
  let itemsCreated = 0;
  let itemsUpdated = 0;

  try {
    for (let p = 0; p < pagesPerRun; p++) {
      const currentPage = startPage + p;
      if (cursor.totalPages && currentPage > cursor.totalPages) {
        console.log(`[hianime-sync] reached total pages (${cursor.totalPages}); resetting cursor to page 1`);
        startPage = 1;
        cursor.page = 1;
        break;
      }

      console.log(`[hianime-sync] fetching page ${currentPage} (pageSize: ${PAGE_SIZE})`);
      await spend(ENDPOINT, utcDay());
      await keeper();

      const batch = await fetchHiAnimePage(currentPage, PAGE_SIZE);
      if (batch.totalPages && batch.totalPages !== cursor.totalPages) {
        cursor.totalPages = batch.totalPages;
      }

      if (!batch.results.length) {
        console.log(`[hianime-sync] page ${currentPage} returned 0 results`);
        break;
      }

      for (const item of batch.results) {
        if (!item?.title || !item?.slug) continue;
        const targetSlug = slugify(item.title) || item.slug;

        // Check if row already exists
        const existing = await d1First('SELECT id, source_ids FROM anime WHERE id = ?1', [targetSlug]);
        const record = mapHiAnimeItem(item, existing);
        if (!record) continue;

        if (existing) {
          // Update existing row
          await d1Query(
            `UPDATE anime SET
              rating = COALESCE(?1, rating),
              art = COALESCE(?2, art),
              key_art = COALESCE(?3, key_art),
              synopsis = COALESCE(?4, synopsis),
              episode_total = COALESCE(?5, episode_total),
              source_ids = ?6,
              cloud_synced_at = ?7
            WHERE id = ?8`,
            [record.rating, record.art, record.key_art, record.synopsis, record.episode_total, record.source_ids, record.cloud_synced_at, record.id],
          );
          itemsUpdated++;
        } else {
          // Insert new row
          await d1Query(
            `INSERT INTO anime (
              id, title, native, year, rating, season, kind, status,
              art, key_art, accent, synopsis, episode_total, source_ids, search_text, cloud_synced_at
            ) VALUES (
              ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
              ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16
            ) ON CONFLICT(id) DO UPDATE SET
              source_ids = excluded.source_ids,
              cloud_synced_at = excluded.cloud_synced_at`,
            [
              record.id,
              record.title,
              record.native ?? '',
              record.year ?? 0,
              record.rating ?? 0,
              record.season ?? 'Anime',
              record.kind ?? 'TV',
              record.status ?? 'Finished',
              record.art ?? '',
              record.key_art ?? '',
              record.accent ?? '#3b82ff',
              record.synopsis ?? '',
              record.episode_total ?? 1,
              record.source_ids,
              record.search_text ?? '',
              record.cloud_synced_at,
            ],
          );
          itemsCreated++;
        }

        itemsProcessed++;
      }

      cursor.page = currentPage + 1;
      cursor.totalSynced = (cursor.totalSynced || 0) + batch.results.length;
      cursor.updatedAt = Date.now();
      await setCursor(CURSOR_KEY, cursor);

      if (p < pagesPerRun - 1) {
        await sleep(SLEEP_BETWEEN_PAGES_MS);
      }
    }

    const durationMs = Date.now() - startedAt;
    const summary = {
      runId: RUN_ID,
      itemsProcessed,
      itemsCreated,
      itemsUpdated,
      nextPage: cursor.page,
      totalPages: cursor.totalPages,
      durationMs,
    };

    await recordRun(RUN_ID, ENDPOINT, startedAt, durationMs, 'success', JSON.stringify(summary));
    console.log(`[hianime-sync] completed successfully:`, summary);
    return summary;
  } finally {
    if (leaseHeld) {
      await releaseLease(LEASE, OWNER).catch(() => {});
    }
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename);
if (isMain) {
  syncHiAnime()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`[hianime-sync] fatal:`, err);
      process.exit(1);
    });
}
