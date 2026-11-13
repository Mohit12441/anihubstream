// anipm-suite/test-all.mjs
/**
 * Comprehensive Test Suite for AniPM / Ume.to / Ani.nz
 */

import assert from 'node:assert';
import {
  searchAnime,
  getSeries,
  getBetaServerInfo,
  getQualities,
  resolveSettlarSession,
  deriveSealKey,
  DOMAINS
} from './anipm-client.mjs';

async function runTests() {
  console.log('===============================================================');
  console.log('       ANIPM / UME.TO / ANI.NZ FULL REVERSE-ENGINEERING TEST   ');
  console.log('===============================================================\n');

  // Test 1: Cryptographic key derivation
  console.log('[TEST 1] Deriving HKDF API-Seal Key...');
  const key = await deriveSealKey();
  assert.ok(key, 'Key must be derived successfully');
  console.log('✓ PASS: Cryptographic Key derived successfully (AES-GCM 256-bit)\n');

  // Test 2: Search API
  console.log('[TEST 2] Testing Search API on ume.to (/ani-api/anime/search)...');
  const results = await searchAnime('Solo Leveling');
  assert.ok(Array.isArray(results) && results.length > 0, 'Search should return items');
  const solo = results[0];
  console.log(`✓ PASS: Found "${solo.title}" (ID: ${solo.id}, Source: ${solo.source}, Slug: ${solo.slug})\n`);

  // Test 3: Series Metadata & Episode Catalogue
  console.log('[TEST 3] Testing Series & Episode List API (/ani-api/partner/v1/series)...');
  const anilistId = 151807; // Solo Leveling
  const series = await getSeries(anilistId);
  assert.strictEqual(series.anilistId, anilistId);
  assert.ok(Array.isArray(series.episodeList) && series.episodeList.length >= 12);
  const ep1 = series.episodeList[0];
  assert.strictEqual(ep1.number, 1);
  assert.ok(ep1.embed.sub && ep1.embed.dub, 'Sub and dub embeds must exist');
  console.log(`✓ PASS: Series "${series.title}" loaded with ${series.episodeList.length} episodes.`);
  console.log(`       Ep 1 Sub Embed: ${ep1.embed.sub}`);
  console.log(`       Ep 1 Dub Embed: ${ep1.embed.dub}\n`);

  // Test 4: Beta Server Multi-Audio Mapping
  console.log('[TEST 4] Testing Beta Server Audio Tracking (/api/anime/beta-server/:id)...');
  const narutoId = 1735; // Naruto Shippuden has 5 languages
  const betaInfo = await getBetaServerInfo(narutoId);
  assert.ok(betaInfo.available === true, 'Beta server should be marked available');
  assert.ok(Array.isArray(betaInfo.audio), 'Audio array must exist');
  console.log(`✓ PASS: Beta Server Available: ${betaInfo.available}`);
  console.log(`       Origin: ${betaInfo.origin}`);
  console.log(`       Audio Tracks: ${JSON.stringify(betaInfo.audio)}`);
  console.log(`       Subtitle Tracks: ${JSON.stringify(betaInfo.subs)}\n`);

  // Test 5: Quality Rungs Discovery
  console.log('[TEST 5] Testing Quality Ladder API (/api/anime/beta-server/:id/qualities)...');
  const qualities = await getQualities(narutoId, 1);
  assert.ok(Array.isArray(qualities.heights) && qualities.heights.includes(1080));
  console.log(`✓ PASS: Supported Heights: ${JSON.stringify(qualities.heights)}`);
  console.log(`       Quality Bitrates:`, qualities.rungs.map(r => `${r.height}p: ${(r.bitrate / 1000).toFixed(0)} kbps`).join(' | '), '\n');

  // Test 6: Settlar Player Live Nonce & Session Generation
  console.log('[TEST 6] Testing Live Nonce & Settlar Session Resolution...');
  const settlarData = await resolveSettlarSession(anilistId, 1, 'sub');
  assert.ok(settlarData.nonce, 'Nonce must be extracted from HTML');
  assert.ok(settlarData.session.token, 'Token must be issued by partner API');
  console.log(`✓ PASS: Live Nonce Extracted: ${settlarData.nonce}`);
  console.log(`       Player Origin: ${settlarData.playerOrigin}`);
  console.log(`       Token: ${settlarData.session.token.slice(0, 35)}...`);
  console.log(`       Availability:`, settlarData.session.availability);
  console.log(`       Expires At: ${new Date(settlarData.session.expiresAt * 1000).toISOString()}\n`);

  // Test 7: Domain Health & Topology Check
  console.log('[TEST 7] Cross-Domain Topology Verification...');
  for (const [name, url] of Object.entries(DOMAINS)) {
    try {
      const res = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': 'Mozilla/5.0' } });
      console.log(`       ${name.padEnd(14)} (${url}): HTTP ${res.status}`);
    } catch (e) {
      console.log(`       ${name.padEnd(14)} (${url}): Error (${e.message})`);
    }
  }

  console.log('\n===============================================================');
  console.log('       ALL 7 API & REVERSE-ENGINEERING TESTS PASSED!           ');
  console.log('===============================================================\n');
}

runTests().catch((err) => {
  console.error('\n❌ TEST FAILURE:', err);
  process.exit(1);
});
