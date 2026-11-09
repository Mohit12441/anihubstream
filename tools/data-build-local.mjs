// @ts-check
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { getLocalSqlitePath } from './data-pull-pure.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const SCHEMA_FILE = path.join(ROOT, 'schema.sql');

/**
 * Compiles data/ directory JSON files into a target SQLite database.
 * @param {{ dataDir?: string, dbPath?: string, recreate?: boolean }} [opts]
 */
export async function buildLocalDatabase(opts = {}) {
  const dataDir = opts.dataDir || path.join(ROOT, 'data');
  const dbPath = opts.dbPath || getLocalSqlitePath();
  const catalogDir = path.join(dataDir, 'catalog');
  const referenceDir = path.join(dataDir, 'reference');

  if (!fs.existsSync(catalogDir)) {
    throw new Error(`Catalog directory not found at: ${catalogDir}`);
  }

  // Ensure parent directory exists
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new DatabaseSync(dbPath);

  // Apply schema if file exists
  if (fs.existsSync(SCHEMA_FILE)) {
    const schemaSql = fs.readFileSync(SCHEMA_FILE, 'utf8');
    db.exec(schemaSql);
  }

  let animeInserted = 0;
  let episodesInserted = 0;

  // 1. Insert Reference Data
  const insertGenres = () => {
    const genresFile = path.join(referenceDir, 'genres.json');
    if (!fs.existsSync(genresFile)) return;
    try {
      const genres = JSON.parse(fs.readFileSync(genresFile, 'utf8'));
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO genre (id, label, tagline, art, accent, position)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      db.exec('BEGIN TRANSACTION');
      for (const g of genres) {
        stmt.run(g.id, g.label, g.tagline || '', g.art || '', g.accent || '', g.position || 0);
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      console.warn('[data-build] Warning inserting genres:', err);
    }
  };

  const insertRoutes = () => {
    const routesFile = path.join(referenceDir, 'provider_routes.json');
    if (!fs.existsSync(routesFile)) return;
    try {
      const routes = JSON.parse(fs.readFileSync(routesFile, 'utf8'));
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO provider_route (provider_id, route_pattern, target_upstream, priority, is_active, notes)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      db.exec('BEGIN TRANSACTION');
      for (const r of routes) {
        stmt.run(r.provider_id, r.route_pattern, r.target_upstream || null, r.priority || 0, r.is_active ? 1 : 0, r.notes || null);
      }
      db.exec('COMMIT');
    } catch {}
  };

  const insertIdMap = () => {
    const idMapFile = path.join(referenceDir, 'id_map.json');
    if (!fs.existsSync(idMapFile)) return;
    try {
      const mappings = JSON.parse(fs.readFileSync(idMapFile, 'utf8'));
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO anime_id_map (anime_id, anilist_id, mal_id, kitsu_id, anidb_id, tvdb_id, verified_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      db.exec('BEGIN TRANSACTION');
      for (const m of mappings) {
        stmt.run(m.anime_id, m.anilist_id || null, m.mal_id || null, m.kitsu_id || null, m.anidb_id || null, m.tvdb_id || null, m.verified_at || null);
      }
      db.exec('COMMIT');
    } catch {}
  };

  insertGenres();
  insertRoutes();
  insertIdMap();

  // 2. Prepare Anime & Episode Statements
  const insertAnimeStmt = db.prepare(`
    INSERT INTO anime (
      id, title, native, year, rating, season, kind, status, art, key_art, accent, synopsis,
      rank, trend_rank, alt_seasons, sched_day, sched_day_label, sched_date, sched_time,
      sched_season, sched_episode, sched_sub_at, sched_dub_at, source_ids, skip_key_id,
      skip_key_space, episode_total, added_at, search_text, catalogue_synced_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?
    ) ON CONFLICT(id) DO UPDATE SET
      title=excluded.title, native=excluded.native, year=excluded.year, rating=excluded.rating,
      season=excluded.season, kind=excluded.kind, status=excluded.status, art=excluded.art,
      key_art=excluded.key_art, accent=excluded.accent, synopsis=excluded.synopsis,
      rank=excluded.rank, trend_rank=excluded.trend_rank, alt_seasons=excluded.alt_seasons,
      sched_day=excluded.sched_day, sched_day_label=excluded.sched_day_label,
      sched_date=excluded.sched_date, sched_time=excluded.sched_time,
      sched_season=excluded.sched_season, sched_episode=excluded.sched_episode,
      sched_sub_at=excluded.sched_sub_at, sched_dub_at=excluded.sched_dub_at,
      source_ids=excluded.source_ids, skip_key_id=excluded.skip_key_id,
      skip_key_space=excluded.skip_key_space, episode_total=excluded.episode_total,
      search_text=excluded.search_text, catalogue_synced_at=excluded.catalogue_synced_at
  `);

  const insertGenreMapStmt = db.prepare(`
    INSERT OR REPLACE INTO anime_genre (anime_id, genre_id) VALUES (?, ?)
  `);

  const insertEpisodeStmt = db.prepare(`
    INSERT OR REPLACE INTO episode (
      id, anime_id, n, title, runtime, runtime_seconds, thumb, synopsis, markers, airdate, external_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // 3. Process Catalog in batches
  const animeFiles = fs.readdirSync(catalogDir).filter(f => f.endsWith('.json'));

  db.exec('BEGIN TRANSACTION');

  for (let i = 0; i < animeFiles.length; i++) {
    const filePath = path.join(catalogDir, animeFiles[i]);
    const doc = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    // Insert anime
    insertAnimeStmt.run(
      doc.id,
      doc.title,
      doc.native || '',
      doc.year || 0,
      doc.rating || 0,
      doc.season || '',
      doc.kind || 'TV',
      doc.status || 'Finished',
      doc.art || '',
      doc.key_art || '',
      doc.accent || '#336699',
      doc.synopsis || '',
      doc.rank || null,
      doc.trend_rank || null,
      JSON.stringify(doc.alt_seasons || []),
      doc.sched_day || null,
      doc.sched_day_label || null,
      doc.sched_date || null,
      doc.sched_time || null,
      doc.sched_season || null,
      doc.sched_episode || null,
      doc.sched_sub_at || null,
      doc.sched_dub_at || null,
      JSON.stringify(doc.source_ids || {}),
      doc.skip_key_id || null,
      doc.skip_key_space || null,
      doc.episode_total || (doc.episodes ? doc.episodes.length : 0),
      doc.added_at || new Date().toISOString(),
      doc.search_text || `${doc.title} ${doc.native || ''}`.toLowerCase(),
      Date.now()
    );
    animeInserted++;

    // Insert genres
    if (Array.isArray(doc.genres)) {
      for (const g of doc.genres) {
        insertGenreMapStmt.run(doc.id, g);
      }
    }

    // Insert episodes
    if (Array.isArray(doc.episodes)) {
      for (const ep of doc.episodes) {
        const epId = `${doc.id}#${ep.n}`;
        insertEpisodeStmt.run(
          epId,
          doc.id,
          ep.n,
          ep.title || `Episode ${ep.n}`,
          ep.runtime || '24:00',
          ep.runtime_seconds || 1440,
          ep.thumb || '',
          ep.synopsis || '',
          JSON.stringify(ep.markers || []),
          ep.airdate || null,
          ep.external_id || null
        );
        episodesInserted++;
      }
    }

    // Commit periodically every 500 anime to avoid huge transaction journal
    if ((i + 1) % 500 === 0) {
      db.exec('COMMIT');
      db.exec('BEGIN TRANSACTION');
    }
  }

  db.exec('COMMIT');
  db.close();

  return {
    success: true,
    animeInserted,
    episodesInserted,
    dbPath
  };
}

// CLI entrypoint
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  console.log('[data-build] Compiling data/ into local Miniflare SQLite...');
  buildLocalDatabase()
    .then(res => {
      console.log(`[data-build] Build complete: ${res.animeInserted} anime, ${res.episodesInserted} episodes compiled.`);
    })
    .catch(err => {
      console.error('[data-build] Build failed:', err);
      process.exit(1);
    });
}
