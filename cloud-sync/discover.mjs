// cloud-sync/discover.mjs
// Discovers currently-airing trending anime on AniList and queues new titles into sync_pending.
// Runs purely via D1 REST and AniList GraphQL — requires zero local machine dependencies.
import { d1All, d1Query } from './d1.mjs';
import { mediaSlug } from './sync-anilist.mjs';

const ANILIST_ENDPOINT = process.env.ANILIST_ENDPOINT?.trim() || 'https://graphql.anilist.co';
const USER_AGENT = process.env.ANILIST_USER_AGENT?.trim() || 'AniHubStream/1.0 (cloud-discovery; contact: https://anihubstream.com/about)';
export const RATE_CEILING_RPM = Number(process.env.ANILIST_RATE_CEILING_RPM || 85);
export const MIN_INTERVAL_MS = Math.ceil(60000 / RATE_CEILING_RPM); // ~706ms at 85 RPM

const TRENDING_QUERY = `
query($n: Int) {
  Page(page: 1, perPage: $n) {
    media(sort: TRENDING_DESC, type: ANIME, status: RELEASING, isAdult: false) {
      id
      idMal
      seasonYear
      title {
        romaji
        english
      }
    }
  }
}
`;

export async function fetchTrending(depth = 50, fetchImpl = globalThis.fetch) {
  const res = await fetchImpl(ANILIST_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent': USER_AGENT,
    },
    body: JSON.stringify({ query: TRENDING_QUERY, variables: { n: depth } }),
  });
  if (!res.ok) {
    throw new Error(`AniList returned HTTP ${res.status}`);
  }
  const body = await res.json();
  if (body.errors) {
    throw new Error(`AniList GraphQL error: ${JSON.stringify(body.errors[0]?.message || body.errors)}`);
  }
  return body.data?.Page?.media ?? [];
}

export async function discoverTrending({
  limit = 4,
  depth = 50,
  dryRun = false,
  fetchImpl = globalThis.fetch,
  queryImpl = d1Query,
  allImpl = d1All,
} = {}) {
  // 1. Fetch existing anime and pending queue from D1
  const animeRows = await allImpl('SELECT id, source_ids FROM anime');
  const pendingRows = await allImpl('SELECT anilist_id, slug FROM sync_pending');

  const knownSlugs = new Set();
  const knownAnilistIds = new Set();

  for (const r of animeRows) {
    if (r.id) knownSlugs.add(r.id);
    try {
      const parsed = JSON.parse(r.source_ids || '{}');
      if (Number.isInteger(parsed.anilist)) knownAnilistIds.add(parsed.anilist);
    } catch {}
  }

  for (const p of pendingRows) {
    if (p.slug) knownSlugs.add(p.slug);
    if (Number.isInteger(p.anilist_id)) knownAnilistIds.add(p.anilist_id);
  }

  // 2. Fetch candidates from AniList
  const media = await fetchTrending(depth, fetchImpl);

  // 3. Filter candidates
  const queued = [];
  for (const item of media) {
    if (queued.length >= limit) break;
    if (knownAnilistIds.has(item.id)) continue;
    const slug = mediaSlug(item);
    if (!slug || knownSlugs.has(slug)) continue;

    queued.push({
      anilist_id: item.id,
      slug,
      title: item.title?.english || item.title?.romaji || slug,
    });
    knownAnilistIds.add(item.id);
    knownSlugs.add(slug);
  }

  // 4. Queue into sync_pending
  const now = Date.now();
  if (!dryRun && queued.length) {
    for (const entry of queued) {
      await queryImpl(
        `INSERT OR IGNORE INTO sync_pending (anilist_id, slug, added_at, note)
         VALUES (?1, ?2, ?3, ?4)`,
        [entry.anilist_id, entry.slug, now, 'cloud-trending-discovery']
      );
    }

    const summary = {
      at: new Date(now).toISOString(),
      queued: queued.map((q) => ({ anilist: q.anilist_id, slug: q.slug })),
      candidates_scanned: media.length,
    };

    await queryImpl(
      `INSERT INTO sync_meta (key, value) VALUES ('discovery', ?1)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [JSON.stringify(summary)]
    );
  }

  return {
    queued,
    total_scanned: media.length,
    dry_run: dryRun,
  };
}

if (process.argv[1] && process.argv[1].endsWith('discover.mjs')) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : 4;

  discoverTrending({ limit, dryRun })
    .then((res) => {
      console.log(JSON.stringify(res, null, 2));
    })
    .catch((err) => {
      console.error('[discover] error:', err);
      process.exit(1);
    });
}
