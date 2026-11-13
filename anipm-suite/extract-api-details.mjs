// anipm-suite/extract-api-details.mjs
import fs from 'node:fs';
import path from 'node:path';

const bundlePath = path.resolve('anipm-suite', 'cache', 'index-BTf6JUMP.js');
const js = fs.readFileSync(bundlePath, 'utf8');

const targets = [
  '/api/anime/ani/',
  '/api/anime/series/',
  '/api/anime/home-bootstrap',
  '/api/anime/search',
  '/api/anime/meta',
  '/api/partner/v1/session',
  'settlar'
];

for (const t of targets) {
  console.log(`\n=================== TARGET: ${t} ===================`);
  let pos = 0;
  let count = 0;
  while ((pos = js.indexOf(t, pos)) !== -1 && count < 3) {
    const start = Math.max(0, pos - 200);
    const end = Math.min(js.length, pos + 300);
    console.log(`[Occurrence ${count + 1} at ${pos}]:`);
    console.log(js.slice(start, end));
    console.log('----------------------------------------------------');
    pos += t.length;
    count++;
  }
}
