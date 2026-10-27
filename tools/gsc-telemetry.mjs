// @ts-check
/**
 * tools/gsc-telemetry.mjs
 *
 * Lightweight Google Search Console Telemetry Client:
 * - Uses pure Node.js `node:crypto` for RS256 JWT service account authentication.
 * - Zero external dependencies (no heavy googleapis npm package needed).
 * - Inspects live indexing status (URL Inspection API).
 * - Queries search traffic, impressions, CTR, and top ranking queries.
 *
 * Usage:
 *   node tools/gsc-telemetry.mjs --inspect=https://anihubstream.pages.dev/
 *   node tools/gsc-telemetry.mjs --analytics --days=28
 *   node tools/gsc-telemetry.mjs --sitemaps
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SCOPES = 'https://www.googleapis.com/auth/webmasters.readonly';
const TOKEN_URI = 'https://oauth2.googleapis.com/token';
const DEFAULT_SITE_URL = process.env.GSC_SITE_URL || 'https://anihubstream.pages.dev/';

/**
 * Finds service account JSON key in known locations
 */
function findCredentialsFile() {
  const envPath = process.env.GSC_KEY_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (envPath && fs.existsSync(envPath)) return envPath;

  const candidates = [
    './gsc-key.json',
    './.gsc-key.json',
    './gsc-credentials.json',
    './tools/gsc-key.json',
  ];

  for (const c of candidates) {
    const full = path.resolve(c);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

/**
 * Generates an OAuth2 access token from a service account private key via RS256 JWT
 */
export async function getAccessToken(credentials) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: credentials.client_email,
    scope: SCOPES,
    aud: TOKEN_URI,
    exp: now + 3600,
    iat: now,
  };

  const encHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${encHeader}.${encPayload}`;

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  const signature = signer.sign(credentials.private_key, 'base64url');

  const assertion = `${signingInput}.${signature}`;

  const res = await fetch(TOKEN_URI, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google OAuth error HTTP ${res.status}: ${text}`);
  }

  const data = await res.json();
  return data.access_token;
}

/**
 * Inspects a specific URL in Google Search Console
 */
export async function inspectUrl(url, accessToken, siteUrl = DEFAULT_SITE_URL) {
  const res = await fetch('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      inspectionUrl: url,
      siteUrl,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GSC URL Inspection API error HTTP ${res.status}: ${text}`);
  }

  const json = await res.json();
  return json.inspectionResult;
}

/**
 * Queries Search Analytics for clicks, impressions, and top queries
 */
export async function queryAnalytics(accessToken, { siteUrl = DEFAULT_SITE_URL, days = 28, rowLimit = 10 } = {}) {
  const end = new Date();
  const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const formatDate = (d) => d.toISOString().split('T')[0];

  const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      startDate: formatDate(start),
      endDate: formatDate(end),
      dimensions: ['query'],
      rowLimit,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GSC Analytics API error HTTP ${res.status}: ${text}`);
  }

  return await res.json();
}

/**
 * Lists sitemaps registered in Google Search Console
 */
export async function listSites(accessToken) {
  const res = await fetch('https://www.googleapis.com/webmasters/v3/sites', {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.siteEntry || []).map((s) => s.siteUrl);
}

export async function listSitemaps(accessToken, siteUrl = DEFAULT_SITE_URL) {
  const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/sitemaps`;
  const res = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GSC Sitemaps API error HTTP ${res.status}: ${text}`);
  }

  return await res.json();
}

