// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const SLUGS_PATH = path.resolve('tools/anikoto-slugs.json');

async function apply() {
  if (!fs.existsSync(SLUGS_PATH)) {
    console.error('tools/anikoto-slugs.json not found');
    return;
  }

  const slugs = JSON.parse(fs.readFileSync(SLUGS_PATH, 'utf8'));
  const entries = Object.entries(slugs);
  console.log(`Applying ${entries.length} verified unique AniKoto slugs to remote D1 anime_id_map...`);

  // First, reset any stale decorative anikoto_slugs that equal anime_id
  console.log('Resetting decorative anikoto_slugs...');
  execSync(`npx wrangler d1 execute anihub --remote --command "UPDATE anime_id_map SET anikoto_slug = NULL WHERE anikoto_slug = anime_id;"`, {
    env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: 'da8a2f3a9d93372709386c123bafc873' },
    stdio: 'inherit',
  });

  const BATCH_SIZE = 100;
  let batchIndex = 0;
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    batchIndex++;
    const batch = entries.slice(i, i + BATCH_SIZE);
    const sqlStatements = [];

    for (const [animeId, slug] of batch) {
      if (!slug || slug === animeId) continue;
      const s = String(slug).replace(/'/g, "''");
      const a = String(animeId).replace(/'/g, "''");
      sqlStatements.push(`UPDATE anime_id_map SET anikoto_slug = '${s}' WHERE anime_id = '${a}';`);
    }

    if (sqlStatements.length > 0) {
      const sqlFile = path.resolve(`tools/batch-anikoto-${batchIndex}.sql`);
      fs.writeFileSync(sqlFile, sqlStatements.join('\n'), 'utf8');

      try {
        console.log(`Executing batch ${batchIndex} (${i + 1} - ${Math.min(i + BATCH_SIZE, entries.length)} of ${entries.length})...`);
        execSync(`npx wrangler d1 execute anihub --remote --file tools/batch-anikoto-${batchIndex}.sql`, {
          env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: 'da8a2f3a9d93372709386c123bafc873' },
          stdio: 'pipe',
        });
      } catch (err) {
        console.error(`Error executing batch ${batchIndex}:`, err.message);
      } finally {
        fs.unlinkSync(sqlFile);
      }
    }
  }

  console.log('Finished applying verified AniKoto slugs to remote D1.');
}

apply().catch(console.error);
