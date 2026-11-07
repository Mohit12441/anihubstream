// @ts-check
import { initLocalDatabase } from './init-local-db.mjs';
import { DatabaseSync } from 'node:sqlite';
import { pathValid, discoverBetaPath, upsertRoute } from '../lib/routes.mjs';

async function verifyAllRoutes() {
  const { dbPath } = await initLocalDatabase();
  const db = new DatabaseSync(dbPath);

  const rows = db.prepare(`
    SELECT r.anime_id, r.path, m.anilist_id, a.title
    FROM provider_route r
    JOIN anime_id_map m ON m.anime_id = r.anime_id
    JOIN anime a ON a.id = r.anime_id
    WHERE r.server='beta' AND r.path IS NOT NULL
  `).all();

  console.log(`[verify-routes] Auditing ${rows.length} beta routes for identity matching...`);
  let repaired = 0;
  let verified = 0;

  for (const row of /** @type {any[]} */ (rows)) {
    if (!pathValid(row.path, row.anilist_id)) {
      console.warn(`[verify-routes] Stale/poisoned path detected for ${row.anime_id}: ${row.path} != anilistId ${row.anilist_id}`);
      const found = await discoverBetaPath(row.anilist_id, row.title);
      await upsertRoute(db, row.anime_id, found);
      console.log(`[verify-routes] Repaired ${row.anime_id}: ${row.path} -> ${found.path ?? found.status}`);
      repaired++;
    } else {
      verified++;
    }
  }

  console.log(`[verify-routes] Finished: ${verified} verified valid, ${repaired} repaired.`);
}

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  verifyAllRoutes().catch((err) => {
    console.error('[verify-routes] Failed:', err);
    process.exit(1);
  });
}
