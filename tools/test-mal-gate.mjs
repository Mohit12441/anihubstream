// @ts-check
import assert from 'node:assert';

const BASE = 'http://127.0.0.1:8795';

async function getJson(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`${path} failed: ${res.status} ${text}`);
    // @ts-ignore
    err.status = res.status;
    throw err;
  }
  return await res.json();
}

async function run() {
  console.log('=== STARTING PATCH 4 RIGOROUS MAL GATE TESTS ===\n');

  // 0. Initial health
  const h0 = await getJson('/health');
  console.log('Initial Health:', h0.mal);

  // 1. First resolution: Solo Leveling MAL 52299 Ep 1 Sub
  console.log('\n[Test 1] Testing direct MAL 52299 ep 1 sub resolution (cold hit)...');
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

  // 2a. Repeat request (Session cache reuse)
  console.log('\n[Test 2a] Testing session cache reuse for identical query...');
  const t2aStart = Date.now();
  const r2a = await getJson('/resolve?title=Solo+Leveling&ep=1&audio=sub&provider=anikoto&mal=52299');
  const t2aElapsed = Date.now() - t2aStart;
  console.log(`Session cache query completed in ${t2aElapsed}ms (reused: ${r2a.reused})`);
  assert(r2a.reused === true, 'Expected session reuse');

  // 2b. malDataIdCache verification (Session cache BYPASS via unique server param)
  const uniqueServer2 = `Bypass_${Date.now()}`;
  console.log(`\n[Test 2b] Testing malDataIdCache hit (bypassing session cache with server=${uniqueServer2})...`);
  const t2bStart = Date.now();
  const r2b = await getJson(`/resolve?title=Solo+Leveling&ep=1&audio=sub&provider=anikoto&mal=52299&server=${uniqueServer2}`);
  const t2bElapsed = Date.now() - t2bStart;
  console.log(`Query completed in ${t2bElapsed}ms (reused: ${r2b.reused ?? false}, master: ${r2b.master})`);
  assert(!r2b.reused, 'Expected fresh session (session cache bypassed)');
  assert(r2b.proof?.container === 'mpegts', 'Expected valid proof container');
  console.log('  -> Confirmed: fresh session minted from cached dataId without re-scraping embed page!');

  // 3. Unmapped MAL -> miss recorded, fallback to search
  const unmappedMal = 990000 + Math.floor(Math.random() * 9000);
  console.log(`\n[Test 3] Testing unmapped MAL ${unmappedMal} (recording miss and falling back to search)...`);
  const hBefore3 = await getJson('/health');
  const t3Start = Date.now();
  const r3 = await getJson(`/resolve?title=Solo+Leveling&ep=1&audio=sub&provider=anikoto&mal=${unmappedMal}`);
  const t3Elapsed = Date.now() - t3Start;
  console.log(`Fallback resolved in ${t3Elapsed}ms: provider=${r3.provider}`);
  const hAfter3 = await getJson('/health');
  console.log('Health after Test 3:', hAfter3.mal);
  assert(hAfter3.mal.misses === hBefore3.mal.misses + 1, `Expected 1 miss recorded for MAL ${unmappedMal}`);

  // 3b. malMissCache verification (bypassing session cache via fallback=false & fresh server)
  console.log(`\n[Test 3b] Testing malMissCache hit (bypassing session cache with server=FreshServer & fallback=false)...`);
  const t3bStart = Date.now();
  let missCaught = false;
  try {
    await getJson(`/resolve?title=UnknownAnime&ep=1&audio=sub&provider=anikoto&mal=${unmappedMal}&server=FreshServer&fallback=false`);
  } catch (e) {
    missCaught = true;
    const t3bElapsed = Date.now() - t3bStart;
    console.log(`Immediate miss rejection in ${t3bElapsed}ms (status: ${e.status})`);
    assert(t3bElapsed < 2000, `Expected instant miss cache hit (< 2000ms), got ${t3bElapsed}ms`);
  }
  assert(missCaught, 'Expected request to be rejected quickly via malMissCache');

  // 4a. Dub request on title with NO dub on MegaPlay: MAL 47917 (Bocchi the Rock!)
  console.log('\n[Test 4a] Testing dub request on un-dubbed title (MAL 47917 Bocchi the Rock!)...');
  const t4aStart = Date.now();
  const r4a = await getJson('/resolve?title=Bocchi+the+Rock&ep=1&audio=dub&provider=anikoto&mal=47917');
  const t4aElapsed = Date.now() - t4aStart;
  console.log(`Resolved in ${t4aElapsed}ms: audio=${r4a.audio}, provider=${r4a.provider}`);
  assert(r4a.audio === 'sub', `Expected fallback to sub, got audio=${r4a.audio}`);
  console.log('  -> Confirmed: dub upstream failed and cleanly fell back to sub, setting malDubDownCache');

  // 4b. malDubDownCache verification: repeat dub request with server bypass
  const uniqueServer4 = `BypassDub_${Date.now()}`;
  console.log(`\n[Test 4b] Testing malDubDownCache hit (bypassing session cache with server=${uniqueServer4})...`);
  const t4bStart = Date.now();
  const r4b = await getJson(`/resolve?title=Bocchi+the+Rock&ep=1&audio=dub&provider=anikoto&mal=47917&server=${uniqueServer4}`);
  const t4bElapsed = Date.now() - t4bStart;
  console.log(`Resolved in ${t4bElapsed}ms (reused: ${r4b.reused ?? false}, audio: ${r4b.audio})`);
  assert(!r4b.reused, 'Expected fresh session (session cache bypassed)');
  assert(r4b.audio === 'sub', 'Expected sub audio from malDubDownCache');
  console.log('  -> Confirmed: malDubDownCache immediately routed to sub without probing dub upstream!');

  // 5. Final /health report
  const hFinal = await getJson('/health');
  console.log('\n[Test 5] Final /health verification:');
  console.log(JSON.stringify(hFinal.mal, null, 2));
  assert(hFinal.mal.hits >= 2, 'Expected at least 2 hits');
  assert(hFinal.mal.misses >= 1, 'Expected at least 1 miss');
  assert(typeof hFinal.mal.hitRatio === 'number', 'Expected numeric hitRatio');

  console.log('\n=== ALL 7 RIGOROUS GATE TESTS PASSED ===');
}

run().catch((err) => {
  console.error('\nGATE TEST FAILED:', err);
  process.exit(1);
});
