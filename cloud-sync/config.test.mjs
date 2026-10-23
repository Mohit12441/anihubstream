/**
 * Config and documentation contracts. No network, no clocks: these fail because a file and another
 * file disagree, which is the class of defect that costs a rollout day rather than a review round.
 *
 * Three things are pinned here:
 *   1. the README's env table and the variables the code actually reads — the same list, both ways;
 *   2. the Kitsu run count and the cron in .github/workflows/catalog-sync.yml;
 *   3. the air slot every writer stamps — column for column against an independent restatement, and
 *      the season rule against the site's own function, both executed rather than read as text.
 *
 * 3 matters most: those derivations live in files nothing imports in common, they write the same
 * five columns, and if they ever disagree the schedule shelf changes value on the first pass after
 * every cloud insert. Nothing but a test like this can see that.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { airSlot } from './sync-anilist.mjs';
import { RUNS_PER_DAY, MIN_INTERVAL_MS, KITSU_SAFE_HOURLY_CEILING } from './sync-kitsu.mjs';
import { seasonKey } from '../tools/season.mjs';
/* The site's copy of the same rule, executed rather than pattern-matched. Node strips the types on
   import — the same thing tools/sync-catalogue.mjs already does for src/data/anime.ts. */
import { currentSeasonKey } from '../src/data/model.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

/* The README table is the operator's only complete view of the configuration, so it has to be
   generated-by-hand-but-checked, not generated-by-trust. Anything the code reads and the table
   omits is a variable nobody will think to look for when a run misbehaves; anything the table
   lists and the code no longer reads is a lever an operator will pull and nothing will move. */
