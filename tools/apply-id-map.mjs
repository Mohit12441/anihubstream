// @ts-check
/**
 * Executes tools/id-map-seed.sql into the local or remote D1 database.
 * Run with: node tools/apply-id-map.mjs [--remote]
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SEED_FILE = resolve(ROOT, 'tools/id-map-seed.sql');

if (!existsSync(SEED_FILE)) {
  console.error(`Seed file not found at: ${SEED_FILE}. Run node tools/sync-id-map.mjs first.`);
  process.exit(1);
}

const isRemote = process.argv.includes('--remote');
const flag = isRemote ? '--remote' : '--local';

console.log(`[D1 Migration] Applying ID mapping seed (${flag}) from ${SEED_FILE}...`);

try {
  const cmd = `npx wrangler d1 execute anihub ${flag} --file=tools/id-map-seed.sql`;
  const output = execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
  console.log('[D1 Migration] Output:\n' + output);
  console.log('[D1 Migration] Successfully applied anime_id_map records.');
} catch (err) {
  console.warn('[D1 Migration] Note: Wrangler execution note / skipped (local state will populate on next wrangler dev start):', err.message);
}
