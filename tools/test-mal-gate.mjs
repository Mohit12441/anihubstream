// @ts-check
import assert from 'node:assert';

const BASE = 'http://127.0.0.1:8795';

async function getJson(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

async function run() {
  console.log('=== STARTING PATCH 4 MAL GATE TESTS ===\n');

  // 0. Initial health
  const h0 = await getJson('/health');
  console.log('Initial Health:', h0.mal);

  // 1. First resolution: Solo Leveling MAL 52299 Ep 1 Sub
  console.log('\n[Test 1] Testing direct MAL 52299 ep 1 sub resolution...');
  const t1Start = Date.now();
  const r1 = await getJson('/resolve?title=Solo+Leveling&ep=1&audio=sub&provider=anikoto&mal=52299');
  const t1Elapsed = Date.now() - t1Start;
  console.log(`Resolution succeeded in ${t1Elapsed}ms:`);
  console.log('  Provider:', r1.provider);
  console.log('  Master:', r1.master);
  console.log('  Variants count:', r1.variants?.length);
  console.log('  Proof:', r1.proof);
  console.log('  Subtitles count:', r1.subtitles?.length);
  console.log('  Skip:', r1.skip);

  assert(r1.provider === 'anikoto', 'Expected anikoto provider');
  assert(r1.proof?.container === 'mpegts' || r1.proof?.container === 'mp4', 'Expected valid container proof');
  assert(r1.subtitles?.length > 0, 'Expected subtitle tracks');

  const h1 = await getJson('/health');
  console.log('Health after Test 1:', h1.mal);
  assert(h1.mal.hits >= 1, 'Expected at least 1 MAL hit');

  // 2. Repeat request (Session / Cache reuse)
  console.log('\n[Test 2] Testing session/cache reuse for same query...');
  const t2Start = Date.now();
  const r2 = await getJson('/resolve?title=Solo+Leveling&ep=1&audio=sub&provider=anikoto&mal=52299');
  const t2Elapsed = Date.now() - t2Start;
  console.log(`Repeat query completed in ${t2Elapsed}ms (reused: ${r2.reused})`);
  assert(r2.reused === true, 'Expected session reuse');

  // 3. Unmapped MAL -> fallback to search or miss
  const unmappedMal = 990000 + Math.floor(Math.random() * 9000);
  console.log(`\n[Test 3] Testing unmapped MAL ${unmappedMal} (expecting miss & cache)...`);
  const hBefore3 = await getJson('/health');
  const t3Start = Date.now();
  // Using a title that exists on AniKoto so we see the fallback kick in!
  const r3 = await getJson(`/resolve?title=Solo+Leveling&ep=1&audio=sub&provider=anikoto&mal=${unmappedMal}`);
  const t3Elapsed = Date.now() - t3Start;
  console.log(`Fallback resolved in ${t3Elapsed}ms: provider=${r3.provider}`);
  const hAfter3 = await getJson('/health');
  console.log('Health after Test 3:', hAfter3.mal);
  assert(hAfter3.mal.misses === hBefore3.mal.misses + 1, `Expected 1 miss recorded for MAL ${unmappedMal}`);

  // Second call with unmapped MAL should immediately hit missCache without delay
  console.log(`\n[Test 3b] Testing immediate miss cache hit for MAL ${unmappedMal}...`);
  const t3bStart = Date.now();
  await getJson(`/resolve?title=Solo+Leveling&ep=1&audio=sub&provider=anikoto&mal=${unmappedMal}`);
  const t3bElapsed = Date.now() - t3bStart;
  console.log(`Second call completed in ${t3bElapsed}ms (reused session or fast fallback)`);

  // 4. Dub resolution testing with fallback / caching
  console.log('\n[Test 4] Testing MAL dub resolution with sub fallback...');
  const r4 = await getJson('/resolve?title=Solo+Leveling&ep=1&audio=dub&provider=anikoto&mal=52299');
  console.log('Dub request resolved:', { provider: r4.provider, audio: r4.audio });
  assert(r4.audio === 'dub' || r4.audio === 'sub', 'Expected dub or sub fallback');

  // 5. Final /health report
  const hFinal = await getJson('/health');
  console.log('\n[Test 5] Final /health verification:');
  console.log(JSON.stringify(hFinal.mal, null, 2));
  assert(hFinal.mal.hits >= 1, 'Expected hits');
  assert(typeof hFinal.mal.hitRatio === 'number', 'Expected numeric hitRatio');

  console.log('\n=== ALL GATE TESTS PASSED ===');
}

run().catch((err) => {
  console.error('\nGATE TEST FAILED:', err);
  process.exit(1);
});
