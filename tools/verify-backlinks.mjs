// @ts-check
/**
 * tools/verify-backlinks.mjs
 *
 * Backlink Health & Indexing Verifier:
 * 1. Crawls referring URLs stored in syndication and backlink ledgers.
 * 2. Checks HTTP response status (200 OK vs 404 / 301 redirect).
 * 3. Inspects HTML to verify that an <a> tag linking to anihubstream.com is present.
 * 4. Checks whether the backlink is dofollow or nofollow.
 * 5. Checks for <meta name="robots" content="noindex"> flags.
 *
 * Usage:
 *   node tools/verify-backlinks.mjs
 *   node tools/verify-backlinks.mjs --url=https://telegra.ph/some-article
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYNDICATED_LEDGER = path.resolve(__dirname, '.cache/syndicated-ledger.json');
const TARGET_DOMAIN = 'anihubstream.com';

/**
 * Verifies a single target URL for an active backlink
 * @param {string} sourceUrl
 * @returns {Promise<{ url: string, status: number|string, hasLink: boolean, isDofollow: boolean, isIndexable: boolean, notes: string }>}
 */
export async function checkBacklink(sourceUrl) {
  try {
    const res = await fetch(sourceUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AniHubBacklinkMonitor/1.0'
      },
      signal: AbortSignal.timeout(8000)
    });

    if (!res.ok) {
      return {
        url: sourceUrl,
        status: res.status,
        hasLink: false,
        isDofollow: false,
        isIndexable: false,
        notes: `HTTP error ${res.status}`
      };
    }

    const html = await res.text();
    const isNoindex = /<meta[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html);
    const linkRegex = new RegExp(`<a[^>]*href=["']([^"']*${TARGET_DOMAIN}[^"']*)["'][^>]*>`, 'gi');

    let match;
    let hasLink = false;
    let isDofollow = true;

    while ((match = linkRegex.exec(html)) !== null) {
      hasLink = true;
      const fullTag = match[0];
      if (/rel=["'][^"']*nofollow/i.test(fullTag)) {
        isDofollow = false;
      }
    }

    return {
      url: sourceUrl,
      status: res.status,
      hasLink,
      isDofollow: hasLink && isDofollow,
      isIndexable: !isNoindex,
      notes: hasLink ? (isDofollow ? 'Active Dofollow' : 'Active Nofollow') : 'Target backlink not found in HTML'
    };
  } catch (err) {
    return {
      url: sourceUrl,
      status: 'FETCH_ERROR',
      hasLink: false,
      isDofollow: false,
      isIndexable: false,
      notes: String(err.message || err)
    };
  }
}

/**
 * Main verifier execution
 */
export async function runVerifier() {
  console.log(`[verifier] Starting Backlink Health Verification for: ${TARGET_DOMAIN}\n`);

  const urlArg = process.argv.find(a => a.startsWith('--url='));
  const urlsToCheck = [];

  if (urlArg) {
    urlsToCheck.push(urlArg.split('=')[1]);
  } else {
    // Collect from syndication ledger
    if (fs.existsSync(SYNDICATED_LEDGER)) {
      try {
        const ledger = JSON.parse(fs.readFileSync(SYNDICATED_LEDGER, 'utf8'));
        for (const item of Object.values(ledger)) {
          if (item.publishedUrl) urlsToCheck.push(item.publishedUrl);
        }
      } catch {}
    }
  }

  if (urlsToCheck.length === 0) {
    console.log('[verifier] No external backlink URLs found in ledger to verify.');
    console.log('[verifier] You can test a specific URL with: node tools/verify-backlinks.mjs --url=<url>');
    return;
  }

  console.log(`[verifier] Found ${urlsToCheck.length} referring URL(s) to check:`);
  for (const url of urlsToCheck) {
    console.log(`Checking: ${url} ...`);
    const result = await checkBacklink(url);
    console.log(`  - Status: ${result.status}`);
    console.log(`  - Backlink Found: ${result.hasLink ? '✔ YES' : '❌ NO'}`);
    console.log(`  - Link Type: ${result.isDofollow ? '🟢 Dofollow' : '⚪ Nofollow'}`);
    console.log(`  - Page Indexable: ${result.isIndexable ? '✔ YES' : '⚠ NOINDEX'}`);
    console.log(`  - Notes: ${result.notes}\n`);
  }
}

if (process.argv[1] && process.argv[1].endsWith('verify-backlinks.mjs')) {
  runVerifier();
}
