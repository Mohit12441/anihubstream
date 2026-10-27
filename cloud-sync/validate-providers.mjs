// @ts-check
/**
 * cloud-sync/validate-providers.mjs
 *
 * Automated Streaming Provider Health & Dead-Slug Validator:
 * 1. Samples provider mappings across AniKoto, HiAnime, and AniWatch.
 * 2. Probes upstream mirrors and availability endpoints with lightweight timeouts.
 * 3. Downgrades confidence or flags dead slugs so player fallback routes cleanly to working sources.
 * 4. Can run standalone, via scheduled CI canary, or as part of the maintenance pipeline.
 */

import { randomUUID } from 'node:crypto';
import { d1All, d1First, d1Query } from './d1.mjs';

const RUN_ID = randomUUID();
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const intEnv = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive integer, got ${raw}`);
  return n;
};

export const PROVIDER_HEALTH_SAMPLE_SIZE = intEnv('PROVIDER_HEALTH_SAMPLE_SIZE', 20);

/**
 * Probes an AniKoto slug
 */
export async function probeAniKotoSlug(slug) {
  if (!slug) return false;
  try {
    const res = await fetch(`https://anikoto.cz/watch/${slug}`, {
      method: 'HEAD',
      headers: { 'User-Agent': USER_AGENT, Referer: 'https://anikoto.cz/' },
      signal: AbortSignal.timeout(3500),
    });
    return res.status >= 200 && res.status < 400;
  } catch {
    return false;
  }
}

/**
 * Probes a HiAnime slug
 */
export async function probeHiAnimeSlug(slug) {
  if (!slug) return false;
  try {
    const res = await fetch(`https://animehot.cc/api/anime/${slug}`, {
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT, Referer: 'https://animehot.cc/' },
      signal: AbortSignal.timeout(3500),
    });
    if (!res.ok) return false;
    const json = await res.json().catch(() => null);
    return Boolean(json?.anime || json?.id || json?.slug);
  } catch {
    return false;
  }
}

/**
 * Probes an AniWatch slug
 */
export async function probeAniWatchSlug(slug) {
  if (!slug) return false;
  try {
    const res = await fetch(`https://aniwatch.co.at/${slug}`, {
      method: 'HEAD',
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(3500),
    });
    return res.status >= 200 && res.status < 400;
  } catch {
    return false;
  }
}

/**
 * Validates a sample of provider mappings and updates health confidence
 */
export async function validateProviderHealth({ sampleSize = PROVIDER_HEALTH_SAMPLE_SIZE } = {}) {
  console.log(`[validate-providers] Starting Provider Health Probe ${RUN_ID} (sample size: ${sampleSize})...`);
  
  const results = {
    tested: 0,
    healthy: 0,
    degraded: 0,
  };

  try {
    // Select a rolling sample of provider mappings ordered by oldest updated
    const sample = await d1All(`
      SELECT anime_id, provider_id, provider_slug, confidence
      FROM anime_provider_mapping
      WHERE provider_id IN ('anikoto', 'hianime', 'aniwatch')
      ORDER BY updated_at ASC
      LIMIT ?1
    `, [sampleSize]);

    if (sample.length === 0) {
      console.log('[validate-providers] No provider mappings found to test.');
      return { status: 'success', results };
    }

    console.log(`[validate-providers] Testing ${sample.length} provider mappings...`);

    for (const mapping of sample) {
      results.tested++;
      const { anime_id, provider_id, provider_slug } = mapping;
      let isHealthy = false;

      if (provider_id === 'anikoto') {
        isHealthy = await probeAniKotoSlug(provider_slug);
      } else if (provider_id === 'hianime') {
        isHealthy = await probeHiAnimeSlug(provider_slug);
      } else if (provider_id === 'aniwatch') {
        isHealthy = await probeAniWatchSlug(provider_slug);
      }

      if (isHealthy) {
        results.healthy++;
        // Refresh timestamp and ensure confidence is high
        await d1Query(`
          UPDATE anime_provider_mapping
          SET confidence = 1.0, updated_at = unixepoch()
          WHERE anime_id = ?1 AND provider_id = ?2
        `, [anime_id, provider_id]).catch(() => null);
      } else {
        results.degraded++;
        console.warn(`[validate-providers] ⚠️ Provider "${provider_id}" for [${anime_id}] returned offline/404 (${provider_slug})`);
        // Degrade confidence to 0.1 so player prefers working alternate providers
        await d1Query(`
          UPDATE anime_provider_mapping
          SET confidence = 0.1, updated_at = unixepoch()
          WHERE anime_id = ?1 AND provider_id = ?2
        `, [anime_id, provider_id]).catch(() => null);
      }
    }

    console.log(`[validate-providers] ✅ Validation complete: ${results.healthy}/${results.tested} healthy, ${results.degraded} degraded.`);
    return { status: 'success', results };
  } catch (err) {
    console.error('[validate-providers] Error during validation pass:', err);
    return { status: 'error', error: err.message, results };
  }
}

// CLI execution
if (process.argv[1] && process.argv[1].endsWith('validate-providers.mjs')) {
  validateProviderHealth()
    .then((res) => {
      console.log('Result:', res);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
