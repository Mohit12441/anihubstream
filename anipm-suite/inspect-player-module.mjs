// anipm-suite/inspect-player-module.mjs
import fs from 'node:fs';
import path from 'node:path';

const bundlePath = path.resolve('anipm-suite', 'cache', 'index-BTf6JUMP.js');
const js = fs.readFileSync(bundlePath, 'utf8');

// Slice the player core logic
const start = 275000;
const end = 300000;
fs.writeFileSync(path.resolve('anipm-suite', 'player-decompiled.js'), js.slice(start, end));
console.log('Saved slice [275000:300000] to player-decompiled.js (size:', end - start, 'bytes)');
