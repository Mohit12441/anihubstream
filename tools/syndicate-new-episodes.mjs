// @ts-check
/**
 * tools/syndicate-new-episodes.mjs
 *
 * Web 2.0 Auto-Syndication & Tier-2 Backlink Engine:
 * 1. Reads latest episode additions from public/feed.xml or public/editorial.json.
 * 2. Formats SEO-optimized teaser articles with images, episode synopsis, and clean attribution links.
 * 3. Supports direct publication to Telegraph (https://telegra.ph) API (zero-friction, no account needed).
 * 4. Generates live, crawlable external web pages with dofollow links pointing back to AniHubStream.
 *
 * Usage:
 *   node tools/syndicate-new-episodes.mjs --dry-run
 *   node tools/syndicate-new-episodes.mjs --publish --limit=3
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LEDGER_PATH = path.resolve(__dirname, '.cache/syndicated-ledger.json');
const FEED_PATH = path.resolve(__dirname, '../public/editorial.json');
const ORIGIN = 'https://anihubstream.com';

/**
 * Loads the push ledger to prevent re-syndicating the same episode
 * @returns {Record<string, { title: string, publishedUrl: string, timestamp: number }>}
 */
function loadLedger() {
  try {
    if (fs.existsSync(LEDGER_PATH)) {
      return JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8'));
    }
  } catch {}
  return {};
}

/**
 * Saves the syndication ledger
 * @param {Record<string, any>} ledger
 */
function saveLedger(ledger) {
  try {
    const dir = path.dirname(LEDGER_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2), 'utf8');
  } catch (err) {
    console.error('[syndicator] Failed to save ledger:', err);
  }
}

/**
 * Creates a Telegraph access token if not present
 * @returns {Promise<string|null>}
 */
async function getOrCreateTelegraphToken() {
  const tokenFile = path.resolve(__dirname, '.cache/telegraph-token.txt');
  if (fs.existsSync(tokenFile)) {
    const t = fs.readFileSync(tokenFile, 'utf8').trim();
    if (t) return t;
  }

  try {
    const res = await fetch('https://api.telegra.ph/createAccount?short_name=AniHubNews&author_name=AniHubStream');
    const data = await res.json();
    if (data.ok && data.result?.access_token) {
      const token = data.result.access_token;
      const dir = path.dirname(tokenFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(tokenFile, token, 'utf8');
      return token;
    }
  } catch (err) {
    console.error('[syndicator] Failed to create Telegraph account:', err);
  }
  return null;
}

/**
 * Publishes an article to Telegraph via API
 * @param {string} accessToken
 * @param {string} title
 * @param {string} contentHtml
 * @param {string} authorUrl
 * @returns {Promise<string|null>} Live URL or null
 */
async function publishToTelegraph(accessToken, title, contentHtml, authorUrl = ORIGIN) {
  try {
    // Convert basic HTML to Telegraph DOM format
    const nodes = [
      { tag: 'p', children: ['Stay up to date with the newest releases and HD anime streaming on ', { tag: 'a', attrs: { href: authorUrl }, children: ['AniHubStream'] }, '.'] },
      { tag: 'hr' },
      { tag: 'p', children: [contentHtml] },
      { tag: 'p', children: ['Watch online in full HD: ', { tag: 'a', attrs: { href: authorUrl }, children: ['Stream Now on AniHubStream'] }] }
    ];

    const body = {
      access_token: accessToken,
      title: title.slice(0, 120),
      author_name: 'AniHubStream',
      author_url: authorUrl,
      content: JSON.stringify(nodes),
      return_content: false
    };

    const res = await fetch('https://api.telegra.ph/createPage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await res.json();
    if (data.ok && data.result?.url) {
      return data.result.url;
    } else {
      console.error('[syndicator] Telegraph API response error:', data);
    }
  } catch (err) {
    console.error('[syndicator] Error publishing to Telegraph:', err);
  }
  return null;
}

/**
 * Main syndication runner
 */
export async function runSyndication() {
  const isPublish = process.argv.includes('--publish');
  const limitArg = process.argv.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 2;

  console.log(`[syndicator] Starting syndication run (mode: ${isPublish ? 'PUBLISH' : 'DRY-RUN'}, limit: ${limit})`);

  if (!fs.existsSync(FEED_PATH)) {
    console.warn(`[syndicator] Editorial feed not found at ${FEED_PATH}`);
    return;
  }

  const articles = JSON.parse(fs.readFileSync(FEED_PATH, 'utf8'));
  const ledger = loadLedger();

  let token = null;
  if (isPublish) {
    token = await getOrCreateTelegraphToken();
    if (!token) {
      console.error('[syndicator] Could not initialize Telegraph token. Aborting publish.');
      return;
    }
  }

  let count = 0;
  for (const art of articles) {
    if (count >= limit) break;
    const slug = art.slug || art.title;
    if (ledger[slug]) continue; // Already syndicated

    const cleanTitle = art.title || 'Anime Trending Update';
    const animeSlug = (art.relatedAnimeSlugs && art.relatedAnimeSlugs[0]) || '';
    const targetUrl = animeSlug ? `${ORIGIN}/anime/${animeSlug}` : `${ORIGIN}/news/${slug}`;
    const synopsis = (art.tags && art.tags.join(', ')) || 'Featured Anime Releases';

    console.log(`\n[syndicator] Processing article: "${cleanTitle}"`);
    console.log(`  -> Target URL: ${targetUrl}`);

    if (isPublish && token) {
      const pubUrl = await publishToTelegraph(token, cleanTitle, `Overview: ${synopsis}. Full streaming episodes, reviews, and ongoing air schedules available directly on AniHubStream.`, targetUrl);
      if (pubUrl) {
        console.log(`  ✔ Published Live to: ${pubUrl}`);
        ledger[slug] = {
          title: cleanTitle,
          publishedUrl: pubUrl,
          targetUrl: targetUrl,
          timestamp: Date.now()
        };
        saveLedger(ledger);
        count++;
      }
    } else {
      console.log(`  [DRY-RUN] Would publish to Web 2.0 with backlink -> ${targetUrl}`);
      count++;
    }
  }

  console.log(`\n[syndicator] Finished. Processed ${count} items.`);
}

if (process.argv[1] && process.argv[1].endsWith('syndicate-new-episodes.mjs')) {
  runSyndication();
}
