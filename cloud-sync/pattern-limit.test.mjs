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
import { onRequestGet } from '../functions/api/anime/index.js';

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

  /* ------------------------------------------- patterns built while a request is served
     Everything above reads source, so it only sees a pattern somebody wrote down. A viewer's query
     becomes its pattern at request time, and the Worker put the query string straight inside `%…%`:
     a 49-character search was a production HTTP 500, and initialsPattern's bound is 16 *characters*
     where D1 counts *bytes*, so the 79-byte shorthand a token of 16 CJK characters produces failed
     the same way while 48 ASCII characters passed. node:sqlite enforces no ceiling at all, so the
     stub below is the only thing in this repo that answers the way production does. It refuses any
     bound pattern over LIMIT bytes with the error D1 actually returns, and the handler is judged on
     whether it still asks. */
  const askSearch = (ceiling = LIMIT) => {
    const sent = [];
    /* Every LIKE binding carries a wildcard, whether the substring form `%…%` or the shorthand
       `g% u% …`; the facet filters this handler also binds carry neither. Keying on the percent is
       what lets one rule refuse both shapes — keying on the leading percent alone would let an
       over-wide shorthand through unrecorded, and the test would pass by not looking. */
    const police = (values) => {
      for (const value of values) {
        if (typeof value !== 'string' || !value.includes('%')) continue;
        sent.push(value);
        if (Buffer.byteLength(value) > ceiling) {
          throw new Error('d1: HTTP 400 [{"code":7500,"message":"LIKE or GLOB pattern too complex: SQLITE_ERROR"}]');
        }
      }
    };
    const statement = (values) => ({
      all: async () => { police(values); return { results: [] }; },
      first: async () => { police(values); return { n: 0 }; },
    });
    const env = { ANIHUB: { prepare: () => ({
      bind: (...values) => statement(values),
      all: () => statement([]).all(),
      first: () => statement([]).first(),
    }) } };
    return async (q) => {
      sent.length = 0;
      const url = `https://anihubstream.com/api/anime?sort=relevance&q=${encodeURIComponent(q)}`;
      const response = await onRequestGet({ request: new Request(url), env });
      return { status: response.status, patterns: [...sent] };
    };
  };

  it('answers a viewer token longer than D1 answers instead of failing the request', async () => {
    const ask = askSearch();
    const cases = [
      ['49 ascii', 'a'.repeat(49)], ['60 ascii', 'a'.repeat(60)], ['120 ascii', 'a'.repeat(120)],
      ['17 cjk', '\u3042'.repeat(17)], ['24 cjk', '\u3042'.repeat(24)], ['48 cjk', '\u3042'.repeat(48)],
    ];
    for (const [name, token] of cases) {
      const { status, patterns } = await ask(token);
      assert.equal(status, 200, `${name} (${Buffer.byteLength(token)} bytes) is a ${status}: ${patterns.join(' | ')}`);
      assert.ok(patterns.length > 0, `${name} never reached the database at all`);
      for (const pattern of patterns) {
        assert.ok(Buffer.byteLength(pattern) <= LIMIT,
          `${name} shipped a ${Buffer.byteLength(pattern)}-byte pattern to D1: ${pattern}`);
      }
    }
  });

  it('cuts an over-long token to a prefix, which keeps the prefilter a superset', async () => {
    const ask = askSearch();
    const whole = await ask('a'.repeat(49));
    assert.ok(whole.patterns.includes(`%${'a'.repeat(48)}%`),
      `a 49-character token must be searched as the longest prefix D1 answers, not dropped: ${whole.patterns.join(' | ')}`);
    const cjk = await ask('\u3042'.repeat(17));
    assert.ok(cjk.patterns.includes(`%${'\u3042'.repeat(16)}%`),
      `17 CJK characters are 53 bytes of pattern and must cut to 16 (50): ${cjk.patterns.join(' | ')}`);
  });

  it('keeps the word-initials shorthand D1 can answer and drops the one it cannot', async () => {
    const ask = askSearch();
    const shorthand = (token) => [...token].map((c) => `${c}%`).join(' ');
    const short = await ask('gurren');
    assert.ok(short.patterns.includes('%gurren%'), 'an ordinary token lost its substring pattern');
    assert.ok(short.patterns.includes(shorthand('gurren')),
      `the ceiling is not a switch that turns shorthand off for everyone: ${short.patterns.join(' | ')}`);

    /* 16 CJK characters clear initialsPattern's own character bound and make a 79-byte pattern. */
    const token = '\u3042'.repeat(16);
    assert.ok(Buffer.byteLength(shorthand(token)) > LIMIT,
      'this fixture stopped being the case the test is about — if the ceiling moved, move it here');
    const wide = await ask(token);
    assert.ok(!wide.patterns.includes(shorthand(token)),
      `the over-wide initials pattern is still being sent: ${wide.patterns.join(' | ')}`);
    assert.ok(wide.patterns.includes(`%${token}%`), 'dropping the shorthand must not drop the substring check with it');
  });
});
