// anipm-suite/dump-crypto-global.mjs
import fs from 'node:fs';
import path from 'node:path';

const js = fs.readFileSync(path.resolve('anipm-suite', 'cache', 'index-BTf6JUMP.js'), 'utf8');
const idx = js.indexOf('var li=(e,t)=>ii(e,ni.encode(t),`pl|v1`);');
console.log('Global index:', idx);
console.log(js.slice(Math.max(0, idx - 1500), idx + 100));
