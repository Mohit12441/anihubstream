// @ts-check
/**
 * tools/benchmark-anikoto.mjs
 *
 * Comprehensive AniKoto Performance & Latency Benchmark Suite
 * Measures:
 * 1. Local Edge AniKoto Home (/api/anikoto/home).
 * 2. Local Edge AniKoto Search (/api/anikoto/search?q=...).
 * 3. Local Edge AniKoto Details (/api/anikoto/:id).
 * 4. Local Edge Playback Cold Start vs Warm Cache Hits (/api/anikoto/play?id=...&ep=1).
 * 5. Upstream anikoto.cz response times.
 */

import { performance } from 'node:perf_hooks';

const ANIKOTO_MAIN = 'https://anikoto.cz';
const EDGE_BASE = process.env.EDGE_BASE || 'http://127.0.0.1:8899';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const TEST_KEYWORDS = ['frieren', 'solo leveling', 'one piece', 'witch', 'polar opposites'];

function calculateStats(latencies) {
  if (latencies.length === 0) return { min: 0, max: 0, mean: 0, median: 0, p95: 0 };
  const sorted = [...latencies].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = Math.round(sum / sorted.length);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const median = sorted[Math.floor(sorted.length / 2)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || max;
  return { min, max, mean, median, p95 };
}

async function measure(name, fn) {
  const start = performance.now();
  try {
    const res = await fn();
    const duration = Math.round(performance.now() - start);
    return { name, ok: true, duration, data: res };
  } catch (err) {
    const duration = Math.round(performance.now() - start);
    return { name, ok: false, duration, error: err.message };
  }
}

async function runBenchmark() {
  console.log('================================================================');
  console.log('⚡ AniKoto API & Edge Subsystem Comprehensive Benchmark');
  console.log('================================================================\n');

  // --- 1. Local Edge Home Benchmark ---
  console.log('► 1. Testing Local Edge AniKoto Home (/api/anikoto/home)...');
  const homeRuns = [];
  for (let i = 0; i < 5; i++) {
    const run = await measure('home', async () => {
      const res = await fetch(`${EDGE_BASE}/api/anikoto/home`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    });
    if (run.ok) homeRuns.push(run.duration);
    process.stdout.write(`  Run ${i + 1}: ${run.ok ? '✓' : '✗'} ${run.duration}ms\n`);
  }
  const homeStats = calculateStats(homeRuns);
  console.log(`  → Home Stats: Mean: ${homeStats.mean}ms | Min: ${homeStats.min}ms | Max: ${homeStats.max}ms\n`);

  // --- 2. Local Edge Search Benchmark ---
  console.log('► 2. Testing Local Edge AniKoto Search (/api/anikoto/search?q=...)...');
  const searchRuns = [];
  const discoveredAnime = [];
  for (const kw of TEST_KEYWORDS) {
    const run = await measure(`search:${kw}`, async () => {
      const res = await fetch(`${EDGE_BASE}/api/anikoto/search?q=${encodeURIComponent(kw)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return json?.data || [];
    });
    if (run.ok) {
      searchRuns.push(run.duration);
      if (Array.isArray(run.data) && run.data.length > 0) {
        discoveredAnime.push(run.data[0]);
      }
    }
    process.stdout.write(`  Search "${kw}": ${run.ok ? '✓' : '✗'} ${run.duration}ms (${run.data?.length || 0} hits)\n`);
  }
  const searchStats = calculateStats(searchRuns);
  console.log(`  → Search Stats: Mean: ${searchStats.mean}ms | Min: ${searchStats.min}ms | Max: ${searchStats.max}ms\n`);

  // --- 3. Local Edge Details Benchmark ---
  console.log('► 3. Testing Local Edge AniKoto Details (/api/anikoto/:id)...');
  const detailRuns = [];
  const targetIds = discoveredAnime.map((a) => a.slug || a.id).slice(0, 3);
  if (targetIds.length === 0) targetIds.push('frieren-beyond-journey-s-end-c6fbj');

  for (const id of targetIds) {
    const run = await measure(`details:${id}`, async () => {
      const res = await fetch(`${EDGE_BASE}/api/anikoto/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    });
    if (run.ok) detailRuns.push(run.duration);
    process.stdout.write(`  Details "${id}": ${run.ok ? '✓' : '✗'} ${run.duration}ms (eps: ${run.data?.data?.episodes?.length || 0})\n`);
  }
  const detailStats = calculateStats(detailRuns);
  console.log(`  → Details Stats: Mean: ${detailStats.mean}ms | Min: ${detailStats.min}ms | Max: ${detailStats.max}ms\n`);

  // --- 4. Edge Playback Cold Start vs Warm Cache ---
  console.log('► 4. Testing Edge Playback Latency: Cold Start vs Warm Cache (/api/anikoto/play)...');
  const testAnimeSlug = targetIds[0] || 'frieren-beyond-journey-s-end-c6fbj';

  // Request episode 2 to measure cold start
  const coldRun = await measure('cold_start:ep2', async () => {
    const res = await fetch(`${EDGE_BASE}/api/anikoto/play?id=${encodeURIComponent(testAnimeSlug)}&ep=2`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  });
  console.log(`  → Episode 2 Cold Start: ${coldRun.ok ? '✓' : '✗'} ${coldRun.duration}ms (Source: ${coldRun.data?.source || 'unknown'})`);

  // Immediately re-fetch episode 2 to measure warm cache
  const warmRuns = [];
  for (let i = 0; i < 4; i++) {
    const warmRun = await measure(`warm_cache_hit_${i + 1}`, async () => {
      const res = await fetch(`${EDGE_BASE}/api/anikoto/play?id=${encodeURIComponent(testAnimeSlug)}&ep=2`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    });
    if (warmRun.ok) warmRuns.push(warmRun.duration);
    console.log(`  → Warm Hit #${i + 1}: ${warmRun.ok ? '✓' : '✗'} ${warmRun.duration}ms (Source: ${warmRun.data?.source})`);
  }
  const warmStats = calculateStats(warmRuns);

  console.log('\n================================================================');
  console.log('📊 AniKoto Subsystem Performance Summary');
  console.log('================================================================');
  console.log(`• Edge Home Shelves:     ${homeStats.mean}ms`);
  console.log(`• Edge Search (Indexed):  ${searchStats.mean}ms`);
  console.log(`• Edge Details:          ${detailStats.mean}ms`);
  console.log(`• Stream Cold Start:     ${coldRun.duration}ms`);
  console.log(`• Stream Warm Cache Hit: ${warmStats.mean}ms (Target: <50ms)`);
  console.log('================================================================\n');
}

runBenchmark().catch(console.error);
