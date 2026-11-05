// @ts-check
/**
 * tools/sync-franchise-relations.mjs
 *
 * Universal Franchise and Season Relation Sync Utility.
 * Integrates AniList GraphQL Relations and Jikan/MAL Relations with a 350ms token-bucket
 * rate limiter and local disk caching to maintain complete, authoritative season graphs.
 *
 * Persists bidirectional relation records into Cloudflare D1's `anime_franchise_relation`.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { findLocalD1DbPath } from './auto-sync-franchises.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
const CACHE_DIR = resolve(ROOT, 'tools/.cache');
const CACHE_FILE = resolve(CACHE_DIR, 'franchise-relations.json');

/**
 * Token-bucket rate limiter to enforce strict compliance with upstream API limits
 * (e.g. Jikan 3 req/sec, AniList 30 req/min).
 */
export class TokenBucketLimiter {
  /**
   * @param {number} minIntervalMs Minimum delay in ms between consecutive requests.
   */
  constructor(minIntervalMs = 350) {
    this.minIntervalMs = minIntervalMs;
    this.lastRequestTime = 0;
  }

  /**
   * Waits until the required interval has elapsed since the last request.
   * @returns {Promise<void>}
   */
  async wait() {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.minIntervalMs) {
      await new Promise((resolve) => setTimeout(resolve, this.minIntervalMs - elapsed));
    }
    this.lastRequestTime = Date.now();
  }
}

/**
 * Normalizes relation type strings from upstream APIs to internal taxonomy.
 * @param {string} rawType
 * @param {string} [format]
 * @returns {string} Normalized relation type: 'prequel', 'sequel', 'movie', 'side_story', 'spin_off', 'parent', 'alternative', or 'other'
 */
export function normalizeRelationType(rawType, format = '') {
  if (format && format.toUpperCase() === 'MOVIE') return 'movie';
  const norm = (rawType || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_');
  if (norm.includes('prequel')) return 'prequel';
  if (norm.includes('sequel')) return 'sequel';
  if (norm.includes('movie')) return 'movie';
  if (norm.includes('side_story')) return 'side_story';
  if (norm.includes('spin_off')) return 'spin_off';
  if (norm.includes('parent')) return 'parent';
  if (norm.includes('alternative') || norm.includes('alt')) return 'alternative';
  if (norm.includes('summary')) return 'summary';
  return 'other';
}

/**
 * Parses AniList relations response into canonical relation records.
 * @param {number} sourceAnilistId
 * @param {Array<{ relationType: string, node: { id: number, idMal?: number, format?: string, seasonYear?: number, title?: { romaji?: string, english?: string } } }>} edges
 * @param {Map<number, string>} anilistIdToAnimeId Map of AniList ID -> AniHub anime slug
 * @param {string} sourceAnimeId
 * @returns {Array<{ anime_id: string, related_id: string, relation_type: string, chronology_order: number }>}
 */
export function parseAnilistRelations(sourceAnilistId, edges, anilistIdToAnimeId, sourceAnimeId) {
  if (!Array.isArray(edges) || !sourceAnimeId) return [];
  const results = [];

  for (const edge of edges) {
    if (!edge?.node?.id) continue;
    const relatedAnimeId = anilistIdToAnimeId.get(edge.node.id);
    if (!relatedAnimeId || relatedAnimeId === sourceAnimeId) continue;

    const relType = normalizeRelationType(edge.relationType, edge.node.format);
    const year = edge.node.seasonYear || 0;

    results.push({
      anime_id: sourceAnimeId,
      related_id: relatedAnimeId,
      relation_type: relType,
      chronology_order: year,
    });
  }

  return results;
}

/**
 * Parses Jikan v4 relations response into canonical relation records.
 * @param {number} sourceMalId
 * @param {Array<{ relation: string, entry: Array<{ mal_id: number, type: string, name: string }> }>} data
 * @param {Map<number, string>} malIdToAnimeId Map of MAL ID -> AniHub anime slug
 * @param {string} sourceAnimeId
 * @returns {Array<{ anime_id: string, related_id: string, relation_type: string, chronology_order: number }>}
 */
export function parseJikanRelations(sourceMalId, data, malIdToAnimeId, sourceAnimeId) {
  if (!Array.isArray(data) || !sourceAnimeId) return [];
  const results = [];

  for (const group of data) {
    const rawRelation = group.relation;
    const entries = group.entry || [];
    for (const item of entries) {
      if (item.type !== 'anime' || !item.mal_id) continue;
      const relatedAnimeId = malIdToAnimeId.get(item.mal_id);
      if (!relatedAnimeId || relatedAnimeId === sourceAnimeId) continue;

      const relType = normalizeRelationType(rawRelation);
      results.push({
        anime_id: sourceAnimeId,
        related_id: relatedAnimeId,
        relation_type: relType,
        chronology_order: 0,
      });
    }
  }

  return results;
}

/**
 * Saves relations cache to disk for offline / instant fast builds.
 * @param {Record<string, any>} cacheData
 */
export function saveFranchiseCache(cacheData) {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(cacheData, null, 2), 'utf8');
}