async function main() {
  const credPath = findCredentialsFile();
  if (!credPath) {
    console.error('❌ Google Search Console credentials file not found.');
    console.log('\nTo configure:');
    console.log('1. Generate a Service Account JSON key from Google Cloud Console.');
    console.log('2. Save it as `.gsc-key.json` in the root repository directory (already in .gitignore).');
    console.log('3. Add the service account email as a user on https://search.google.com/search-console');
    process.exit(1);
  }

  console.log(`🔑 Loading credentials from: ${credPath}`);
  const credentials = JSON.parse(fs.readFileSync(credPath, 'utf8'));
  console.log(`👤 Service Account: ${credentials.client_email}`);

  console.log('🔄 Authenticating with Google OAuth...');
  const token = await getAccessToken(credentials);
  console.log('✅ Access Token acquired successfully!\n');

  const sites = await listSites(token);
  if (!sites.length) {
    console.warn('⚠️ No verified properties found for this service account yet.');
    console.warn('\n👉 To grant access in Google Search Console:');
    console.warn('1. Open: https://search.google.com/search-console');
    console.warn('2. Select your property in the top-left dropdown (e.g. https://anihubstream.pages.dev/)');
    console.warn('3. Go to: Settings (bottom-left) ➔ Users and permissions ➔ Add user');
    console.warn(`4. Paste email: ${credentials.client_email}`);
    console.warn('5. Permission: Full (or Owner) ➔ Click "Add"');
    console.warn('\nOnce added, re-run: npm run gsc:status\n');
    return;
  } else {
    console.log(`🌐 Accessible Properties: ${sites.join(', ')}\n`);
  }

  function resolveSiteProperty(targetUrl, availableSites) {
    if (availableSites.includes(targetUrl)) return targetUrl;
    try {
      const u = new URL(targetUrl);
      const domainProp = `sc-domain:${u.hostname}`;
      if (availableSites.includes(domainProp)) return domainProp;
      const strippedDomain = `sc-domain:${u.hostname.replace(/^www\./, '')}`;
      if (availableSites.includes(strippedDomain)) return strippedDomain;
    } catch {}
    return availableSites[0] || DEFAULT_SITE_URL;
  }

  function siteToInspectUrl(site) {
    if (site.startsWith('sc-domain:')) {
      return `https://${site.replace('sc-domain:', '')}/`;
    }
    if (!site.endsWith('/')) {
      return `${site}/`;
    }
    return site;
  }

  const inspectArg = process.argv.find((a) => a.startsWith('--inspect='));
  const isAnalytics = process.argv.includes('--analytics');
  const isSitemaps = process.argv.includes('--sitemaps');

  if (inspectArg) {
    const targetUrl = inspectArg.split('=')[1];
    const property = resolveSiteProperty(targetUrl, sites);
    console.log(`🔍 Inspecting URL: ${targetUrl} (Property: ${property})`);
    const result = await inspectUrl(targetUrl, token, property);
    const indexResult = result?.indexStatusResult;
    console.log('\n--- Indexing Status ---');
    console.log(`Verdict:        ${indexResult?.verdict || 'UNKNOWN'}`);
    console.log(`Coverage State: ${indexResult?.coverageState || 'UNKNOWN'}`);
    console.log(`Robots.txt:     ${indexResult?.robotsTxtState || 'ALLOWED'}`);
    console.log(`Indexing State: ${indexResult?.indexingState || 'INDEXING_ALLOWED'}`);
    console.log(`Last Crawled:   ${indexResult?.lastCrawlTime || 'Not yet crawled'}`);
    console.log(`User Canonical: ${indexResult?.userCanonical || 'Not declared'}`);
    console.log(`Google Canonical: ${indexResult?.googleCanonical || 'Pending'}`);
    if (result?.richResultsResult) {
      console.log(`Rich Results:   ${result.richResultsResult.verdict || 'UNKNOWN'}`);
    }
  } else if (isAnalytics) {
    const property = sites[0] || DEFAULT_SITE_URL;
    console.log(`📊 Querying Search Analytics (Property: ${property})...`);
    const data = await queryAnalytics(token, { siteUrl: property });
    console.log('\n--- Top Queries & Traffic ---');
    if (data.rows && data.rows.length) {
      for (const row of data.rows) {
        console.log(`- "${row.keys[0]}": ${row.clicks} clicks | ${row.impressions} impressions | CTR: ${(row.ctr * 100).toFixed(1)}% | Avg Pos: ${row.position.toFixed(1)}`);
      }
    } else {
      console.log('No click/impression traffic recorded in this date range yet.');
    }
  } else if (isSitemaps) {
    const property = sites[0] || DEFAULT_SITE_URL;
    console.log(`🗺️ Listing Sitemaps for ${property}...`);
    const sitemaps = await listSitemaps(token, property);
    console.log(JSON.stringify(sitemaps, null, 2));
  } else {
    const property = sites[0] || DEFAULT_SITE_URL;
    const defaultUrl = siteToInspectUrl(property);
    console.log(`Default Check: Inspecting Homepage (${defaultUrl}) under ${property}...`);
    const result = await inspectUrl(defaultUrl, token, property);
    const indexResult = result?.indexStatusResult;
    console.log('\n--- Indexing Status ---');
    console.log(`Verdict:        ${indexResult?.verdict || 'UNKNOWN'}`);
    console.log(`Coverage State: ${indexResult?.coverageState || 'UNKNOWN'}`);
    console.log(`Robots.txt:     ${indexResult?.robotsTxtState || 'ALLOWED'}`);
    console.log(`Indexing State: ${indexResult?.indexingState || 'INDEXING_ALLOWED'}`);
    console.log(`Last Crawled:   ${indexResult?.lastCrawlTime || 'Not yet crawled'}`);
    console.log(`User Canonical: ${indexResult?.userCanonical || 'Not declared'}`);
    console.log(`Google Canonical: ${indexResult?.googleCanonical || 'Pending'}`);
  }
}

if (process.argv[1] && process.argv[1].endsWith('gsc-telemetry.mjs')) {
  main().catch((err) => {
    console.error('❌ Error executing GSC telemetry:', err.message);
    process.exit(1);
  });
}
