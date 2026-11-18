#!/usr/bin/env node
// @ts-check
import { getCookie, headers } from './anubis.mjs';
import { createHash } from 'node:crypto';

const BASE = 'https://hdrezka.ag';
const SHARD = Number(process.env.SHARD ?? 0);
const SHARDS = Number(process.env.SHARDS ?? 1);
const LIMIT = Number(process.env.LIMIT ?? 400);
const PACE = Number(process.env.PACE ?? 1200);
const { CF_API_TOKEN, CF_ACCOUNT_ID, CF_D1_DATABASE_ID } = process.env;

const d1 = async (sql, params = []) => {
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${CF_D1_DATABASE_ID}/query`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${CF_API_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ sql, params }),
    },
  );
  const j = await r.json();
  if (!j.success) throw new Error(JSON.stringify(j.errors));
  return j.result?.[0]?.results ?? [];
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function score(want, got) {
  const a = norm(want), b = norm(got);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (b.startsWith(a)) return 80;
  if (b.includes(a)) return 60;
  const aw = new Set(a.split(' ')), bw = new Set(b.split(' '));
  const hit = [...aw].filter((w) => bw.has(w)).length;
  return Math.round((hit / aw.size) * 40);
}

async function search(cookie, title) {
  const res = await fetch(`${BASE}/search/?do=search&subaction=search&q=${encodeURIComponent(title)}`, {
    headers: headers(cookie),
  });
  if (res.status === 403) return { gated: true, hits: [] };
  const html = await res.text();
  const hits = [];
  const re = /href="https:\/\/hdrezka\.(?:ag|io)\/(?:series|animation|cartoons|films)\/(\d+)-([a-z0-9-]+)\.html"[^>]*>([^<]{1,200})</g;
  let m;
  while ((m = re.exec(html))) hits.push({ id: m[1], slug: m[2], title: m[3].trim() });
  return { gated: false, hits };
}

async function main() {
  const { cookie } = await getCookie('/');
  if (!cookie) { console.log('not gated'); process.exit(1); }

  // Store cookie in both D1 provider_session and KV anubis:cookie for redundancy
  await d1(
    `INSERT INTO provider_session (provider_id, cookie, updated_at) VALUES ('hdrezka', ?, ?) ON CONFLICT(provider_id) DO UPDATE SET cookie = excluded.cookie, updated_at = excluded.updated_at`,
    [cookie ?? '', Date.now()],
  );
  if (env.KV_NAMESPACE) {
    const kv = env.KV_NAMESPACE;
    await kv.put('anubis:cookie', cookie, { expirationTtl: 30 * 24 * 3600 * 1000 });
  }

  // Also set env for resolve.js to read from KV
  if (env.KV_NAMESPACE) process.env.KV_NAMESPACE = env.KV_NAMESPACE;

  // Set cookie in environment for resolve.js provider_session fallback
  process.env.HDREZKA_COOKIE = cookie;


  const rows = await d1(
    `SELECT id, mal_id, COALESCE(romaji, title) AS title FROM anime_id_map JOIN anime ON anime.id = anime_id_map.anime_id WHERE hdrezka_slug IS NULL AND id % ? = ? ORDER BY id LIMIT ?`,
    [SHARDS, SHARD, LIMIT],
  );
  console.log(`shard ${SHARD}/${SHARDS}: ${rows.length} candidates`);

  let mapped = 0, gated = 0;
  for (const row of rows) {
    try {
      const { gated: g, hits } = await search(cookie, row.title);
      if (g) { gated++; await sleep(5000); continue; }

      const best = hits.map((h) => ({ ...h, s: score(row.title, h.title) }))
        .sort((a, b) => b.s - a.s)[0];
      if (best && best.s >= 60) {
        await d1(`UPDATE anime_id_map SET hdrezka_slug = ? WHERE id = ?`, [best.slug, row.id]);
        await d1(
          `INSERT INTO anime_provider_mapping (anime_id, provider_id, provider_slug) VALUES (?, 'hdrezka', ?) ON CONFLICT DO NOTHING`,
          [row.anime_id, best.slug],
        );
        mapped++;
        console.log(`+ ${row.title} -> ${best.slug} (${best.s})`);
      }
      await sleep(PACE);
    } catch (e) {
      console.error(`! ${row.title}: ${e.message}`);
      await sleep(PACE * 2);
    }
  }

  await d1(
    `INSERT INTO provider_sync_state (provider_id, shard, cursor_id, updated_at) VALUES ('hdrezka', ?, ?, ?) ON CONFLICT(provider_id, shard) DO UPDATE SET cursor_id = excluded.cursor_id, updated_at = excluded.updated_at`,
    [SHARD, rows.at(-1)?.id ?? 0, Date.now()],
  );

  console.log(`shard ${SHARD}: mapped ${mapped}, gated ${gated}`);
  if (gated > rows.length / 2) process.exit(2);   // cookie died mid-run
}

main().catch((e) => { console.error(e); process.exit(1); });