// anipm-suite/analyze-bundle.mjs
// Analyzes the ume.to / ani.pm frontend bundle to map player, server switching, and API architecture

import fs from 'node:fs';
import path from 'node:path';

async function main() {
  console.log('[anipm-suite] Fetching ume.to index bundle...');
  const res = await fetch('https://ume.to/assets/index-BTf6JUMP.js', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': '*/*',
    }
  });

  if (!res.ok) {
    console.error('Failed to fetch bundle:', res.status, res.statusText);
    return;
  }

  const js = await res.text();
  console.log(`[anipm-suite] Bundle size: ${(js.length / 1024).toFixed(1)} KB`);

  // Save bundle locally for deep inspection
  const outDir = path.resolve('anipm-suite', 'cache');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index-BTf6JUMP.js'), js);
  console.log('[anipm-suite] Saved bundle to cache/index-BTf6JUMP.js');

  // 1. Extract API endpoints and base URLs
  const apiMatches = js.match(/\/api\/[a-zA-Z0-9_\-\/]+/g) || [];
  const uniqueApis = [...new Set(apiMatches)];
  console.log('\n--- API ENDPOINTS FOUND ---');
  console.log(uniqueApis);

  // 2. Extract external domains / domains used
  const domainMatches = js.match(/https?:\/\/[a-zA-Z0-9.\-_]+/g) || [];
  const uniqueDomains = [...new Set(domainMatches)].filter(d => !d.includes('w3.org') && !d.includes('schema.org'));
  console.log('\n--- EXTERNAL DOMAINS FOUND ---');
  console.log(uniqueDomains);

  // 3. Search for player servers / server names
  const serverMatches = js.match(/(?:settlar|beta|master\.m3u8|embed|cno\.to|stream|hls|sub|dub)/gi) || [];
  console.log('\n--- SERVER KEYWORDS FREQUENCY ---');
  const counts = {};
  for (const k of serverMatches) {
    const lower = k.toLowerCase();
    counts[lower] = (counts[lower] || 0) + 1;
  }
  console.log(counts);

  // 4. Search for player state / quality / audio / subtitle routines
  const patterns = [
    { name: 'Server switching', regex: /(?:switchServer|changeServer|activeServer|selectedServer|currentServer)[^;{}]{0,100}/gi },
    { name: 'Audio track selection', regex: /(?:audioTrack|selectedAudio|audioTracks|changeAudio)[^;{}]{0,100}/gi },
    { name: 'Subtitle track handling', regex: /(?:subtitles|subtitleTrack|captions|vtt|webvtt)[^;{}]{0,100}/gi },
    { name: 'Quality selection', regex: /(?:qualities|currentQuality|setQuality|autoQuality|levels)[^;{}]{0,100}/gi },
  ];

  for (const p of patterns) {
    const hits = js.match(p.regex) || [];
    console.log(`\n--- ${p.name} (found ${hits.length} occurrences) ---`);
    console.log([...new Set(hits)].slice(0, 5));
  }
}

main().catch(console.error);
