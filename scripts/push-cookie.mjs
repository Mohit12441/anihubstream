#!/usr/bin/env node
// @ts-check
import { readFileSync } from 'node:fs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const BASE = 'https://hdrezka.ag';
const PROBE = '/';
const KEY = 'anubis:cookie';
const TS_KEY = 'anubis:ts';
const DEFAULT_TTL = 4 * 24 * 3600;

const { CF_API_TOKEN, CF_ACCOUNT_ID, CF_KV_NAMESPACE } = process.env;
const kvUrl = (k) =>
  `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NAMESPACE}/values/${encodeURIComponent(k)}`;
const kvHeaders = { authorization: `Bearer ${CF_API_TOKEN}` };

export function needEnv() {
  for (const k of ['CF_API_TOKEN', 'CF_ACCOUNT_ID', 'CF_KV_NAMESPACE']) {
    if (!process.env[k]) throw new Error(`missing environment variable ${k}`);
  }
}

export function normalizeCookie(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw
    .replace(/^\s*cookie:\s*/i, '')
    .split(';')
    .map((p) => p.trim())
    .filter((p) => p && !/^(path|domain|expires|max-age|secure|httponly|samesite|priority)(?:=|$)/i.test(p))
    .join('; ');
}

export async function probe(cookie) {
  const res = await fetch(BASE + PROBE, {
    headers: { 'user-agent': UA, cookie, accept: 'text/html' },
    redirect: 'manual',
  });
  if (res.status === 200) {
    const text = await res.text().catch(() => '');
    if (text.includes('anubis_challenge') || text.includes('Проверяем, что вы не бот')) {
      return 403; // Challenge still returned
    }
  }
  return res.status;
}

async function run() {
  const isCheck = process.argv.includes('--check');
  const isClear = process.argv.includes('--clear');

  needEnv();

  if (isClear) {
    const r = await fetch(kvUrl(KEY), { method: 'DELETE', headers: kvHeaders });
    await fetch(kvUrl(TS_KEY), { method: 'DELETE', headers: kvHeaders }).catch(() => {});
    console.log(r.ok ? 'cleared' : `clear failed ${r.status}`);
    process.exit(r.ok ? 0 : 1);
  }

  if (isCheck) {
    const res = await fetch(kvUrl(KEY), { headers: kvHeaders });
    if (!res.ok) {
      console.log('nothing stored in KV');
      process.exit(1);
    }
    const cookie = await res.text();
    if (!cookie) {
      console.log('nothing stored');
      process.exit(1);
    }
    const status = await probe(cookie);
    console.log(status === 200 ? 'cookie valid' : `cookie dead (status ${status})`);
    process.exit(status === 200 ? 0 : 1);
  }

  // Read input from command line argument, env, or stdin
  let rawInput = process.argv.slice(2).find((a) => !a.startsWith('--')) || process.env.REZKA_COOKIE || '';
  if (!rawInput) {
    try {
      rawInput = readFileSync(0, 'utf8');
    } catch {
      throw new Error('No cookie input provided via argument, REZKA_COOKIE env, or stdin.');
    }
  }

  const cookie = normalizeCookie(rawInput);
  if (!/auth=/i.test(cookie)) {
    throw new Error('no *auth=* pair in the pasted value — did you copy the right cookie?');
  }

  const status = await probe(cookie);
  if (status !== 200) {
    console.error(`cookie rejected (status ${status}). Re-copy it from a browser tab that actually plays a video.`);
    process.exit(1);
  }

  const put = (k, v, ttl) =>
    fetch(`${kvUrl(k)}?expiration_ttl=${ttl}`, {
      method: 'PUT',
      headers: { ...kvHeaders, 'content-type': 'text/plain' },
      body: v,
    }).then(async (r) => {
      if (!r.ok) throw new Error(`KV ${k}: ${r.status} ${await r.text()}`);
    });

  await put(KEY, cookie, DEFAULT_TTL);
  await put(TS_KEY, String(Date.now()), DEFAULT_TTL);
  console.log(`stored, verified, expires in ${DEFAULT_TTL / 86400} days`);
}

if (process.argv[1] && process.argv[1].endsWith('push-cookie.mjs')) {
  run().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
