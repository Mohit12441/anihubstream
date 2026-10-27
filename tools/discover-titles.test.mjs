import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendSource, readSources, removeSource, slugify } from './discover-titles.mjs';

describe('tools/discover-titles.mjs', () => {
  let tempDir;
  let tempSources;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'discover-test-'));
    tempSources = join(tempDir, 'catalogue-sources.json');
    const initial = [
      { id: 'demon-slayer', kitsu: 41370, anilist: 101922 },
      { id: 'jujutsu-kaisen', kitsu: 42765, anilist: 113415 },
    ];
    writeFileSync(tempSources, `${JSON.stringify(initial, null, 2)}\n`, 'utf8');
  });

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('slugify', () => {
    it('creates lowercase URL-safe slugs', () => {
      assert.equal(slugify('Attack on Titan: The Final Season'), 'attack-on-titan-the-final-season');
      assert.equal(slugify('Kaguya-sama: Love is War - Ultra Romantic'), 'kaguya-sama-love-is-war-ultra-romantic');
      assert.equal(slugify('  SPY x FAMILY  '), 'spy-x-family');
    });

    it('handles special characters and whitespace collapsing', () => {
      assert.equal(slugify('Re:ZERO -Starting Life in Another World-'), 're-zero-starting-life-in-another-world');
      assert.equal(slugify(''), '');
    });
  });

  describe('readSources', () => {
    it('reads and parses the sources file', () => {
      const sources = readSources(tempSources);
      assert.equal(sources.length, 2);
      assert.equal(sources[0].id, 'demon-slayer');
      assert.equal(sources[1].id, 'jujutsu-kaisen');
    });
  });

  describe('appendSource', () => {
    it('appends a new entry cleanly to the file', () => {
      const ok = appendSource({ id: 'solo-leveling', kitsu: 46231, anilist: 151807 }, tempSources);
      assert.equal(ok, true);

      const sources = readSources(tempSources);
      assert.equal(sources.length, 3);
      assert.equal(sources[2].id, 'solo-leveling');
      assert.equal(sources[2].anilist, 151807);
    });

    it('refuses an entry with an existing id', () => {
      const ok = appendSource({ id: 'demon-slayer', kitsu: 99999, anilist: 999999 }, tempSources);
      assert.equal(ok, false);

      const sources = readSources(tempSources);
      assert.equal(sources.length, 2);
      assert.equal(sources[0].kitsu, 41370);
    });

    it('refuses an entry with an existing anilist id under a different slug', () => {
      const ok = appendSource({ id: 'kimetsu-no-yaiba', kitsu: 41370, anilist: 101922 }, tempSources);
      assert.equal(ok, false);

      const sources = readSources(tempSources);
      assert.equal(sources.length, 2);
    });
  });

  describe('removeSource', () => {
    it('removes an existing entry by id and retains valid JSON', () => {
      removeSource('demon-slayer', tempSources);

      const sources = readSources(tempSources);
      assert.equal(sources.length, 1);
      assert.equal(sources[0].id, 'jujutsu-kaisen');
    });

    it('is a no-op if the id does not exist', () => {
      removeSource('nonexistent-id', tempSources);

      const sources = readSources(tempSources);
      assert.equal(sources.length, 2);
    });
  });
});
