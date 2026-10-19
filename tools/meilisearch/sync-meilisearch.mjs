// @ts-check
/**
 * Meilisearch Catalog Sync Script
 * Extracts anime records from the catalogue (seed.sql or D1) and syncs them into Meilisearch.
 *
 * Run with: node tools/meilisearch/sync-meilisearch.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const SEED_FILE = resolve(ROOT, 'seed.sql');
const MEILISEARCH_HOST = process.env.MEILISEARCH_HOST || 'http://127.0.0.1:7700';
const MEILISEARCH_KEY = process.env.MEILISEARCH_KEY || '';
const INDEX_UID = 'anime';
const BATCH_SIZE = 100;

/**
 * Parses anime INSERT statements from seed.sql.
 * @returns {Array<any>}
 */
export function parseAnimeFromSeed(seedPath = SEED_FILE) {
  if (!existsSync(seedPath)) {
    throw new Error(`seed.sql not found at ${seedPath}`);
  }

  const content = readFileSync(seedPath, 'utf8');
  /** @type {Map<string, any>} */
  const docMap = new Map();

  // Match multiline INSERT statements: INSERT INTO anime (...) VALUES (...) [ON CONFLICT ...]
  const insertRegex = /INSERT INTO anime\s*\([^)]+\)\s*VALUES\s*\(([\s\S]*?)\)\s*(?:ON CONFLICT|;)/gi;
  let match;

  while ((match = insertRegex.exec(content)) !== null) {
    const rawValues = match[1];
    const tokens = [];
    let cur = '';
    let inQuote = false;

    for (let i = 0; i < rawValues.length; i++) {
      const ch = rawValues[i];
      if (ch === "'") {
        if (inQuote && rawValues[i + 1] === "'") {
          cur += "'";
          i++;
        } else {
          inQuote = !inQuote;
        }
      } else if (ch === ',' && !inQuote) {
        tokens.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    if (cur.trim()) tokens.push(cur.trim());

    if (tokens.length >= 12) {
      const unquote = (v) => {
        if (!v || v === 'NULL') return null;
        if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1);
        return v;
      };

      const id = unquote(tokens[0]);
      const title = unquote(tokens[1]);
      const native = unquote(tokens[2]);
      const year = Number.parseInt(unquote(tokens[3]) || '0', 10);
      const rating = Number.parseFloat(unquote(tokens[4]) || '0');
      const season = unquote(tokens[5]) || '';
      const kind = unquote(tokens[6]) || '';
      const status = unquote(tokens[7]) || '';
      const art = unquote(tokens[8]) || '';
      const keyArt = unquote(tokens[9]) || '';
      const accent = unquote(tokens[10]) || '';
      const synopsis = unquote(tokens[11]) || '';

      if (id && title) {
        docMap.set(id, {
          id,
          title,
          romajiTitle: title,
          nativeTitle: native,
          year,
          rating,
          season,
          kind,
          status,
          art,
          key_art: keyArt,
          accent,
          synopsis,
          synonyms: [title],
        });
      }
    }
  }

  // Also enrich with catalogue-sources.json so all catalog anime are indexed
  const sourcesPath = resolve(ROOT, 'tools/catalogue-sources.json');
  if (existsSync(sourcesPath)) {
    try {
      const sources = JSON.parse(readFileSync(sourcesPath, 'utf8'));
      for (const item of sources) {
        if (item.id && !docMap.has(item.id)) {
          const title = item.id
            .split('-')
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');
          docMap.set(item.id, {
            id: item.id,
            title,
            romajiTitle: title,
            nativeTitle: null,
            year: 2024,
            rating: 8.0,
            season: 'Fall 2024',
            kind: 'TV',
            status: 'Finished',
            art: `https://media.kitsu.app/anime/poster_images/${item.kitsu || 1}/medium.jpg`,
            key_art: '',
            accent: '#ff1f4a',
            synopsis: `Catalogue anime entry for ${title}.`,
            synonyms: [title],
          });
        }
      }
    } catch {
      // fallback silently if catalogue sources cannot be parsed
    }
  }

  return Array.from(docMap.values());
}

/**
 * Uploads documents to Meilisearch in batches.
 * @param {Array<any>} documents
 * @param {string} [host]
 * @param {string} [apiKey]
 */
export async function syncDocumentsToMeilisearch(
  documents,
  host = MEILISEARCH_HOST,
  apiKey = MEILISEARCH_KEY
) {
  if (!documents.length) {
    console.log('[Meilisearch Sync] No documents to sync.');
    return { count: 0, taskUids: [] };
  }

  const headers = {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };

  const taskUids = [];
  console.log(`[Meilisearch Sync] Uploading ${documents.length} anime documents in batches of ${BATCH_SIZE}...`);

  for (let i = 0; i < documents.length; i += BATCH_SIZE) {
    const chunk = documents.slice(i, i + BATCH_SIZE);
    const res = await fetch(`${host}/indexes/${INDEX_UID}/documents`, {
      method: 'POST',
      headers,
      body: JSON.stringify(chunk),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Meilisearch document upload failed at batch ${i}: ${errText}`);
    }

    const task = await res.json();
    taskUids.push(task.taskUid);
    console.log(`  Uploaded batch ${i / BATCH_SIZE + 1} (${chunk.length} items). Task: ${task.taskUid}`);
  }

  console.log(`[Meilisearch Sync] All ${documents.length} documents submitted successfully!`);
  return { count: documents.length, taskUids };
}

if (process.argv[1] && process.argv[1].endsWith('sync-meilisearch.mjs')) {
  try {
    const docs = parseAnimeFromSeed();
    console.log(`Parsed ${docs.length} anime records from seed.sql.`);
    syncDocumentsToMeilisearch(docs)
      .then(() => process.exit(0))
      .catch((err) => {
        console.error('Sync failed:', err.message);
        process.exit(1);
      });
  } catch (err) {
    console.error('Error during Meilisearch sync:', err.message);
    process.exit(1);
  }
}
