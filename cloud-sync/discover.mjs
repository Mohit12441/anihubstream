// cloud-sync/discover.mjs
// Discovers currently-airing trending anime on AniList and queues new titles into sync_pending.
// Runs purely via D1 REST and AniList GraphQL — requires zero local machine dependencies.
import { d1All, d1Query, parseRetryAfter } from './d1.mjs';
import { mediaSlug } from './sync-anilist.mjs';

const ANILIST_ENDPOINT = process.env.ANILIST_ENDPOINT?.trim() || 'https://graphql.anilist.co';
const USER_AGENT = process.env.ANILIST_USER_AGENT?.trim() || 'AniHubStream/1.0 (cloud-discovery; contact: https://anihubstream.com/about)';
export const RATE_CEILING_RPM = Number(process.env.ANILIST_RATE_CEILING_RPM || 85);
export const MIN_INTERVAL_MS = Math.ceil(60000 / RATE_CEILING_RPM); // ~706ms at 85 RPM

let lastStartAt = 0;
export function resetPacing() {
  lastStartAt = 0;
}

export async function pace(intervalMs = MIN_INTERVAL_MS, sleepImpl = (ms) => new Promise((r) => setTimeout(r, ms))) {
  if (lastStartAt > 0 && intervalMs > 0) {
    const elapsed = Date.now() - lastStartAt;
    if (elapsed < intervalMs) {
      await sleepImpl(intervalMs - elapsed);
    }
  }
  lastStartAt = Date.now();
}

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

export async function fetchTrending(depth = 50, fetchImpl = globalThis.fetch, options = {}) {
  const maxAttempts = options.maxAttempts ?? 3;
  const backoffBaseMs = options.backoffBaseMs ?? 50;
  const sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (options.paceIntervalMs) await pace(options.paceIntervalMs, sleep);
    let res;
    try {
      res = await fetchImpl(ANILIST_ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify({ query: TRENDING_QUERY, variables: { n: depth } }),
      });
    } catch (netErr) {
      if (attempt === maxAttempts) throw netErr;
      const wait = backoffBaseMs * 2 ** (attempt - 1);
      await sleep(wait);
      continue;
    }

    if (res.status === 429 || (res.status >= 500 && res.status <= 599)) {
      if (attempt === maxAttempts) {
        throw new Error(`AniList returned HTTP ${res.status}`);
      }
      const retryAfter = parseRetryAfter(res.headers?.get?.('retry-after'));
      const wait = retryAfter ?? backoffBaseMs * 2 ** (attempt - 1);
      await sleep(wait);
      continue;
    }

    if (!res.ok) {
      throw new Error(`AniList returned HTTP ${res.status}`);
    }

    const body = await res.json();
    if (body.errors) {
      const errMsg = body.errors[0]?.message || JSON.stringify(body.errors);
      const isTransient = /too many requests|rate.?limit|internal server error|timeout|temporarily/i.test(errMsg);
      if (isTransient && attempt < maxAttempts) {
        const wait = backoffBaseMs * 2 ** (attempt - 1);
        await sleep(wait);
        continue;
      }
      throw new Error(`AniList GraphQL error: ${JSON.stringify(body.errors[0]?.message || body.errors)}`);
    }
    return body.data?.Page?.media ?? [];
  }
  throw new Error('AniList: fetchTrending attempts exceeded');
}

export async function discoverTrending({
  limit = 4,
  depth = 50,
  dryRun = false,
  fetchImpl = globalThis.fetch,
  queryImpl = d1Query,
  allImpl = d1All,
  paceIntervalMs = 0,
  sleepImpl = (ms) => new Promise((r) => setTimeout(r, ms)),
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
  const media = await fetchTrending(depth, fetchImpl, { paceIntervalMs, sleep: sleepImpl });

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
      if (paceIntervalMs > 0) await pace(paceIntervalMs, sleepImpl);
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

    if (paceIntervalMs > 0) await pace(paceIntervalMs, sleepImpl);
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

  discoverTrending({ limit, dryRun, paceIntervalMs: MIN_INTERVAL_MS })
    .then((res) => {
      console.log(JSON.stringify(res, null, 2));
    })
    .catch((err) => {
      console.error('[discover] error:', err);
      process.exit(1);
    });
}