describe('env configuration, as documented and as read', () => {
  /* Every name the sync scripts read from the environment. The spellings are all in use:
     process.env.NAME directly, a destructured `const { A, B } = process.env`, and 'NAME' passed to
     intEnv/envNumber/flagEnv. Object literals inside tests are excluded by scanning only the
     non-test sources. */
  const READ_PATTERNS = [
    /process\.env\.([A-Z][A-Z0-9_]{2,})/g,
    /\bintEnv\('([A-Z][A-Z0-9_]{2,})'/g,
    /\benvNumber\('([A-Z][A-Z0-9_]{2,})'/g,
    /\bflagEnv\([^,]+,\s*'([A-Z][A-Z0-9_]{2,})'/g,
    /\benv\.([A-Z][A-Z0-9_]{2,})/g,
  ];
  /* Destructuring needs its own pass: one match holds several names. */
  const DESTRUCTURED = /\{\s*([A-Z][A-Z0-9_,\s]*?)\s*\}\s*=\s*process\.env/g;

  function varsReadByCode() {
    const found = new Map();
    for (const file of readdirSync(HERE).filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs'))) {
      const text = readFileSync(join(HERE, file), 'utf8');
      for (const pattern of READ_PATTERNS) {
        for (const match of text.matchAll(pattern)) {
          if (!found.has(match[1])) found.set(match[1], file);
        }
      }
      for (const match of text.matchAll(DESTRUCTURED)) {
        for (const name of match[1].split(',').map((s) => s.trim()).filter(Boolean)) {
          if (!found.has(name)) found.set(name, file);
        }
      }
    }
    return found;
  }

  /** The variable names in the first column of the README's env table. */
  function varsTabulated() {
    const readme = read('cloud-sync/README.md');
    const table = readme.split('### Env, default, phase, rollback')[1];
    assert.ok(table, 'the README must keep the heading this test reads its config table from');
    const names = new Map();
    for (const line of table.split('\n')) {
      const row = /^\|\s*`?([A-Z][A-Z0-9_]{2,})`?\s*\|/.exec(line);
      if (row) names.set(row[1], line);
    }
    return names;
  }

  it('lists every variable the code reads, and nothing it stopped reading', () => {
    const read_ = varsReadByCode();
    const table = varsTabulated();
    const undocumented = [...read_.keys()].filter((name) => !table.has(name));
    const unused = [...table.keys()].filter((name) => !read_.has(name));
    assert.deepEqual(undocumented, [],
      `read by the code but missing from the README table: ${undocumented.join(', ')} (first read in ${[...new Set(undocumented.map((n) => read_.get(n)))].join(', ')})`);
    assert.deepEqual(unused, [],
      `in the README table but read by nothing any more: ${unused.join(', ')}`);
  });

  it('documents each phase switch in .env.example too, since that is the local file operators copy', () => {
    const example = read('cloud-sync/.env.example');
    for (const name of ['CLOUD_CREATES_ROWS', 'LEGACY_WRITER_ACTIVE', 'CLOUD_OWNS_GENRES', 'CLOUD_OWNS_SCHEDULE', 'MODE']) {
      assert.match(example, new RegExp(`#?\\s*${name}=`), `${name} is a switch the code reads but .env.example does not name it`);
    }
    /* The one mistake this whole round was about: `--body` takes a literal string, so a JSON body
       stores a value the switch parser must refuse. No rollback command anywhere may show one. */
    const jsonBodies = [...example.matchAll(/--body\s+'?\{"?value"?/g)];
    assert.deepEqual(jsonBodies.map((m) => m[0]), [], '.env.example teaches a JSON --body, which corrupts the switch it sets');
  });

  it('gives every rollback a literal --body value, never a JSON body', () => {
    const readme = read('cloud-sync/README.md');
    /* Prose that warns about the shape is allowed; a command that would store it is not. Checked on
       the backticked command form, which is the only thing an operator pastes. */
    const offending = [...readme.matchAll(/`gh variable set [A-Za-z0-9_]+ --body [^\n`]*\{/g)];
    assert.deepEqual(offending.map((m) => m[0]), [], 'a rollback command passes a JSON body where --body wants a literal');
  });
});

/* The reproducibility half of the live-schema problem, checked without a production database: the
   committed DDL has to be able to receive the committed data. `catalogue_synced_at` was written by
   tools/hourly-refresh.mjs and inserted by seed.sql on every row while schema.sql did not define it,
   so a fresh environment built from the files in this repo failed on the first seed row — and nothing
   in any test suite was building a database that way, so only a new operator would have found it. */
describe('a fresh database built from the committed schema can be seeded', () => {
  it('creates every column seed.sql inserts', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(read('schema.sql'));
      const columns = new Set(db.prepare('PRAGMA table_info(anime)').all().map((r) => r.name));
      assert.ok(columns.size > 20, `schema.sql did not create an anime table (found ${columns.size} columns)`);
      const seed = read('seed.sql');
      const list = /INSERT INTO anime \(([^)]*)\)/.exec(seed)?.[1];
      assert.ok(list, 'seed.sql no longer has an `INSERT INTO anime (…)` this test can read');
      const missing = list.split(',').map((s) => s.trim()).filter((c) => !columns.has(c));
      assert.deepEqual(missing, [],
        `seed.sql inserts columns schema.sql does not create: ${missing.join(', ')} — a fresh environment cannot be seeded`);
      /* And the reverse: a column in the DDL that no seed row mentions is fine (nullable, filled by a
         sync), so this only asserts the pair is at least self-consistent about NOT NULL ones. */
      const notNullWithoutDefault = db.prepare('PRAGMA table_info(anime)').all()
        .filter((c) => c.notnull && !c.dflt_value && !c.pk && !list.includes(c.name));
      assert.deepEqual(notNullWithoutDefault.map((c) => c.name), [],
        'a NOT NULL column neither seeded nor defaulted will reject the first insert that omits it');
    } finally {
      db.close();
    }
  });
});

/* A constant a runner cannot read at runtime — the script does not know what cron woke it — so the
   coupling is checked from the file that holds the schedule. Changing the cron and not this is the
   same class of bug as the daily budget of 80 that made every late run a no-op. */
describe('the Kitsu run count and the schedule that produces it', () => {
  it('equals what catalog-sync.yml actually fires', () => {
    const workflow = read('.github/workflows/catalog-sync.yml');
    const crons = [...workflow.matchAll(/-\s*cron:\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    assert.equal(crons.length, 1, `expected one schedule entry, found ${crons.length}`);
    const [minute, hour, dayOfMonth, month, dayOfWeek] = crons[0].split(/\s+/);
    const count = (field, span) => (field === '*' ? span : field.split(',').length);
    assert.ok(dayOfMonth === '*' && month === '*' && dayOfWeek === '*',
      `the derivation assumes an every-day schedule, got '${crons[0]}'`);
    const perDay = count(minute, 60) * count(hour, 24);
    assert.equal(RUNS_PER_DAY, perDay,
      `catalog-sync.yml fires ${perDay} times a day ('${crons[0]}') but sync-kitsu.mjs budgets for ${RUNS_PER_DAY}; change one deliberately, not one by accident`);
  });

  it('enforces a safe hourly ceiling of at most 80 requests per hour (>= 45s spacing)', () => {
    assert.equal(KITSU_SAFE_HOURLY_CEILING, 80);
    assert.ok(MIN_INTERVAL_MS >= 45000, `expected spacing >= 45000ms, got ${MIN_INTERVAL_MS}`);
    const maxContinuousPerHour = Math.floor(3600000 / MIN_INTERVAL_MS);
    assert.ok(maxContinuousPerHour <= 80, `continuous caller throughput ${maxContinuousPerHour} exceeds 80 req/hr ceiling`);
  });
});

/* The writers of sched_* , formatting one column set from one AniList field. If they diverge, the
   value on a cloud-created row changes on the local task's next pass — once it is harmless, and then
   nobody notices the shelf flip-flopping weeks later. Three checks, deliberately of different kinds:
   airSlot's shape against an independent restatement of the legacy SQL (so a format bug is caught
   even though both writers now share season.mjs), the shared season rule against the site's own
   function with both executed, and the clear-to-NULL path against the legacy statement's text. */
describe('airSlot() and tools/hourly-refresh.mjs format the air slot identically', () => {
  /* Independent restatement of the legacy derivation (tools/hourly-refresh.mjs:114 and :119), written
     from the SQL it builds rather than from airSlot, so the two can fail to agree. */
  const legacySlot = (at) => {
    const d = new Date(at * 1000);
    const seasonOf = (month) => (month < 3 ? 'Winter' : month < 6 ? 'Spring' : month < 9 ? 'Summer' : 'Fall');
    const DAY_LABEL = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    return {
      sched_day: d.getUTCDay() === 0 ? 7 : d.getUTCDay(),
      sched_day_label: DAY_LABEL[d.getUTCDay()],
      sched_date: `${d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })} ${d.getUTCDate()}`,
      sched_time: `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`,
      sched_season: `${seasonOf(d.getUTCMonth())} ${d.getUTCFullYear()}`,
    };
  };

  /* Boundary instants chosen so a wrong rule shows up as a wrong value rather than a coincidence:
     Sunday (the 0-vs-7 case), midnight and :05, a single-digit day, each season's month edge, and
     a year crossing December to January. */
  const INSTANTS = [
    Date.UTC(2026, 9, 18, 14, 0) / 1000,   // Sunday afternoon
    Date.UTC(2026, 9, 7, 0, 0) / 1000,      // Wednesday midnight
    Date.UTC(2026, 10, 1, 5, 0) / 1000,     // November the first, 05:00
    Date.UTC(2026, 10, 20, 1, 0) / 1000,    // Friday, two-digit day
    Date.UTC(2026, 2, 1, 23, 30) / 1000,    // March: last Winter month under the legacy rule
    Date.UTC(2026, 3, 1, 0, 0) / 1000,      // April: first Spring
    Date.UTC(2026, 5, 30, 21, 0) / 1000,    // June: last Spring
    Date.UTC(2026, 6, 1, 0, 0) / 1000,      // July: first Summer
    Date.UTC(2026, 8, 30, 0, 0) / 1000,     // September: last Summer
    Date.UTC(2026, 9, 1, 0, 0) / 1000,      // October: first Fall
    Date.UTC(2026, 11, 31, 0, 5) / 1000,    // December 2026, crossing into the next year's label
    Date.UTC(2027, 0, 1, 0, 5) / 1000,      // January 2027: Winter of the following year
  ];

  it('agrees with the legacy derivation on every boundary instant', () => {
    const diffs = INSTANTS.filter((at) => JSON.stringify(airSlot({ nextAiringEpisode: { airingAt: at } }))
      !== JSON.stringify(legacySlot(at)));
    assert.deepEqual(diffs, [], `${diffs.length} instant(s) format differently: ${diffs.map((at) => new Date(at * 1000).toISOString()).join(', ')}`);
    /* Spot-check one value against the literal the shelf expects, so a shared refactor of BOTH
       derivations cannot move the format out from under functions/api/schedule.js. */
    const friday = airSlot({ nextAiringEpisode: { airingAt: Date.UTC(2026, 10, 20, 1, 0) / 1000 } });
    assert.deepEqual(friday, {
      sched_day: 5, sched_day_label: 'FRI', sched_date: 'Nov 20', sched_time: '01:00', sched_season: 'Fall 2026',
    });
  });

  it('clears the whole slot on "no next airing", as the legacy writer does', () => {
    /* The disagreement this guards is subtler than a format change: one writer clears, the other
       leaves a stale value, and the row keeps an air slot for a title that stopped airing. */
    const EMPTY = { sched_day: null, sched_day_label: null, sched_date: null, sched_time: null, sched_season: null };
    for (const media of [{}, { nextAiringEpisode: null }, { nextAiringEpisode: {} }, { nextAiringEpisode: { airingAt: 0 } },
      { nextAiringEpisode: { airingAt: -1 } }, { nextAiringEpisode: { airingAt: 'soon' } }]) {
      assert.deepEqual(airSlot(media), EMPTY, `airSlot must clear every column for ${JSON.stringify(media)}`);
    }
    /* And the legacy path clears the same five, keyed on the same field: this is the source text of
       the statement that runs when AniList reports no next episode. */
    const legacy = read('tools/hourly-refresh.mjs');
    const clear = /UPDATE anime SET (sched_[a-z_=(\s]*NULL[^,]*(?:, [^,]*)+) WHERE id/s.exec(legacy)?.[1] ?? '';
    for (const column of ['sched_day', 'sched_day_label', 'sched_date', 'sched_time', 'sched_season']) {
      assert.match(clear, new RegExp(`${column}=NULL`), `the legacy clear statement no longer nulls ${column}, so the two writers no longer clear the same set`);
    }
    assert.match(legacy, /nextAiringEpisode\{ airingAt \}/, 'the legacy writer must read the same AniList field airSlot reads');
  });

  /* Three writers stamp sched_season and all three now call the same seasonKey (tools/season.mjs),
     so they agree by construction and no test is needed for that. The fourth copy of the rule is
     the one worth executing: src/data/model.ts cannot import a .mjs under its own tsconfig, and it
     is the file that decides which season the schedule page opens on — so the page's filter and the
     column it filters on are two derivations that have to be compared, not assumed. Both run here
     over every month edge for three years. */
  it('uses the site\'s own season rule, and the writers cannot re-spell it', () => {
    const edges = [];
    for (let year = 2025; year <= 2027; year++) {
      for (let month = 0; month < 12; month++) {
        edges.push(Date.UTC(year, month, 1), Date.UTC(year, month, new Date(Date.UTC(year, month + 1, 0)).getUTCDate()));
      }
    }
    const mismatches = edges.filter((ms) => seasonKey(new Date(ms)) !== currentSeasonKey(new Date(ms)));
    assert.deepEqual(mismatches, [], `${mismatches.length} month edge(s) where tools/season.mjs and the page's own rule disagree — every title airing on those dates leaves the shelf it is filed on`);

    /* The failure this fence exists for is a writer that stops calling the shared rule and re-spells
       the quarter boundaries for itself, which is exactly how the AniList-convention bug got in. */
    const spelledOut = [];
    for (const dir of ['tools', 'cloud-sync']) {
      for (const file of readdirSync(join(ROOT, dir))) {
        if (file.endsWith('.mjs') && /< 3 \? 'Winter'/.test(read(join(dir, file)))) spelledOut.push(`${dir}/${file}`);
      }
    }
    assert.deepEqual(spelledOut.sort(), ['cloud-sync/config.test.mjs', 'tools/season.mjs'].sort(),
      'a second hand-written quarter rule exists; writers of sched_season must call tools/season.mjs so one column cannot mean two things');
  });
});
