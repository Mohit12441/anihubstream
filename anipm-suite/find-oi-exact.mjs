// anipm-suite/find-oi-exact.mjs
import fs from 'node:fs';
import path from 'node:path';

const code = fs.readFileSync(path.resolve('anipm-suite', 'player-decompiled.js'), 'utf8');

// Find where oi( is called
const idx = code.indexOf('oi(`/ani-api');
if (idx !== -1) {
  console.log('Context of oi call:');
  console.log(code.slice(Math.max(0, idx - 400), Math.min(code.length, idx + 400)));
}
