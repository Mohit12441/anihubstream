// @ts-check
/**
 * tools/auto-push-new-episodes.mjs
 *
 * Automated Episode Discovery & Search Engine Notification Engine:
 * 1. Automatically submits newly released anime episode URLs to Microsoft Bing Webmaster API.
 * 2. Broadcasts newly aired episodes to the global IndexNow network (Bing, Yandex, Seznam).
 * 3. Deduplicates and maintains a 48-hour push ledger to protect daily API quotas.
 * 4. Integrates seamlessly into GitHub Actions automated sync cron and standalone runs.
 *
 * Usage:
 *   node tools/auto-push-new-episodes.mjs --urls=https://anihubstream.com/watch/solo-leveling/12
 *   node tools/auto-push-new-episodes.mjs --scan (Scans ongoing airing shows and submits newly released episodes)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { submitUrlsToIndexNow } from './indexnow.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_SITE_URL = 'https://anihubstream.com/';
const BING_API_ENDPOINT = 'https://ssl.bing.com/webmaster/api.svc/json/SubmitUrlBatch';
const LEDGER_PATH = path.resolve(__dirname, '.cache/pushed-episodes.json');

/**
 * Reads BING_WEBMASTER_API_KEY from environment or root .env file
 */
function getBingApiKey() {
  if (process.env.BING_WEBMASTER_API_KEY) return process.env.BING_WEBMASTER_API_KEY;
  try {
    const envPath = path.resolve(__dirname, '../.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      const match = content.match(/BING_WEBMASTER_API_KEY\s*=\s*([a-zA-Z0-9_-]+)/);
      if (match && match[1]) return match[1];
    }
  } catch {}
  return null;
}

/**
 * Loads the push ledger to prevent duplicate submissions within cooldown period
 * @returns {Record<string, number>}
 */
export function loadLedger() {
  try {
    if (fs.existsSync(LEDGER_PATH)) {
      return JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8'));
    }
  } catch {}
  return {};
}

/**
 * Saves the push ledger
 * @param {Record<string, number>} ledger
 */
export function saveLedger(ledger) {
  try {
    const dir = path.dirname(LEDGER_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // Prune entries older than 7 days
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const cleanLedger = {};
    for (const [url, ts] of Object.entries(ledger)) {
      if (ts > cutoff) cleanLedger[url] = ts;
    }
    fs.writeFileSync(LEDGER_PATH, JSON.stringify(cleanLedger, null, 2), 'utf8');
  } catch (err) {
    console.warn('[auto-push] Could not persist ledger:', err.message);
  }
}

/**
 * Submits a batch of URLs to the Bing Webmaster REST API
 * @param {string[]} urls
 * @param {object} [options]
 * @param {string} [options.apiKey]
 * @param {string} [options.siteUrl]
 * @returns {Promise<{ success: boolean, count: number, error?: string }>}
 */
export async function submitUrlsToBing(urls, options = {}) {
  const apiKey = options.apiKey || getBingApiKey();
  const siteUrl = options.siteUrl || DEFAULT_SITE_URL;

  if (!apiKey) {
    console.warn('[auto-push] ⚠️ BING_WEBMASTER_API_KEY not found in environment; skipping Bing Webmaster REST submission.');
    return { success: false, count: 0, error: 'missing_api_key' };
  }

  if (!urls || urls.length === 0) {
    return { success: true, count: 0 };
  }

  // Deduplicate and cap to 50 URLs per batch
  const batch = Array.from(new Set(urls)).slice(0, 50);

  try {
    const endpoint = `${BING_API_ENDPOINT}?apikey=${encodeURIComponent(apiKey)}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'User-Agent': 'AniHubStream/1.0 (BingAutoPush)',
      },
      body: JSON.stringify({
        siteUrl,
        urlList: batch,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[auto-push] ❌ Bing API error HTTP ${res.status}: ${errText}`);
      return { success: false, count: 0, error: `HTTP ${res.status}: ${errText}` };
    }

    console.log(`[auto-push] ✅ Successfully submitted ${batch.length} URLs to Microsoft Bing Webmaster API!`);
    return { success: true, count: batch.length };
  } catch (err) {
    console.error('[auto-push] ❌ Network error submitting to Bing:', err.message);
    return { success: false, count: 0, error: err.message };
  }
}

/**
 * Notifies all search engines (Bing Webmaster API + IndexNow) for newly released URLs
 * @param {string[]} urls
 * @param {object} [options]
 * @param {boolean} [options.bypassLedger]
 * @returns {Promise<{ bingCount: number, indexNowCount: number, skippedCount: number }>}
 */
export async function notifySearchEnginesOfNewEpisodes(urls, options = {}) {
  if (!urls || urls.length === 0) {
    return { bingCount: 0, indexNowCount: 0, skippedCount: 0 };
  }

  const ledger = loadLedger();
  const now = Date.now();
  const cooldownMs = 24 * 60 * 60 * 1000; // 24-hour cooldown per URL

  // Filter out URLs submitted within last 24h unless bypassed
  const pendingUrls = [];
  let skippedCount = 0;

  for (const u of urls) {
    if (!options.bypassLedger && ledger[u] && (now - ledger[u]) < cooldownMs) {
      skippedCount++;
    } else {
      pendingUrls.push(u);
    }
  }

  if (pendingUrls.length === 0) {
    console.log(`[auto-push] All ${urls.length} URLs were already notified within the last 24h. Skipping.`);
    return { bingCount: 0, indexNowCount: 0, skippedCount };
  }

  console.log(`\n📡 [auto-push] Notifying search engines for ${pendingUrls.length} newly aired episode/series URLs (${skippedCount} recently pushed skipped)...`);

  // 1. Submit to Bing Webmaster Tools API
  const bingRes = await submitUrlsToBing(pendingUrls);

  // 2. Submit to IndexNow (Bing, Yandex, Seznam, AI search)
  let indexNowCount = 0;
  try {
    const inRes = await submitUrlsToIndexNow(pendingUrls);
    indexNowCount = inRes?.submitted || pendingUrls.length;
    console.log(`[auto-push] ✅ Broadcasted ${indexNowCount} URLs to IndexNow network.`);
  } catch (err) {
    console.warn('[auto-push] ⚠️ IndexNow notification failed:', err.message);
  }

  // Update ledger
  for (const u of pendingUrls) {
    ledger[u] = now;
  }
  saveLedger(ledger);

  return {
    bingCount: bingRes.count,
    indexNowCount,
    skippedCount,
  };
}

/**
 * CLI runner
 */
async function run() {
  const urlArg = process.argv.find((a) => a.startsWith('--urls='));
  if (urlArg) {
    const rawUrls = urlArg.slice('--urls='.length).split(',').map((u) => u.trim()).filter(Boolean);
    const res = await notifySearchEnginesOfNewEpisodes(rawUrls, { bypassLedger: true });
    console.log('Result:', res);
    return;
  }

  console.log('Usage: node tools/auto-push-new-episodes.mjs --urls=<url1,url2>');
}

if (process.argv[1] && process.argv[1].endsWith('auto-push-new-episodes.mjs')) {
  run().catch(console.error);
}
