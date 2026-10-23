#!/usr/bin/env node
/**
 * tools/auto-sync-franchises.mjs
 * 
 * Automated franchise and seasons synchronization utility.
 * Automatically scans D1 anime catalog, computes bidirectional franchise graphs,
 * assigns chronological orders, and persists them into anime_franchise_relation.
 */

import { DatabaseSync } from 'node:sqlite';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Clean title words to prevent matching artifacts
const RESERVED_WORDS = /^(season|part|cour|act|episode|vol|volume|movie|ova|ona|special|final|first|second|third|fourth|order|zero|live|climax|deluxe|edition)$/i;

function cleanTitle(t) {
  if (!t || typeof t !== 'string') return '';
  return t
    .replace(/\s*\(\d{4}\)$/, '')
    .replace(/\s+([a-z0-9]{4,8})\s*([-–—]\s*(?:episode|ep|part|season|vol|volume)\b.*)$/i, (m, code, rest) => {
      return /\d/.test(code) ? ' ' + rest : m;
    })
    .replace(/\s*[-–—]?\s*([a-z0-9]{4,8})$/i, (m, code) => {
      return /\d/.test(code) ? '' : m;
    })
    .trim();
}

function extractBaseSlug(id) {
  if (!id) return '';
  return id
    .replace(/-season-\d+.*$/i, '')
    .replace(/-part-\d+.*$/i, '')
    .replace(/-cour-\d+.*$/i, '')
    .replace(/-final-season.*$/i, '')
    .replace(/-2nd-season.*$/i, '')
    .replace(/-3rd-season.*$/i, '')
    .replace(/-the-movie.*$/i, '')
    .replace(/-arc.*$/i, '')
    .replace(/-0$/, '');
}

function extractTitleRoot(title) {
  if (!title) return '';
  return title
    .replace(/[:\-–—]?\s*(?:season\s+\d+|final\s+season|2nd\s+season|3rd\s+season|\d+th\s+season|part\s+\d+|cour\s+\d+|\w+\s+arc\b|the\s+movie\b|the\s+final\b|arise\s+from\b).*$/i, '')
    .replace(/[:\-–—\s]+$/, '')
    .trim();
}

export function computeFranchiseGraph(animeRows) {
  const byId = new Map();
  const byTitleLower = new Map();
  const clustersBySlug = new Map();
  const clustersByTitle = new Map();

  for (const row of animeRows) {
    byId.set(row.id, row);
    byTitleLower.set(row.title.toLowerCase().trim(), row);

    // 1. Group by base slug
    const baseSlug = extractBaseSlug(row.id);
    if (baseSlug && baseSlug.length >= 4) {
      if (!clustersBySlug.has(baseSlug)) clustersBySlug.set(baseSlug, new Set());
      clustersBySlug.get(baseSlug).add(row.id);
    }

    // 2. Group by base title root
    const rootTitle = extractTitleRoot(row.title).toLowerCase();
    if (rootTitle && rootTitle.length >= 5) {
      if (!clustersByTitle.has(rootTitle)) clustersByTitle.set(rootTitle, new Set());
      clustersByTitle.get(rootTitle).add(row.id);
    }
  }

  // Set of relation keys: `${anime_id}:${related_id}`
  const relations = [];
  const added = new Set();

  function addRelation(animeId, relatedId, type, order = 0) {
    if (animeId === relatedId) return;
    const key = `${animeId}:${relatedId}`;
    if (added.has(key)) return;
    added.add(key);
    relations.push({
      anime_id: animeId,
      related_id: relatedId,
      relation_type: type,
      chronology_order: order,
    });
  }

  // Strategy A: Connect clusters discovered by base slug
  for (const [baseSlug, membersSet] of clustersBySlug.entries()) {
    if (membersSet.size <= 1) continue;
    const members = Array.from(membersSet).map((id) => byId.get(id)).filter(Boolean);
    // Sort chronologically
    members.sort((a, b) => {
      const ya = a.year || 9999;
      const yb = b.year || 9999;
      if (ya !== yb) return ya - yb;
      return a.title.localeCompare(b.title);
    });

    for (let i = 0; i < members.length; i++) {
      const a = members[i];
      for (let j = 0; j < members.length; j++) {
        if (i === j) continue;
        const b = members[j];
        const isMovie = (b.kind || '').toLowerCase() === 'movie' || b.id.includes('movie');
        const relType = isMovie ? 'movie' : (j > i ? 'sequel' : 'prequel');
        addRelation(a.id, b.id, relType, j);
      }
    }
  }

  // Strategy B: Connect clusters discovered by title root (only if high confidence)
  for (const [rootTitle, membersSet] of clustersByTitle.entries()) {
    if (membersSet.size <= 1) continue;
    const members = Array.from(membersSet).map((id) => byId.get(id)).filter(Boolean);
    members.sort((a, b) => (a.year || 9999) - (b.year || 9999));

    for (let i = 0; i < members.length; i++) {
      const a = members[i];
      for (let j = 0; j < members.length; j++) {
        if (i === j) continue;
        const b = members[j];
        const isMovie = (b.kind || '').toLowerCase() === 'movie' || b.id.includes('movie');
        const relType = isMovie ? 'movie' : (j > i ? 'sequel' : 'prequel');
        addRelation(a.id, b.id, relType, j);
      }
    }
  }

  // Strategy C: Process direct alt_seasons
  for (const row of animeRows) {
    if (!row.alt_seasons) continue;
    let list = [];
    try {
      list = typeof row.alt_seasons === 'string' ? JSON.parse(row.alt_seasons) : row.alt_seasons;
    } catch {}
    if (!Array.isArray(list)) continue;

    for (const alt of list) {
      if (!alt || typeof alt !== 'string') continue;
      const cleaned = cleanTitle(alt).toLowerCase();
      const matched = byTitleLower.get(cleaned);
      if (matched && matched.id !== row.id) {
        const orderA = row.year || 0;
        const orderB = matched.year || 0;
        const isMovieB = (matched.kind || '').toLowerCase() === 'movie';
        const isMovieA = (row.kind || '').toLowerCase() === 'movie';

        addRelation(row.id, matched.id, isMovieB ? 'movie' : (orderB >= orderA ? 'sequel' : 'prequel'), orderB);
        addRelation(matched.id, row.id, isMovieA ? 'movie' : (orderA >= orderB ? 'sequel' : 'prequel'), orderA);
      }
    }
  }

  return relations;
}

