// @ts-check
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

/**
 * Safely escapes single quotes for SQLite.
 * @param {any} val
 * @returns {string}
 */
export function sqlVal(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return Number.isFinite(val) ? String(val) : 'NULL';
  if (typeof val === 'boolean') return val ? '1' : '0';
  const str = String(val).replace(/'/g, "''");
  return `'${str}'`;
}

/**
 * Generates SQL upsert statements from an array of modified documents.
 * @param {{
 *   modifiedDocs: Array<{ type: 'anime' | 'reference', doc: Record<string, any>, relPath?: string }>,
 *   batchSize?: number,
 *   maxWrites?: number,
 *   force?: boolean
 * }} opts
 */
export function generateDeltaSqlFromDocs(opts) {
  const { modifiedDocs, batchSize = 50, maxWrites = 5000, force = false } = opts;
  const statements = [];

  for (const item of modifiedDocs) {
    if (item.type === 'anime') {
      const doc = item.doc;
      const id = doc.id;

      // 1. Anime table UPSERT
      const animeSql = `INSERT INTO anime (
        id, title, native, year, rating, season, kind, status, art, key_art, accent, synopsis,
        rank, trend_rank, alt_seasons, sched_day, sched_day_label, sched_date, sched_time,
        sched_season, sched_episode, sched_sub_at, sched_dub_at, source_ids, skip_key_id,
        skip_key_space, episode_total, added_at, search_text, catalogue_synced_at
      ) VALUES (
        ${sqlVal(doc.id)}, ${sqlVal(doc.title)}, ${sqlVal(doc.native || '')}, ${sqlVal(doc.year || 0)},
        ${sqlVal(doc.rating || 0)}, ${sqlVal(doc.season || '')}, ${sqlVal(doc.kind || 'TV')},
        ${sqlVal(doc.status || 'Finished')}, ${sqlVal(doc.art || '')}, ${sqlVal(doc.key_art || '')},
        ${sqlVal(doc.accent || '#336699')}, ${sqlVal(doc.synopsis || '')}, ${sqlVal(doc.rank)},
        ${sqlVal(doc.trend_rank)}, ${sqlVal(JSON.stringify(doc.alt_seasons || []))},
        ${sqlVal(doc.sched_day)}, ${sqlVal(doc.sched_day_label)}, ${sqlVal(doc.sched_date)},
        ${sqlVal(doc.sched_time)}, ${sqlVal(doc.sched_season)}, ${sqlVal(doc.sched_episode)},
        ${sqlVal(doc.sched_sub_at)}, ${sqlVal(doc.sched_dub_at)},
        ${sqlVal(JSON.stringify(doc.source_ids || {}))}, ${sqlVal(doc.skip_key_id)},
        ${sqlVal(doc.skip_key_space)}, ${sqlVal(doc.episode_total || (doc.episodes?.length || 0))},
        ${sqlVal(doc.added_at || new Date().toISOString())},
        ${sqlVal(doc.search_text || `${doc.title} ${doc.native || ''}`.toLowerCase())},
        ${Date.now()}
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
        search_text=excluded.search_text, catalogue_synced_at=excluded.catalogue_synced_at;`;

      statements.push(animeSql);

      // 2. Genres
      if (Array.isArray(doc.genres)) {
        for (const g of doc.genres) {
          statements.push(`INSERT OR REPLACE INTO anime_genre (anime_id, genre_id) VALUES (${sqlVal(id)}, ${sqlVal(g)});`);
        }
      }

      // 3. Episodes
      if (Array.isArray(doc.episodes)) {
        for (const ep of doc.episodes) {
          const epId = `${id}#${ep.n}`;
          statements.push(`INSERT OR REPLACE INTO episode (
            id, anime_id, n, title, runtime, runtime_seconds, thumb, synopsis, markers, airdate, external_id
          ) VALUES (
            ${sqlVal(epId)}, ${sqlVal(id)}, ${sqlVal(ep.n)}, ${sqlVal(ep.title || `Episode ${ep.n}`)},
            ${sqlVal(ep.runtime || '24:00')}, ${sqlVal(ep.runtime_seconds || 1440)}, ${sqlVal(ep.thumb || '')},
            ${sqlVal(ep.synopsis || '')}, ${sqlVal(JSON.stringify(ep.markers || []))},
            ${sqlVal(ep.airdate || null)}, ${sqlVal(ep.external_id || null)}
          );`);
        }
      }
    }
  }

  const totalWrites = statements.length;

  if (totalWrites > maxWrites && !force) {
    throw new Error(`Write quota ceiling exceeded: generated ${totalWrites} writes, ceiling is ${maxWrites}. Use --force to override.`);
  }

  // Chunk statements into transactions
  const batches = [];
  for (let i = 0; i < statements.length; i += batchSize) {
    batches.push(statements.slice(i, i + batchSize));
  }

  return {
    success: true,
    totalWrites,
    batchCount: batches.length,
    batches
  };
}

/**
 * Gets changed data files between two Git revisions.
 * @param {string} [fromRef]
 * @param {string} [toRef]
 * @returns {string[]}
 */
export function getChangedDataFiles(fromRef = 'HEAD~1', toRef = 'HEAD') {
  try {
    const output = execSync(`git diff --name-only ${fromRef} ${toRef} -- data/`, { encoding: 'utf8', cwd: ROOT });
    return output.split('\n').map(s => s.trim()).filter(Boolean);
  } catch (err) {
    console.warn(`[getChangedDataFiles] Git diff failed against ${fromRef}..${toRef}:`, err.message);
    return [];
  }
}

// CLI entrypoint
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const dryRun = process.argv.includes('--dry-run');
  const force = process.argv.includes('--force');
  const fromArg = process.argv.find(a => a.startsWith('--from='));
  const toArg = process.argv.find(a => a.startsWith('--to='));

  const fromRef = fromArg ? fromArg.split('=')[1] : 'HEAD~1';
  const toRef = toArg ? toArg.split('=')[1] : 'HEAD';

  console.log(`[data-diff-to-d1] Checking Git diff from ${fromRef} to ${toRef}...`);
  const changedFiles = getChangedDataFiles(fromRef, toRef);
  console.log(`[data-diff-to-d1] Found ${changedFiles.length} changed data files.`);

  if (changedFiles.length === 0) {
    console.log('[data-diff-to-d1] No data changes detected. Cloudflare D1 write quota consumed: 0.');
    process.exit(0);
  }

  const modifiedDocs = [];
  for (const f of changedFiles) {
    if (f.startsWith('data/catalog/') && f.endsWith('.json')) {
      const fullPath = path.join(ROOT, f);
      if (fs.existsSync(fullPath)) {
        try {
          const doc = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
          modifiedDocs.push({ type: 'anime', doc, relPath: f });
        } catch {}
      }
    }
  }

  const delta = generateDeltaSqlFromDocs({ modifiedDocs, force });
  console.log(`[data-diff-to-d1] Generated ${delta.totalWrites} SQL statements across ${delta.batchCount} batch(es).`);

  if (dryRun) {
    console.log('[data-diff-to-d1] DRY RUN complete. No changes applied to Cloudflare D1.');
    process.exit(0);
  }

  // Execute batches against remote Cloudflare D1
  const tempSqlFile = path.join(ROOT, 'tools', '.cache', 'temp_delta_deploy.sql');
  fs.mkdirSync(path.dirname(tempSqlFile), { recursive: true });

  for (let b = 0; b < delta.batches.length; b++) {
    const batchStatements = delta.batches[b];
    const sqlContent = ['BEGIN TRANSACTION;', ...batchStatements, 'COMMIT;'].join('\n');
    fs.writeFileSync(tempSqlFile, sqlContent, 'utf8');

    console.log(`[data-diff-to-d1] Applying batch ${b + 1}/${delta.batchCount} (${batchStatements.length} statements) to Cloudflare D1...`);
    execSync(`npx wrangler d1 execute anihub --remote --file="${tempSqlFile}"`, { stdio: 'inherit', cwd: ROOT });
  }

  if (fs.existsSync(tempSqlFile)) {
    fs.rmSync(tempSqlFile, { force: true });
  }

  console.log(`[data-diff-to-d1] Successfully deployed delta to Cloudflare D1! Total writes: ${delta.totalWrites}, reads: 0.`);
}
