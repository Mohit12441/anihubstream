#!/usr/bin/env node
// @ts-check
import { putKv, needEnv } from './push-cookie.mjs';
import { getCookie, headers as anubisHeaders } from './anubis.mjs';

const BASE = 'https://hdrezka.ag';
const META_TTL_SEC = 21600; // 6 hours (old key TTL; new episode keys use 14400)
const SOLVE_ATTEMPTS = 3;
const SEASON_EPISODE_TTL_SEC = 14400; // 4 h — signed URL lifetime

/**
 * Solves the Anubis challenge with bounded retries. A single 403 or malformed
 * challenge page must not kill the whole prefetch run.
 * @param {number} [attempts]
 * @returns {Promise<string | null>} the solved cookie, or null when not gated
 */
async function getCookieWithRetry(attempts = SOLVE_ATTEMPTS) {
  for (let i = 1; i <= attempts; i++) {
    try {
      return (await getCookie('/')).cookie;
    } catch (err) {
      if (i === attempts) throw err;
      const wait = 5000 * i + Math.random() * 2000;
      console.error(`solve attempt ${i}/${attempts} failed (${err.message || err}); retrying in ${Math.round(wait)}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  return null;
}

export async function prefetchSeries(ids, { cookie = null, sleepMs = 1200 } = {}) {
  let okCount = 0;
  const results = [];

  for (const id of ids) {
    try {
      const headers = {
        ...anubisHeaders(cookie),
        'x-requested-with': 'XMLHttpRequest',
        'content-type': 'application/x-www-form-urlencoded',
      };

      const body = new URLSearchParams({
        id: String(id),
        translator_id: '238',
        is_adjax: '1',
        action: 'get_cdn_series',
      });

      const res = await fetch(`${BASE}/ajax/get_cdn_series/`, {
        method: 'POST',
        headers,
        body: body.toString(),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const text = await res.text();
      if (!text || text.includes('"success":false')) {
        throw new Error(`upstream error: ${text.slice(0, 80)}`);
      }

      // Derive episode-scoped keys: last season, last episode
      const parsedBody = JSON.parse(text);
      let s = parsedBody.rules?.season ?? parsedBody.season;
      let maxEp = parsedBody.rules?.maxEpisode ?? parsedBody.maxEpisode;
      if (s === undefined || maxEp === undefined) {
        console.warn(`⚠️ ${id}: no season/episode info in body; skipping episode keys`);
      } else {
        const bodyEp1 = new URLSearchParams({
          id: String(id),
          translator_id: '238',
          is_adjax: '1',
          action: 'get_stream',
          season: String(s),
          episode: '1',
        });
        // Episode 1 of the last season
        const r1 = await fetch(`${BASE}/ajax/get_stream/`, {
          method: 'POST',
          headers: {...headers, 'content-type': 'application/x-www-form-urlencoded'},
          body: bodyEp1.toString(),
        });
        if (r1.ok) {
          const t1 = await r1.text();
          await putKv(`hdrezka:meta:${id}:${s}:1`, JSON.stringify({ s, e: 1, payload: t1, ts: Date.now() }), SEASON_EPISODE_TTL_SEC);
          console.log(`✅ Cached hdrezka:meta:${id}:${s}:1`);
        }
        // Max episode of the last season
        const bodyMax = new URLSearchParams({
          id: String(id),
          translator_id: '238',
          is_adjax: '1',
          action: 'get_stream',
          season: String(s),
          episode: String(maxEp),
        });
        const r2 = await fetch(`${BASE}/ajax/get_stream/`, {
          method: 'POST',
          headers: {...headers, 'content-type': 'application/x-www-form-urlencoded'},
          body: bodyMax.toString(),
        });
        if (r2.ok) {
          const t2 = await r2.text();
          await putKv(`hdrezka:meta:${id}:${s}:${maxEp}`, JSON.stringify({ s, e: maxEp, payload: t2, ts: Date.now() }), SEASON_EPISODE_TTL_SEC);
          console.log(`✅ Cached hdrezka:meta:${id}:${s}:${maxEp}`);
        }
      }

      // Old series-level key — removed. Keep TTL at 6h but no longer written.
      // Old: await putKv(`hdrezka:meta:${id}`, text, META_TTL_SEC);
      okCount++;
      results.push({ id, status: 'cached' });
      console.log(`✅ Cached hdrezka:meta:${id}`);

      if (sleepMs > 0 && ids.indexOf(id) < ids.length - 1) {
        await new Promise((r) => setTimeout(r, sleepMs));
      }
    } catch (err) {
      console.error(`❌ Failed ${id}: ${err.message || err}`);
      results.push({ id, status: 'failed', error: err.message });
    }
  }

  return { okCount, results };
}

async function run() {
  // Kill switch: flip this without a deploy to stop all Rezka prefetching.
  if (process.env.REZKA_DISABLED === '1') {
    console.log('REZKA_DISABLED=1, skipping prefetch.');
    process.exit(0);
  }

  needEnv();

  const ids = (process.env.IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (ids.length === 0) {
    console.log('No IDS specified in environment. Nothing to cache.');
    process.exit(0);
  }

  let cookie = null;
  let solveFailed = false;
  try {
    cookie = await getCookieWithRetry();
  } catch (err) {
    solveFailed = true;
    console.error(`WARNING: Anubis solve failed after ${SOLVE_ATTEMPTS} attempts: ${err.message || err}`);
    cookie = process.env.REZKA_COOKIE || null;
    console.error(cookie
      ? 'WARNING: falling back to the REZKA_COOKIE env secret — the solved-cookie path is broken and needs attention.'
      : 'WARNING: no REZKA_COOKIE fallback configured; prefetching unauthenticated and likely to fail.');
  }

  if (cookie) {
    await putKv('anubis:cookie', cookie);
    await putKv('anubis:ts', String(Date.now()));
  } else if (!solveFailed) {
    console.log('not gated; prefetching without a cookie');
  }

  console.log(`Starting Rezka metadata prefetch for ${ids.length} titles...`);

  const { okCount } = await prefetchSeries(ids, { cookie });
  console.log(`Finished: ${okCount}/${ids.length} successfully cached.`);

  if (okCount === 0) {
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith('rezka-auto.mjs')) {
  run().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