// Find local D1 database file
export function findLocalD1DbPath() {
  const dir = join(process.cwd(), '.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject');
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir);
  const sqlite = files.find((f) => f.endsWith('.sqlite') && !f.startsWith('metadata'));
  return sqlite ? join(dir, sqlite) : null;
}

async function run() {
  const dbPath = findLocalD1DbPath();
  if (!dbPath) {
    console.error('Could not find local D1 SQLite database in .wrangler/state/v3/d1');
    process.exit(1);
  }

  console.log(`Connecting to local D1: ${dbPath}`);
  const db = new DatabaseSync(dbPath);

  // Ensure table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS anime_franchise_relation (
      anime_id         TEXT NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
      related_id       TEXT NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
      relation_type    TEXT NOT NULL DEFAULT 'sequel',
      chronology_order INTEGER DEFAULT 0,
      created_at       TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (anime_id, related_id)
    );
    CREATE INDEX IF NOT EXISTS idx_afr_anime ON anime_franchise_relation(anime_id, chronology_order ASC);
    CREATE INDEX IF NOT EXISTS idx_afr_related ON anime_franchise_relation(related_id);
  `);

  console.log('Querying anime catalog...');
  const rows = db.prepare('SELECT id, title, year, season, kind, alt_seasons FROM anime').all();
  console.log(`Loaded ${rows.length} anime entries.`);

  console.log('Computing franchise graph...');
  const relations = computeFranchiseGraph(rows);
  console.log(`Identified ${relations.length} franchise relations across the catalog.`);

  if (relations.length > 0) {
    console.log('Persisting relations into anime_franchise_relation...');
    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO anime_franchise_relation (anime_id, related_id, relation_type, chronology_order, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `);

    db.exec('BEGIN TRANSACTION;');
    try {
      for (const rel of relations) {
        insertStmt.run(rel.anime_id, rel.related_id, rel.relation_type, rel.chronology_order);
      }
      db.exec('COMMIT;');
      console.log(`Successfully indexed ${relations.length} relations in D1!`);
    } catch (err) {
      db.exec('ROLLBACK;');
      console.error('Failed to commit franchise relations:', err);
      process.exit(1);
    }
  }

  // Audit sample franchises
  console.log('\n--- Sample Franchise Verification ---');
  const sampleAnime = ['jujutsu-kaisen', 'sousou-no-frieren', 'solo-leveling', 'demon-slayer', 'my-hero-academia'];
  for (const id of sampleAnime) {
    const rels = db.prepare(`
      SELECT r.related_id, a.title, a.year, a.season, r.relation_type, r.chronology_order
      FROM anime_franchise_relation r
      JOIN anime a ON a.id = r.related_id
      WHERE r.anime_id = ?
      ORDER BY r.chronology_order ASC, a.year ASC
    `).all(id);

    console.log(`\nFranchise for [${id}] (${rels.length} relations):`);
    for (const r of rels) {
      console.log(`  -> [${r.relation_type}] ${r.title} (${r.season || r.year || 'TBA'}) [${r.related_id}]`);
    }
  }
}

// Only execute when run directly from CLI
if (process.argv[1] && process.argv[1].endsWith('auto-sync-franchises.mjs')) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
