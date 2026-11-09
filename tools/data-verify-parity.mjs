// @ts-check
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { getLocalSqlitePath } from './data-pull-pure.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');

/**
 * Checks parity between database and data/ directory.
 * @param {{ source?: 'local' | 'remote', dbPath?: string, dataDir?: string }} [opts]
 */
export async function verifyDataParity(opts = {}) {
  const dataDir = opts.dataDir || path.join(ROOT, 'data');
  const catalogDir = path.join(dataDir, 'catalog');
  const referenceDir = path.join(dataDir, 'reference');

  if (!fs.existsSync(catalogDir) || !fs.existsSync(referenceDir)) {
    throw new Error('Data directories do not exist. Run "npm run data:pull-pure" first.');
  }

  const dbPath = opts.dbPath || getLocalSqlitePath();
  const db = new DatabaseSync(dbPath);

  // 1. Count rows in DB
  const getDbCount = (table) => {
    try {
      const res = db.prepare(`SELECT count(*) as c FROM ${table}`).get();
      return /** @type {any} */ (res)?.c || 0;
    } catch {
      return 0;
    }
  };

  // 2. Count rows in data/ folder
  const animeFiles = fs.readdirSync(catalogDir).filter(f => f.endsWith('.json'));
  let dataEpisodeCount = 0;

  for (const f of animeFiles) {
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(catalogDir, f), 'utf8'));
      if (Array.isArray(doc.episodes)) {
        dataEpisodeCount += doc.episodes.length;
      }
    } catch {}
  }

  const readRefArrayCount = (fileName) => {
    const filePath = path.join(referenceDir, fileName);
    if (!fs.existsSync(filePath)) return 0;
    try {
      const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return Array.isArray(content) ? content.length : 0;
    } catch {
      return 0;
    }
  };

  const checks = [
    { table: 'anime', dbCount: getDbCount('anime'), dataCount: animeFiles.length },
    { table: 'episode', dbCount: getDbCount('episode'), dataCount: dataEpisodeCount },
    { table: 'genre', dbCount: getDbCount('genre'), dataCount: readRefArrayCount('genres.json') },
    { table: 'anime_franchise_relation', dbCount: getDbCount('anime_franchise_relation'), dataCount: readRefArrayCount('franchise_relations.json') },
    { table: 'anime_id_map', dbCount: getDbCount('anime_id_map'), dataCount: readRefArrayCount('id_map.json') },
    { table: 'provider_route', dbCount: getDbCount('provider_route'), dataCount: readRefArrayCount('provider_routes.json') },
    { table: 'anime_redirect', dbCount: getDbCount('anime_redirect'), dataCount: readRefArrayCount('redirects.json') }
  ];

  let mismatches = 0;
  const tableChecks = checks.map(c => {
    const discrepancy = Math.abs(c.dbCount - c.dataCount);
    if (discrepancy > 0) mismatches++;
    return {
      table: c.table,
      dbCount: c.dbCount,
      dataCount: c.dataCount,
      discrepancy,
      status: discrepancy === 0 ? 'PARITY_OK' : 'MISMATCH'
    };
  });

  return {
    isPureParity: mismatches === 0,
    mismatches,
    tableChecks,
    timestamp: new Date().toISOString()
  };
}

// CLI entrypoint
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  verifyDataParity()
    .then(report => {
      console.log('=== PURE DATA PARITY REPORT ===');
      console.table(report.tableChecks);
      console.log(`Parity Status: ${report.isPureParity ? '100% PURE PARITY (0 mismatches)' : `FAILED (${report.mismatches} mismatches)`}`);
      if (!report.isPureParity) process.exit(1);
    })
    .catch(err => {
      console.error('[verifyDataParity] Failed:', err);
      process.exit(1);
    });
}
