// anipm-suite/find-player.mjs
import fs from 'node:fs';
import path from 'node:path';

const bundlePath = path.resolve('anipm-suite', 'cache', 'index-BTf6JUMP.js');
const js = fs.readFileSync(bundlePath, 'utf8');

const terms = ['/embed/', 'iframe', 'player', 'video', 'ep=e', 'sourceId', 'servers'];

for (const term of terms) {
  console.log(`\n=================== SEARCH: ${term} ===================`);
  let pos = 0;
  let count = 0;
  while ((pos = js.indexOf(term, pos)) !== -1 && count < 3) {
    const start = Math.max(0, pos - 150);
    const end = Math.min(js.length, pos + 250);
    console.log(`[Pos ${pos}]:`);
    console.log(js.slice(start, end));
    console.log('----------------------------------------------------');
    pos += term.length;
    count++;
  }
}
