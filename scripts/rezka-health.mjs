#!/usr/bin/env node
// @ts-check
import { CF_API_TOKEN, CF_ACCOUNT_ID, CF_D1_DATABASE_ID } from process.env;

const q = (sql) => fetch(
  `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${CF_D1_DATABASE_ID}/query`,
  { method: 'POST', headers: { authorization: `Bearer ${CF_API_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ sql }) },
).then((r) => r.json()).then((j) => j.result?.[0]?.results ?? []);

const [sess] = await q(`SELECT cookie, updated_at FROM provider_session WHERE provider_id='hdrezka'`);
const [cov]  = await q(`SELECT COUNT(*) mapped, (SELECT COUNT(*) FROM anime_id_map) total FROM anime_id_map WHERE hdrezka_slug IS NOT NULL`);

let live = 'no-cookie';
if (sess?.cookie) {
  const r = await fetch('https://hdrezka.ag/', {
    headers: { cookie: sess.cookie, 'user-agent': 'Mozilla/5.0 Chrome/131' },
    redirect: 'manual',
  });
  live = r.status === 200 ? 'valid' : `dead (${r.status})`;
}

console.log(JSON.stringify({
  cookie: live,
  cookie_age_h: sess ? ((Date.now() - sess.updated_at) / 3.6e6).toFixed(1) : null,
  coverage: `${cov.mapped}/${cov.total}`,
}, null, 2));

process.exit(live === 'valid' ? 0 : 1);