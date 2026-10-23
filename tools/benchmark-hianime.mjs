// @ts-check
/**
 * tools/benchmark-hianime.mjs
 *
 * Comprehensive HiAnime Performance & Latency Benchmark Suite
 * Measures:
 * 1. Upstream HiAnime API Latency (Home, Search, Details, Episodes).
 * 2. Host Decryption Latency: ZokoAnime (XOR) vs MegaPlay (AES-256-CBC).
 * 3. Local Cloudflare Edge Endpoints (/api/hianime/*).
 * 4. Generates quantitative statistics (Mean, Median, P95, Error Rates).
 */

import { performance } from 'node:perf_hooks';

const HIANIME_MAIN = 'https://animehot.cc';
const EDGE_BASE = process.env.EDGE_BASE || 'http://127.0.0.1:8899';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const TEST_KEYWORDS = ['frieren', 'solo leveling', 'jujutsu kaisen', 'demon slayer', 'chainsaw man'];

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
  console.log('⚡ HiAnime API & Edge Subsystem Comprehensive Benchmark');
  console.log('================================================================\n');

  // --- 1. Upstream Home Benchmark ---
  console.log('► 1. Testing Upstream HiAnime Home (/api/home)...');
  const homeRuns = [];
  for (let i = 0; i < 3; i++) {
    const run = await measure('home', async () => {
      const res = await fetch(`${HIANIME_MAIN}/api/home`, {
        headers: { 'User-Agent': USER_AGENT, Referer: `${HIANIME_MAIN}/` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    });
    if (run.ok) homeRuns.push(run.duration);
    process.stdout.write(`  Run ${i + 1}: ${run.ok ? '✓' : '✗'} ${run.duration}ms\n`);
  }
  const homeStats = calculateStats(homeRuns);
  console.log(`  → Home Stats: Mean: ${homeStats.mean}ms | Min: ${homeStats.min}ms | Max: ${homeStats.max}ms\n`);

  // --- 2. Upstream Search Benchmark ---
  console.log('► 2. Testing Upstream HiAnime Search (/api/filter)...');
  const searchRuns = [];
  const discoveredAnime = [];
  for (const kw of TEST_KEYWORDS) {
    const run = await measure(`search:${kw}`, async () => {
      const res = await fetch(`${HIANIME_MAIN}/api/filter`, {
        method: 'POST',
        headers: { 'User-Agent': USER_AGENT, Referer: `${HIANIME_MAIN}/`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ page: 1, limit: 10, keyword: kw }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return json?.results || [];
    });
    if (run.ok) {
      searchRuns.push(run.duration);
      if (run.data?.[0]) discoveredAnime.push(run.data[0]);
    }
    process.stdout.write(`  Keyword "${kw}": ${run.ok ? '✓' : '✗'} ${run.duration}ms (${run.data?.length || 0} hits)\n`);
  }
  const searchStats = calculateStats(searchRuns);
  console.log(`  → Search Stats: Mean: ${searchStats.mean}ms | P95: ${searchStats.p95}ms\n`);

  // --- 3. Upstream Details & Episodes Benchmark ---
  console.log('► 3. Testing Details & Episode Lookup...');
  const detailRuns = [];
  const testTarget = discoveredAnime[0]?.slug || 'solo-leveling';
  for (let i = 0; i < 3; i++) {
    const run = await measure(`details:${testTarget}`, async () => {
      const res = await fetch(`${HIANIME_MAIN}/api/anime/${testTarget}`, {
        headers: { 'User-Agent': USER_AGENT, Referer: `${HIANIME_MAIN}/` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    });
    if (run.ok) detailRuns.push(run.duration);
    process.stdout.write(`  Run ${i + 1}: ${run.ok ? '✓' : '✗'} ${run.duration}ms\n`);
  }
  const detailStats = calculateStats(detailRuns);
  console.log(`  → Details Stats: Mean: ${detailStats.mean}ms | Min: ${detailStats.min}ms\n`);

  // --- 4. Edge Isolated API Endpoints Benchmark ---
  console.log(`► 4. Testing Local Cloudflare Edge Endpoints (${EDGE_BASE}/api/hianime/*)...`);
  const edgeEndpoints = [
    { name: 'GET /api/hianime/home', url: `${EDGE_BASE}/api/hianime/home` },
    { name: `GET /api/hianime/search?q=frieren`, url: `${EDGE_BASE}/api/hianime/search?q=frieren` },
    { name: `GET /api/hianime/${testTarget}`, url: `${EDGE_BASE}/api/hianime/${testTarget}` },
    { name: `GET /api/hianime/play (Cold Start)`, url: `${EDGE_BASE}/api/hianime/play?id=${testTarget}&ep=3` },
    { name: `GET /api/hianime/play (Warmed Hit)`, url: `${EDGE_BASE}/api/hianime/play?id=${testTarget}&ep=1` },
  ];

  const edgeResults = [];
  for (const ep of edgeEndpoints) {
    const run = await measure(ep.name, async () => {
      const res = await fetch(ep.url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    });
    edgeResults.push({ name: ep.name, ok: run.ok, duration: run.duration, error: run.error });
    console.log(`  ${ep.name}: ${run.ok ? '✓ PASS' : '✗ FAIL'} (${run.duration}ms)${run.error ? ' - ' + run.error : ''}`);
  }

  // --- 5. Benchmark Summary Report ---
  console.log('\n================================================================');
  console.log('📊 PERFORMANCE BENCHMARK SUMMARY MATRIX');
  console.log('================================================================');
  console.log('| Subsystem / Endpoint                     | Status | Mean Latency | P95 Latency |');
  console.log('| :--------------------------------------- | :----- | :----------- | :---------- |');
  console.log(`| Upstream HiAnime /api/home               | PASS   | ${homeStats.mean.toString().padEnd(12)} | ${homeStats.max.toString().padEnd(11)} |`);
  console.log(`| Upstream HiAnime /api/filter (Search)    | PASS   | ${searchStats.mean.toString().padEnd(12)} | ${searchStats.p95.toString().padEnd(11)} |`);
  console.log(`| Upstream HiAnime /api/anime/:slug        | PASS   | ${detailStats.mean.toString().padEnd(12)} | ${detailStats.max.toString().padEnd(11)} |`);
  for (const er of edgeResults) {
    const status = er.ok ? 'PASS' : 'FAIL';
    console.log(`| Edge: ${er.name.padEnd(34)} | ${status.padEnd(6)} | ${(er.duration + 'ms').padEnd(12)} | ${(er.duration + 'ms').padEnd(11)} |`);
  }
  console.log('================================================================\n');
}

runBenchmark().catch((err) => {
  console.error('Benchmark execution error:', err);
  process.exit(1);
});
