import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();

test('ProviderRow: component file exists and exports ProviderRow', () => {
  const compPath = path.join(rootDir, 'src', 'components', 'search', 'ProviderRow.tsx');
  assert.ok(fs.existsSync(compPath), 'ProviderRow.tsx must exist');

  const content = fs.readFileSync(compPath, 'utf8');
  assert.match(content, /export function ProviderRow/, 'Must export ProviderRow');
  assert.match(content, /\?provider=/, 'ProviderRow links must include ?provider= parameter');
  assert.match(content, /scrollBy/, 'ProviderRow must include smooth horizontal scroll controls');
});

test('Search.tsx: renders ProviderRow for federated results', () => {
  const searchPath = path.join(rootDir, 'src', 'pages', 'Search.tsx');
  const content = fs.readFileSync(searchPath, 'utf8');

  assert.match(content, /import\s*\{[^}]*ProviderRow[^}]*\}\s*from\s*['"]\.\.\/components\/search\/ProviderRow['"]/, 'Search.tsx must import ProviderRow');
  assert.match(content, /<ProviderRow/, 'Search.tsx must render ProviderRow component');
});

test('Watch.tsx: supports ?provider= URL parameter for eager server matching', () => {
  const watchPath = path.join(rootDir, 'src', 'pages', 'Watch.tsx');
  const content = fs.readFileSync(watchPath, 'utf8');

  assert.match(content, /params\.get\(['"]provider['"]\)/, 'Watch.tsx must extract provider parameter');
  assert.match(content, /matchedServer/, 'Watch.tsx must match server based on provider param');
});
