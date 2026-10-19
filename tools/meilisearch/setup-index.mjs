// @ts-check
/**
 * Meilisearch Anime Index Setup Script
 * Configures ranking rules, searchable attributes, typo tolerance, and synonyms.
 *
 * Run with: node tools/meilisearch/setup-index.mjs
 */

const MEILISEARCH_HOST = process.env.MEILISEARCH_HOST || 'http://127.0.0.1:7700';
const MEILISEARCH_KEY = process.env.MEILISEARCH_KEY || '';
const INDEX_UID = 'anime';

export const ANIME_INDEX_SETTINGS = {
  searchableAttributes: [
    'title',
    'romajiTitle',
    'nativeTitle',
    'synonyms',
    'genres',
    'synopsis',
  ],
  displayedAttributes: [
    'id',
    'title',
    'native',
    'year',
    'rating',
    'season',
    'kind',
    'status',
    'art',
    'key_art',
    'genres',
    'synopsis',
    'rank',
    'trend_rank',
  ],
  filterableAttributes: [
    'year',
    'rating',
    'status',
    'kind',
    'genres',
    'season',
  ],
  sortableAttributes: [
    'rating',
    'year',
    'rank',
    'trend_rank',
  ],
  rankingRules: [
    'words',
    'typo',
    'proximity',
    'attribute',
    'sort',
    'exactness',
    'rating:desc',
    'year:desc',
  ],
  synonyms: {
    'attack on titan': ['shingeki no kyojin', 'aot'],
    'shingeki no kyojin': ['attack on titan', 'aot'],
    'aot': ['attack on titan', 'shingeki no kyojin'],
    'demon slayer': ['kimetsu no yaiba'],
    'kimetsu no yaiba': ['demon slayer'],
    'my hero academia': ['boku no hero academia', 'mha', 'bnha'],
    'boku no hero academia': ['my hero academia', 'mha', 'bnha'],
    'jujutsu kaisen': ['jjk'],
    'jjk': ['jujutsu kaisen'],
    'solo leveling': ['ore dake level up na ken'],
    'ore dake level up na ken': ['solo leveling'],
    'frieren': ['sousou no frieren', 'frieren beyond journeys end'],
    'sousou no frieren': ['frieren', 'frieren beyond journeys end'],
    'chainsaw man': ['csm'],
    'csm': ['chainsaw man'],
    'fullmetal alchemist': ['fma', 'fmab', 'fullmetal alchemist brotherhood'],
    'fmab': ['fullmetal alchemist brotherhood', 'fullmetal alchemist'],
    'hunter x hunter': ['hxh'],
    'hxh': ['hunter x hunter'],
    'one piece': ['op'],
    'bleach': ['thousand year blood war', 'tybw'],
    'slimes3': ['that time i got reincarnated as a slime', 'tensura'],
    'tensura': ['that time i got reincarnated as a slime'],
  },
  typoTolerance: {
    enabled: true,
    minWordSizeForTypos: {
      oneTypo: 4,
      twoTypos: 8,
    },
    disableOnAttributes: [],
  },
};

/**
 * Applies settings to Meilisearch index.
 * @param {string} [host]
 * @param {string} [apiKey]
 */
export async function setupMeilisearchIndex(host = MEILISEARCH_HOST, apiKey = MEILISEARCH_KEY) {
  const headers = {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };

  // 1. Ensure index exists with primary key 'id'
  try {
    const createRes = await fetch(`${host}/indexes`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ uid: INDEX_UID, primaryKey: 'id' }),
    });
    if (createRes.ok || createRes.status === 400 || createRes.status === 409) {
      console.log(`[Meilisearch] Index "${INDEX_UID}" initialized.`);
    }
  } catch (err) {
    console.warn(`[Meilisearch] Index creation check failed:`, err.message);
  }

  // 2. Update all settings in one batch
  const settingsRes = await fetch(`${host}/indexes/${INDEX_UID}/settings`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(ANIME_INDEX_SETTINGS),
  });

  if (!settingsRes.ok) {
    const errText = await settingsRes.text();
    throw new Error(`Failed to configure Meilisearch index settings (${settingsRes.status}): ${errText}`);
  }

  const task = await settingsRes.json();
  console.log(`[Meilisearch] Settings updated successfully. Task UID:`, task.taskUid);
  return task;
}

if (process.argv[1] && process.argv[1].endsWith('setup-index.mjs')) {
  setupMeilisearchIndex()
    .then(() => {
      console.log('Meilisearch configuration complete.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Error configuring Meilisearch:', err.message);
      process.exit(1);
    });
}
