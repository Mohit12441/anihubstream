import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pullPureCatalogData } from './data-pull-pure.mjs';
import { validateAnimeDoc } from '../lib/data-schema.mjs';

test('data-pull-pure: extracts pure data from local sqlite and generates valid files', async () => {
  const tmpOut = path.resolve('tools/.cache/test-pull-data');
  if (fs.existsSync(tmpOut)) {
    fs.rmSync(tmpOut, { recursive: true, force: true });
  }

  const result = await pullPureCatalogData({
    source: 'local',
    outDir: tmpOut,
    limit: 5 // test with 5 anime for fast execution
  });

  assert.equal(result.success, true);
  assert.ok(result.animeCount > 0);

  // Verify reference files
  assert.ok(fs.existsSync(path.join(tmpOut, 'reference', 'genres.json')));
  assert.ok(fs.existsSync(path.join(tmpOut, 'manifest.json')));

  const genres = JSON.parse(fs.readFileSync(path.join(tmpOut, 'reference', 'genres.json'), 'utf8'));
  assert.ok(Array.isArray(genres) && genres.length > 0);

  // Verify catalog folder and at least one anime JSON document
  const catalogDir = path.join(tmpOut, 'catalog');
  assert.ok(fs.existsSync(catalogDir));
  const files = fs.readdirSync(catalogDir).filter(f => f.endsWith('.json'));
  assert.ok(files.length > 0);

  // Validate the first exported document against our canonical schema validator
  const firstDoc = JSON.parse(fs.readFileSync(path.join(catalogDir, files[0]), 'utf8'));
  const validation = validateAnimeDoc(firstDoc);
  assert.equal(validation.valid, true, `Validation failed: ${validation.errors.join(', ')}`);

  // Cleanup
  fs.rmSync(tmpOut, { recursive: true, force: true });
});
