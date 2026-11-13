// anipm-suite/dump-crypto.mjs
import fs from 'node:fs';
import path from 'node:path';

const code = fs.readFileSync(path.resolve('anipm-suite', 'player-decompiled.js'), 'utf8');
const idx = code.indexOf('async function pi');
console.log(code.slice(Math.max(0, idx - 1500), idx + 200));
