#!/usr/bin/env node
// @ts-check
import { getKv, putKv, needEnv } from './push-cookie.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const BASE = 'https://hdrezka.ag';
const META_TTL_SEC = 21600; // 6 hours

export async function prefetchSeries(ids, { cookie = null, sleepMs = 1200 } = {}) {
  let okCount = 0;
  const results = [];

  for (const id of ids) {
    try {
      const headers = {
        'user-agent': UA,
        'referer': `${BASE}/`,
        'x-requested-with': 'XMLHttpRequest',
        'content-type': 'application/x-www-form-urlencoded',
        ...(cookie ? { cookie } : {}),
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

      await putKv(`hdrezka:meta:${id}`, text, META_TTL_SEC);
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
  needEnv();

  const ids = (process.env.IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (ids.length === 0) {
    console.log('No IDS specified in environment. Nothing to cache.');
    process.exit(0);
  }

  const cookie = (await getKv('anubis:cookie').catch(() => null)) || process.env.REZKA_COOKIE || null;
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