/**
 * Loads relations cache from disk if available.
 * @returns {Record<string, any>}
 */
export function loadFranchiseCache() {
  if (!existsSync(CACHE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Merges heuristic relations with authoritative (AniList / Jikan / MAL) relations.
 * Authoritative relations override heuristics for the same (anime_id, related_id) pair.
 * @param {Array<{ anime_id: string, related_id: string, relation_type: string, chronology_order?: number }>} heuristic
 * @param {Array<{ anime_id: string, related_id: string, relation_type: string, chronology_order?: number }>} authoritative
 * @returns {Array<{ anime_id: string, related_id: string, relation_type: string, chronology_order: number }>}
 */
export function mergeFranchiseRelations(heuristic = [], authoritative = []) {
  const map = new Map();

  for (const item of heuristic) {
    if (!item?.anime_id || !item?.related_id || item.anime_id === item.related_id) continue;
    const key = `${item.anime_id}:${item.related_id}`;
    map.set(key, {
      anime_id: item.anime_id,
      related_id: item.related_id,
      relation_type: item.relation_type || 'sequel',
      chronology_order: item.chronology_order || 0,
    });
  }

  for (const item of authoritative) {
    if (!item?.anime_id || !item?.related_id || item.anime_id === item.related_id) continue;
    const key = `${item.anime_id}:${item.related_id}`;
    map.set(key, {
      anime_id: item.anime_id,
      related_id: item.related_id,
      relation_type: item.relation_type || 'sequel',
      chronology_order: item.chronology_order || 0,
    });
  }

  return Array.from(map.values());
}

/**
 * Persists an array of relations into the database table `anime_franchise_relation`.
 * @param {DatabaseSync} db
 * @param {Array<{ anime_id: string, related_id: string, relation_type: string, chronology_order?: number }>} relations
 * @returns {number} Inserted count
 */
export function persistFranchiseRelations(db, relations) {
  if (!relations || relations.length === 0) return 0;

  // Ensure table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS anime_franchise_relation (
      anime_id         TEXT NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
      related_id       TEXT NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
      relation_type    TEXT NOT NULL DEFAULT 'sequel',
      chronology_order INTEGER DEFAULT 0,
      created_at       TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (anime_id, related_id)
    );
    CREATE INDEX IF NOT EXISTS idx_afr_anime ON anime_franchise_relation(anime_id, chronology_order ASC);
    CREATE INDEX IF NOT EXISTS idx_afr_related ON anime_franchise_relation(related_id);
  `);

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO anime_franchise_relation (anime_id, related_id, relation_type, chronology_order, created_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `);

  db.exec('BEGIN TRANSACTION;');
  try {
    for (const rel of relations) {
      stmt.run(rel.anime_id, rel.related_id, rel.relation_type, rel.chronology_order || 0);
    }
    db.exec('COMMIT;');
    return relations.length;
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}
