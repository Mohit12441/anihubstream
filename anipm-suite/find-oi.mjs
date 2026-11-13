// anipm-suite/find-oi.mjs
import fs from 'node:fs';
import path from 'node:path';

const js = fs.readFileSync(path.resolve('anipm-suite', 'cache', 'index-BTf6JUMP.js'), 'utf8');

const matches = js.match(/function oi\([^)]*\)\{[^}]+\}/g) || [];
console.log('function oi definition:', matches);

// Also search around "function oi" or "var oi" or "let oi" or "const oi"
const idx = js.indexOf('oi=');
if (idx !== -1) {
  console.log('oi assignment:', js.slice(idx - 100, idx + 200));
}
