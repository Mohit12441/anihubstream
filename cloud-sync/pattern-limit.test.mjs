// D1 refuses any LIKE/GLOB pattern over 50 bytes — measured against the production REST endpoint:
// a 50-byte pattern answers, a 51-byte one comes back HTTP 400 `LIKE or GLOB pattern too complex`.
// node:sqlite enforces no such limit, so every check in this repo that trips it locally passes in
// tests and dies only when an operator runs ops → report against production — which is exactly what
// happened to verify.mjs's added_at check (its single 75-byte pattern killed the whole audit at
// statement 12 while the probe before it read fine). These two guards are the reason that cannot
// come back: the first reads every shipped statement for over-long literals, the second proves the
// split replacement flags the same rows the 75-byte original did.
//
//   node --test cloud-sync/pattern-limit.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/* D1's ceiling, verified live (50 accepted, 51 refused) rather than taken from the docs. */
const LIMIT = 50;

/* Source files whose SQL reaches D1: the cloud-sync scripts over its REST endpoint, and the
 * Worker's API over its binding. The same ceiling applies to both — and both run real SQLite, so
 * the literals below are checked exactly as the database will see them. */
const SHIPPED = [
  'cloud-sync',
  join('functions', 'api'),
];

const jsFiles = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = join(dir, e.name);
  if (e.isDirectory()) return jsFiles(p);
  return /\.(?:mjs|js)$/.test(e.name) && !/\.test\.mjs$/.test(e.name) ? [p] : [];
});

/** The whole `... IS NOT NULL AND (...)` predicate verify.mjs runs for the added_at shape check. */
const addedAtPredicate = () => {
  const src = readFileSync(join(ROOT, 'cloud-sync', 'verify.mjs'), 'utf8');
  const m = src.match(/WHERE (added_at IS NOT NULL[\s\S]*?'\))/);
  assert.ok(m, "verify.mjs's added_at check no longer matches the shape this test reads — if the"
    + ' check moved to a different predicate, move this reader with it');
  return m[1].replace(/\s+/g, ' ');
};

const db = new DatabaseSync(':memory:');

/** Evaluate a predicate with `added_at` replaced by a literal value. */
const flags = (predicate, value) => {
  const lit = value === null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
  const sql = `SELECT CASE WHEN ${predicate.replaceAll('added_at', lit)} THEN 1 ELSE 0 END AS bad`;
  return db.prepare(sql).get().bad === 1;
};

describe('D1 LIKE/GLOB pattern limit (50 bytes, measured live)', () => {
  it('ships no inline LIKE/GLOB pattern longer than D1 answers', () => {
    const offenders = [];
    for (const top of SHIPPED) {
      for (const file of jsFiles(join(ROOT, top))) {
        const src = readFileSync(file, 'utf8');
        for (const [, quoted] of src.matchAll(/(?:\bLIKE|\bGLOB)\s+('(?:[^']|'')*')/g)) {
          /* The SQLite lexical rule: a quoted literal with doubled quotes is one string; its
             pattern is the text between the outer quotes, each doubled quote collapsed. */
          const pattern = quoted.slice(1, -1).replaceAll("''", "'");
          if (Buffer.byteLength(pattern) > LIMIT) {
            offenders.push(`${relative(ROOT, file)}: ${Buffer.byteLength(pattern)} bytes — ${pattern}`);
          }
        }
      }
    }
    assert.deepEqual(offenders, [],
      `live D1 refuses these with HTTP 400 'LIKE or GLOB pattern too complex' (limit ${LIMIT}):\n${offenders.join('\n')}`);
  });

  /* The fixtures cover both halves and the length that ties them; the predicate comes from
     verify.mjs itself, so this proves what ships, not a copy of it. The 75-byte original still
     runs here — node:sqlite has no 50-byte limit — which is the only way to show the halves are
     the whole shape, and the reason they cannot be checked against production instead. */
  it('the split added_at check flags exactly the shapes the 75-byte pattern flagged', () => {
    const OLD = `added_at IS NOT NULL AND added_at NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]'`;
    const NEW = addedAtPredicate();
    const fixtures = [
      ['2026-10-15 12:00:00', false], ['2026-01-01 00:00:00', false], ['1999-12-31 23:59:59', false],
      [null, false], ['', true],
      ['2026-10-15T12:00:00', true], ['2026-10-15  2:00:00', true], ['2026-10-15 12:00:0', true],
      ['2026-10-15 12:00:000', true], ['2026-10-15012:00:00', true], ['2026-10-15 12;00;00', true],
      ['2026-1-15 12:00:00', true], ['202a-10-15 12:00:00', true], ['2026-10-15 12:00:00 ', true],
      ['2026-10-15', true], ['not a datetime', true],
    ];
    for (const [value, expectBad] of fixtures) {
      const oldBad = flags(OLD, value);
      assert.equal(oldBad, expectBad, `the original pattern must itself flag ${JSON.stringify(value)}`);
      assert.equal(flags(NEW, value), oldBad, `the halves disagree with the whole on ${JSON.stringify(value)}`);
    }
    /* The halves stay under the ceiling the original could not clear. */
    for (const [, quoted] of NEW.matchAll(/(?:\bLIKE|\bGLOB)\s+('(?:[^']|'')*')/g)) {
      assert.ok(Buffer.byteLength(quoted.slice(1, -1)) <= LIMIT,
        `the added_at check ships a ${Buffer.byteLength(quoted.slice(1, -1))}-byte pattern: ${quoted}`);
    }
  });
});
