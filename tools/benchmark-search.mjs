// @ts-check
/**
 * tools/benchmark-search.mjs
 *
 * Automated Latency Benchmark for Consolidated Search
 */

import { performance } from 'node:perf_hooks';

const EDGE_BASE = process.env.EDGE_BASE || 'http://127.0.0.1:8899';
const KEYWORDS = [
  'frieren',
  'solo leveling',
  'one piece',
  'demon slayer',
  'jujutsu kaisen',
  'chainsaw man',
  'naruto',
  'bleach',
  'witch',
  'hero',
];

async function runBenchmark() {
  console.log('================================================================');
  console.log('⚡ Consolidated Search Endpoint Latency Benchmark');
  console.log('================================================================\n');

  const latencies = [];

  for (const kw of KEYWORDS) {
    const start = performance.now();
    try {
      const res = await fetch(`${EDGE_BASE}/api/search?q=${encodeURIComponent(kw)}`);
      const duration = Math.round(performance.now() - start);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      latencies.push(duration);
      console.log(`  Search "${kw.padEnd(16)}": ✓ ${String(duration).padStart(4)}ms (${json.total || 0} deduplicated titles, source: ${json.source})`);
    } catch (err) {
      const duration = Math.round(performance.now() - start);
      console.log(`  Search "${kw.padEnd(16)}": ✗ ${duration}ms (Error: ${err.message})`);
    }
  }

  const sum = latencies.reduce((a, b) => a + b, 0);
  const mean = Math.round(sum / latencies.length);
  const min = Math.min(...latencies);
  const max = Math.max(...latencies);
  const sorted = [...latencies].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || max;

  console.log('\n================================================================');
  console.log('📊 Search Benchmark Summary');
  console.log('================================================================');
  console.log(`• Total Queries:  ${latencies.length}`);
  console.log(`• Mean Latency:   ${mean}ms`);
  console.log(`• Min Latency:    ${min}ms`);
  console.log(`• Max Latency:    ${max}ms`);
  console.log(`• P95 Latency:    ${p95}ms`);
  console.log('================================================================\n');
}

runBenchmark().catch(console.error);
