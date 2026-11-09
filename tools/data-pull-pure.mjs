// @ts-check
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(import.meta.dirname, '..');
const DEFAULT_D1_DIR = path.join(ROOT, '.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject');

/**
 * Finds the local Miniflare SQLite file.
 * @returns {string}
 */
export function getLocalSqlitePath() {
  if (!fs.existsSync(DEFAULT_D1_DIR)) {
    throw new Error(`Local D1 directory not found: ${DEFAULT_D1_DIR}`);
  }
  const files = fs.readdirSync(DEFAULT_D1_DIR).filter(f => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
  if (files.length === 0) {
    throw new Error('No .sqlite database found in local miniflare D1 directory');
  }
  return path.join(DEFAULT_D1_DIR, files[0]);
}

/**
 * Computes sha256 of string or buffer.
 * @param {string | Buffer} content
 * @returns {string}
 */
function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Safely parses JSON string or returns fallback.
 * @param {string | null | undefined} str
 * @param {any} fallback
 */
function safeJson(str, fallback) {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

/**
 * Extracts pure catalog and reference data from database into output folder.
 * @param {{ source?: 'local' | 'remote', dbPath?: string, outDir?: string, limit?: number }} [opts]
 */
export async function pullPureCatalogData(opts = {}) {
  const source = opts.source || 'local';
  const outDir = opts.outDir || path.join(ROOT, 'data');
  const limit = typeof opts.limit === 'number' ? opts.limit : null;

  const catalogDir = path.join(outDir, 'catalog');
  const referenceDir = path.join(outDir, 'reference');

  fs.mkdirSync(catalogDir, { recursive: true });
  fs.mkdirSync(referenceDir, { recursive: true });

  const manifest = {
    exported_at: new Date().toISOString(),
    source,
    counts: {},
    files: {}
  };

  if (source === 'local') {
    const dbPath = opts.dbPath || getLocalSqlitePath();
    const db = new DatabaseSync(dbPath);

    // 1. Export Reference Tables
    const exportTable = (tableName, targetFile) => {
      try {
        const rows = db.prepare(`SELECT * FROM ${tableName}`).all();
        const jsonContent = JSON.stringify(rows, null, 2);
        const relPath = path.relative(outDir, targetFile).replace(/\\/g, '/');
        fs.writeFileSync(targetFile, jsonContent, 'utf8');
        manifest.counts[tableName] = rows.length;
        manifest.files[relPath] = sha256(jsonContent);
      } catch (err) {
        manifest.counts[tableName] = 0;
      }
    };

    exportTable('genre', path.join(referenceDir, 'genres.json'));
    exportTable('provider_route', path.join(referenceDir, 'provider_routes.json'));
    exportTable('anime_franchise_relation', path.join(referenceDir, 'franchise_relations.json'));
    exportTable('anime_id_map', path.join(referenceDir, 'id_map.json'));
    exportTable('anime_redirect', path.join(referenceDir, 'redirects.json'));

    // 2. Export Anime + Episodes + Genres + Themes
    const animeQuery = limit
      ? `SELECT * FROM anime ORDER BY rowid ASC LIMIT ${limit}`
      : `SELECT * FROM anime ORDER BY rowid ASC`;

    const animeRows = db.prepare(animeQuery).all();
    manifest.counts['anime'] = animeRows.length;

    let totalEpisodes = 0;

    for (const rawAnime of animeRows) {
      const anime = /** @type {Record<string, any>} */ (rawAnime);
      const id = anime.id;

      // Fetch genres
      const genreRows = db.prepare('SELECT genre_id FROM anime_genre WHERE anime_id = ?').all(id);
      const genres = genreRows.map(r => /** @type {any} */ (r).genre_id);

      // Fetch episodes
      const episodeRows = db.prepare('SELECT * FROM episode WHERE anime_id = ? ORDER BY n ASC').all(id);
      const episodes = episodeRows.map(rawEp => {
        const ep = /** @type {Record<string, any>} */ (rawEp);
        return {
          n: ep.n,
          title: ep.title,
          runtime: ep.runtime,
          runtime_seconds: ep.runtime_seconds,
          thumb: ep.thumb,
          synopsis: ep.synopsis,
          airdate: ep.airdate,
          markers: safeJson(ep.markers, []),
          external_id: ep.external_id
        };
      });
      totalEpisodes += episodes.length;

      // Fetch themes if table exists
      let themes = [];
      try {
        themes = db.prepare('SELECT kind, sequence, title, artist, episodes FROM anime_theme WHERE anime_id = ? ORDER BY sequence ASC').all(id);
      } catch {}

      // Fetch relations if table exists
      let relations = [];
      try {
        relations = db.prepare('SELECT related_anime_id, relation_type FROM anime_franchise_relation WHERE anime_id = ?').all(id);
      } catch {}

      const doc = {
        id: anime.id,
        title: anime.title,
        native: anime.native,
        year: anime.year,
        rating: anime.rating,
        season: anime.season,
        kind: anime.kind,
        status: anime.status,
        art: anime.art,
        key_art: anime.key_art,
        accent: anime.accent,
        synopsis: anime.synopsis,
        rank: anime.rank,
        trend_rank: anime.trend_rank,
        alt_seasons: safeJson(anime.alt_seasons, []),
        sched_day: anime.sched_day,
        sched_day_label: anime.sched_day_label,
        sched_date: anime.sched_date,
        sched_time: anime.sched_time,
        sched_season: anime.sched_season,
        sched_episode: anime.sched_episode,
        sched_sub_at: anime.sched_sub_at,
        sched_dub_at: anime.sched_dub_at,
        source_ids: safeJson(anime.source_ids, {}),
        skip_key_id: anime.skip_key_id,
        skip_key_space: anime.skip_key_space,
        episode_total: anime.episode_total,
        added_at: anime.added_at,
        search_text: anime.search_text,
        genres,
        episodes,
        themes,
        relations
      };

      const docJson = JSON.stringify(doc, null, 2);
      const filePath = path.join(catalogDir, `${id}.json`);
      fs.writeFileSync(filePath, docJson, 'utf8');

      const relPath = path.relative(outDir, filePath).replace(/\\/g, '/');
      manifest.files[relPath] = sha256(docJson);
    }

    manifest.counts['episode'] = totalEpisodes;

    // Write manifest
    fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    return {
      success: true,
      animeCount: animeRows.length,
      episodeCount: totalEpisodes,
      outDir
    };
  }

  throw new Error(`Source mode "${source}" not implemented yet`);
}

// CLI entrypoint
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const limitArg = process.argv.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : undefined;
  const sourceArg = process.argv.find(a => a.startsWith('--source='));
  const source = sourceArg?.split('=')[1] === 'remote' ? 'remote' : 'local';

  console.log(`[data-pull-pure] Starting pull (source: ${source}, limit: ${limit || 'all'})...`);
  pullPureCatalogData({ source, limit })
    .then(res => {
      console.log(`[data-pull-pure] Finished successfully: ${res.animeCount} anime, ${res.episodeCount} episodes.`);
    })
    .catch(err => {
      console.error('[data-pull-pure] Error:', err);
      process.exit(1);
    });
}
