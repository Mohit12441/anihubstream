// @ts-check
/**
 * tools/indexnow.mjs
 *
 * Automated IndexNow Dispatcher:
 * - Submits URLs to Microsoft Bing, Yandex, Seznam, and partner search engines for instant indexing.
 * - Zero external dependencies (uses native fetch).
 *
 * Usage:
 *   node tools/indexnow.mjs --urls=https://anihubstream.com/anime/attack-on-titan
 *   node tools/indexnow.mjs --sitemap (Fetches top URLs from sitemap.xml and pings IndexNow)
 */

import fs from 'node:fs';
import path from 'node:path';

export const INDEXNOW_KEY = '9f8b2c4e1a7d3f5b8a0c6e4d2f1a9b7c';
export const DEFAULT_HOST = 'anihubstream.com';
export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';

/**
 * Submits a batch of URLs to the IndexNow API
 * @param {string[]} urlList
 * @param {object} [options]
 * @param {string} [options.host]
 * @param {string} [options.key]
 * @param {string} [options.keyLocation]
 */
export async function submitUrlsToIndexNow(urlList, options = {}) {
  const host = options.host || DEFAULT_HOST;
  const key = options.key || INDEXNOW_KEY;
  const keyLocation = options.keyLocation || `https://${host}/${key}.txt`;

  if (!urlList || !urlList.length) {
    throw new Error('No URLs provided for IndexNow submission.');
  }

  // Deduplicate and cap to 10,000 URLs per IndexNow specification
  const uniqueUrls = Array.from(new Set(urlList)).slice(0, 10000);

  const payload = {
    host,
    key,
    keyLocation,
    urlList: uniqueUrls,
  };

  const res = await fetch(INDEXNOW_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });

  const responseText = await res.text().catch(() => '');

  // IndexNow returns 200 OK or 202 Accepted on success
  if (res.status === 200 || res.status === 202) {
    return {
      ok: true,
      status: res.status,
      count: uniqueUrls.length,
      message: res.status === 200 ? 'OK' : 'Accepted',
    };
  }

  throw new Error(`IndexNow API error HTTP ${res.status}: ${responseText || res.statusText}`);
}

async function main() {
  const args = process.argv.slice(2);
  const isSitemap = args.includes('--sitemap');
  const urlArg = args.find((a) => a.startsWith('--urls='));

  console.log('🚀 IndexNow Autonomous Dispatcher');
  console.log(`Host: ${DEFAULT_HOST}`);
  console.log(`Key:  ${INDEXNOW_KEY}\n`);

  let targetUrls = [];

  if (urlArg) {
    targetUrls = urlArg.split('=')[1].split(',').map((u) => u.trim()).filter(Boolean);
  } else if (isSitemap) {
    console.log('📥 Fetching live sitemap from https://anihubstream.com/sitemap.xml...');
    const res = await fetch('https://anihubstream.com/sitemap.xml');
    if (!res.ok) {
      throw new Error(`Failed to fetch sitemap: HTTP ${res.status}`);
    }
    const xml = await res.text();
    const matches = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    console.log(`Discovered ${matches.length} URLs in sitemap.`);
    // Submit top 1,000 URLs
    targetUrls = matches.slice(0, 1000);
  } else {
    // Default check: Submit primary hub pages
    targetUrls = [
      'https://anihubstream.com/',
      'https://anihubstream.com/anime',
      'https://anihubstream.com/genres',
      'https://anihubstream.com/schedule',
      'https://anihubstream.com/discover',
      'https://anihubstream.com/anime/attack-on-titan',
      'https://anihubstream.com/watch/attack-on-titan/1',
      'https://anihubstream.com/anime/one-piece',
      'https://anihubstream.com/watch/one-piece/1',
      'https://anihubstream.com/anime/demon-slayer',
      'https://anihubstream.com/watch/demon-slayer/1',
    ];
  }

  console.log(`📡 Pinging IndexNow with ${targetUrls.length} priority URLs...`);
  const result = await submitUrlsToIndexNow(targetUrls);
  console.log(`✅ Success! Search engines notified (${result.count} URLs submitted with HTTP ${result.status} ${result.message}).`);
}

if (process.argv[1] && process.argv[1].endsWith('indexnow.mjs')) {
  main().catch((err) => {
    console.error('❌ Error executing IndexNow dispatch:', err.message);
    process.exit(1);
  });
}
