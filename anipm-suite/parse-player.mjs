// anipm-suite/parse-player.mjs
import fs from 'node:fs';
import path from 'node:path';

const code = fs.readFileSync(path.resolve('anipm-suite', 'player-decompiled.js'), 'utf8');

// Find all fetch/URL/api calls
console.log('=== API / FETCH CALLS ===');
const apiMatches = code.match(/(?:fetch|pi)\([^)]+\)/g) || [];
for (const m of apiMatches) {
  console.log(m);
}

// Find all postMessage strings
console.log('\n=== POSTMESSAGE / ACTIONS ===');
const postMsg = code.match(/["']([a-zA-Z0-9_\-:]+)["']/g) || [];
const actions = [...new Set(postMsg)].filter(s =>
  ['hello', 'getState', 'play', 'pause', 'seek', 'timeupdate', 'state', 'quality', 'audio', 'subtitle', 'subtitles'].some(k => s.toLowerCase().includes(k))
);
console.log(actions);

// Look for functions defining the player catalog
console.log('\n=== PLAYER CATALOG ENDPOINT ===');
const catalogIdx = code.indexOf('anipm.player');
if (catalogIdx !== -1) {
  console.log(code.slice(Math.max(0, catalogIdx - 500), Math.min(code.length, catalogIdx + 1200)));
}
