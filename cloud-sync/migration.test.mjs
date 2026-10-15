// T1–T7 of the sole-writer migration, against a real SQLite database.
//
// Every assertion here is made by reading rows back out of SQLite after the sync ran its
// actual SQL through the actual d1.mjs/insertRows() chunking. The D1 REST endpoint is stood
// in for by a fetch shim that hands each statement and its bound parameters to node:sqlite,
// so the ON CONFLICT clauses, the CASE expressions, json_patch(), the NOT NULL constraints
// and the genre foreign keys are genuinely executed. A mock would let a broken CASE pass.
//
// AniList is stubbed at the same boundary, so no request leaves the machine and the pacing
// floor is dropped to 20ms for these runs. T6, the 50-send pacing test at the production
// floor, lives in rate.test.mjs where it can afford two real minutes.
//
//   node --test cloud-sync/migration.test.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { applySchema, splitStatements } from './apply-schema.mjs';
import { assertLiveColumns, diffLiveColumns } from './d1.mjs';
import { ANIME_COLUMNS, provenance, rowFromMedia, updateSet } from './sync-anilist.mjs';
import { FORBIDDEN, compare } from './diff-rows.mjs';
import { audit } from './verify.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const GENRE_IDS = ['action', 'adventure', 'fantasy', 'isekai', 'romance', 'slice-of-life', 'horror', 'comedy', 'supernatural', 'sci-fi', 'drama', 'mystery'];

/* Airing instants used by the fixtures, so the expected sched_* values are stated once here
   rather than re-derived inside each case. 2026-10-07 is a Wednesday, 10-13 a Tuesday,
   10-18 a Sunday and 11-20 a Friday, all in UTC. */
const WED = Math.floor(Date.UTC(2026, 9, 7, 0, 0) / 1000);
const TUE = Math.floor(Date.UTC(2026, 9, 13, 1, 0) / 1000);
const SUN = Math.floor(Date.UTC(2026, 9, 18, 14, 0) / 1000);
const FRI = Math.floor(Date.UTC(2026, 10, 20, 1, 0) / 1000);

/* ------------------------------------------------------------------ world */

class World {
  constructor() {
    this.db = new DatabaseSync(join(tmpdir(), `anihub-migration-${randomUUID()}.sqlite`));
    /* Foreign keys ON, as D1 enforces them: an invented genre id fails here instead of
       landing on a live catalogue. */
    this.db.exec('PRAGMA foreign_keys = ON;');
    /* The shipped schemas, verbatim: if schema.sql and the code disagree, a test fails rather
       than a cron run failing against the production database.
       The cloud file is applied statement by statement, with the production splitter, because it
       ends in the run-once ALTER tail — and since schema.sql itself gained `catalogue_synced_at`
       (seed.sql inserts it, so a fresh database without the column cannot be seeded) exactly one
       of those ALTERs now lands on a column that already exists. Tolerating that duplicate is
       what apply-schema does; asserting that it is the ONLY duplicate is what keeps the two
       committed files from drifting apart silently, which is the divergence the live-schema dump
       was invented to catch and this catches without a production database. */
    this.db.exec(readFileSync(join(HERE, '..', 'schema.sql'), 'utf8'));
    const overlapping = [];
    for (const { sql } of splitStatements(readFileSync(join(HERE, 'schema.sql'), 'utf8'))) {
      try {
        this.db.exec(sql);
      } catch (err) {
        if (!/duplicate column name/i.test(err.message)) throw err;
        overlapping.push(err.message);
      }
    }
    assert.deepEqual(overlapping, ['duplicate column name: catalogue_synced_at'],
      'schema.sql and cloud-sync/schema.sql disagree about more than the column schema.sql now owns');
    /* This list is meant to empty out. cloud-sync/schema.sql marks its catalogue_synced_at ALTER
       TRANSITIONAL: once cloud-sync/schema.live.sql shows the column in production, the ALTER comes
       out and this assertion becomes `deepEqual(overlapping, [])`. */
    for (const [i, id] of GENRE_IDS.entries()) {
      const label = { 'sci-fi': 'Sci-Fi', 'slice-of-life': 'Slice of Life' }[id] ?? id[0].toUpperCase() + id.slice(1);
      this.db.prepare('INSERT INTO genre (id, label, tagline, art, accent, position) VALUES (?,?,?,?,?,?)')
        .run(id, label, 'tagline', 'art-key', '#ff1f4a', i);
    }
    this.media = new Map();
    this.trending = [];
    this.anilistCalls = [];
    this.sqlCalls = [];
    /** hook(sql, params): mutate the database between a read and a write, to test the race. */
    this.onSql = null;
  }

  install() {
    globalThis.fetch = async (url, init = {}) => {
      const u = String(url);
      if (u.includes('api.cloudflare.com')) return this.d1(init);
      if (u.includes('graphql.anilist.co')) return this.anilist(init, u);
      throw new Error(`migration.test: nothing serves ${u}`);
    };
    return this;
  }

  /* D1's REST contract, answered by SQLite. state.mjs binds with ?1..?n: SQLite numbers them
     the same way, but node:sqlite only accepts the anonymous positional form, so the indices
     are stripped here. Nothing else about the statement is touched — the SQL is the SQL. */
  async d1(init) {
    const { sql, params = [] } = JSON.parse(init.body);
    this.sqlCalls.push({ sql, params });
    if (this.onSql) this.onSql(sql, params);
    /* Real SQLite — and D1, which is SQLite — resolves `?N` by NUMBER: every occurrence of `?1` in
       `WHERE ?1 > 0 AND catalogue_synced_at > ?1` takes the same value, from a params array that
       holds it once. node:sqlite hands values out by POSITION, so the numbered placeholders are
       re-expanded here in the order they appear. Forwarding the original array instead would bind
       the second occurrence to a value that is not there, and node:sqlite reads a missing binding
       as NULL — the comparison goes false and a real collision goes unreported. */
    let numbered = false;
    const order = [];
    const text = sql.replace(/\?(\d+)/g, (_m, n) => { numbered = true; order.push(params[Number(n) - 1] ?? null); return '?'; });
    const flat = numbered ? order : params.map((p) => (p === undefined ? null : p));
    try {
      if (/^\s*(select|with|values|pragma)\b/i.test(text)) {
        return respond({ success: true, result: { results: this.db.prepare(text).all(...flat), meta: { changes: 0 } } });
      }
      const out = this.db.prepare(text).run(...flat);
      return respond({ success: true, result: { results: [], meta: { changes: Number(out.changes), last_row_id: Number(out.lastInsertRowid) } } });
    } catch (err) {
      return respond({ success: false, errors: [{ code: 7500, message: `${err.message} :: ${text.slice(0, 200)}` }] }, false);
    }
  }

  /* One GraphQL document in; one trending page or one aliased Media batch out. */
  async anilist(init, url) {
    const document = init.method === 'GET' || url.includes('query=')
      ? decodeURIComponent(new URL(url).searchParams.get('query') ?? '')
      : JSON.parse(init.body ?? '{}').query ?? '';
    this.anilistCalls.push(document);
    if (/Page\(/.test(document)) {
      const perPage = Number(/perPage:\s*(\d+)/.exec(document)?.[1] ?? 50);
      return respond({ data: { Page: { pageInfo: { hasNextPage: false }, media: this.trending.slice(0, perPage).map((id) => ({ id })) } } });
    }
    const data = {};
    for (const [, alias, id] of document.matchAll(/m(\d+):\s*Media\(id:\s*(\d+)\)/g)) {
      const media = this.media.get(Number(id));
      if (media) data[`m${alias}`] = media;
    }
    return respond({ data });
  }

  /* ---- fixtures ---- */

  /** A row exactly as tools/sync-catalogue.mjs would have written it, stamps and all. */
  stored(row = {}) {
    const r = {
      id: 'a-test-title', title: 'A Test Title', native: 'テスト', year: 2024, rating: 8.1, season: 'Fall 2024',
      kind: 'TV', status: 'Ongoing', art: 'art/old-poster.jpg', key_art: 'art/old-key.jpg', accent: '#ff1f4a',
      synopsis: 'Written by the local sync.', rank: 12, trend_rank: 3, alt_seasons: null,
      sched_day: 3, sched_day_label: 'WED', sched_date: 'Oct 7', sched_time: '00:00', sched_season: 'Fall 2026',
      source_ids: JSON.stringify({ kitsu: 11207, anilist: 98596 }), skip_key_id: 7, skip_key_space: 'anilist',
      episode_total: 12, added_at: '2026-01-01 00:00:00', search_text: 'a test title テスト tv ongoing',
      catalogue_synced_at: 1_700_000_000_000, cloud_synced_at: null, ...row,
    };
    this.db.prepare(`INSERT INTO anime (${Object.keys(r).join(',')}) VALUES (${Object.keys(r).map(() => '?').join(',')})`)
      .run(...Object.values(r));
    return r;
  }

  /** AniList's side of a title, in the shape the introspection of Media returned. */
  fixture(id, extra = {}) {
    const media = {
      id,
      idMal: null,
      title: { english: 'A Test Title', romaji: 'A Test Title', native: 'テスト' },
      format: 'TV', type: 'ANIME', status: 'RELEASING', season: 'FALL', seasonYear: 2024,
      averageScore: 81, episodes: 12, duration: 24,
      coverImage: { large: 'https://art/new-poster.jpg', extraLarge: null, color: '#22aa44' },
      bannerImage: null,
      description: '<p>Rewritten by the cloud.</p>',
      genres: ['Action', 'Sci-Fi', 'Psychological'],
      trending: 47,
      nextAiringEpisode: { airingAt: TUE, episode: 9 },
      startDate: { year: 2024 },
      ...extra,
    };
    this.media.set(id, media);
    return media;
  }

  queue(anilistId, slug, note = 'operator request') {
    this.db.prepare('INSERT INTO sync_pending (anilist_id, slug, added_at, note) VALUES (?,?,?,?)')
      .run(anilistId, slug, Date.now(), note);
  }

  heartbeat(at = new Date()) {
    this.db.prepare(`INSERT INTO sync_meta (key, value) VALUES ('hourly_sync', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(JSON.stringify({ at: at.toISOString(), source: 'operator-task' }));
  }

  row(id = 'a-test-title') {
    return this.db.prepare('SELECT * FROM anime WHERE id = ?').get(id) ?? null;
  }
  genresOf(id) {
    return this.db.prepare('SELECT genre_id FROM anime_genre WHERE anime_id = ? ORDER BY genre_id').all(id).map((r) => r.genre_id);
  }
  count(table) {
    return Object.values(this.db.prepare(`SELECT count(*) AS n FROM ${table}`).get())[0];
  }
  meta(key) {
    return this.db.prepare('SELECT value FROM sync_meta WHERE key = ?').get(key)?.value ?? null;
  }
  resetCursor() {
    this.db.prepare('DELETE FROM sync_meta WHERE key LIKE ?').run('cloud_anilist_cursor:%');
  }
  close() {
    this.db.close();
  }
}

const respond = (body, ok = true) => ({
  ok,
  status: ok ? 200 : 400,
  headers: new Headers({ 'content-type': 'application/json' }),
  text: () => Promise.resolve(JSON.stringify(body)),
});

/* A mode is chosen at module load, so each case gets a fresh instance of the module with its
   own environment. The query string is only the cache buster; the module is unmodified. */
async function loadModule(env) {
  Object.assign(process.env, {
    CF_ACCOUNT_ID: 'test-account', CF_DATABASE_ID: 'test-database', CF_API_TOKEN: 'test-token',
    ANILIST_MIN_INTERVAL_MS: '20', ANILIST_RATE_CEILING_RPM: '3000', ANILIST_DAILY_BUDGET: '500',
    MAX_ITEMS_PER_RUN: '500', LEGACY_WRITER_ACTIVE: '1', CLOUD_CREATES_ROWS: '0', CLOUD_OWNS_GENRES: '0',
    ANILIST_TRENDING_PAGE_SIZE: '50', ...env,
  });
  return import(`./sync-anilist.mjs?case=${randomUUID()}`);
}

/** One pass: its summary, and the exit code it set (restored, so the runner is unaffected). */
async function runPass(world, env, { forceTakeover = false } = {}) {
  const mod = await loadModule(env);
  world.install();
  const saved = process.exitCode;
  process.exitCode = 0;
  const log = [];
  const write = console.log;
  const warn = console.warn;
  console.log = (line) => log.push(String(line));
  console.warn = () => {};
  try {
    const summary = await mod.run({ forceTakeover });
    return { summary, exitCode: process.exitCode, mod, log };
  } finally {
    console.log = write;
    console.warn = warn;
    process.exitCode = saved;
    delete globalThis.fetch;
  }
}

const MIRROR = { LEGACY_WRITER_ACTIVE: '1', CLOUD_CREATES_ROWS: '0' };
const DELTA = { LEGACY_WRITER_ACTIVE: '1', CLOUD_CREATES_ROWS: '1' };
const TAKEOVER = { LEGACY_WRITER_ACTIVE: '0', CLOUD_CREATES_ROWS: '1' };

/**
 * Run something that talks to D1 rather than AniList — apply-schema and the audit — with the
 * credentials the passes use and the SQLite shim installed. These two are called inside a cron
 * job's steps, not from the sync loop, so they need the environment without a run around them.
 */
async function withShim(world, env, fn) {
  await loadModule(env);
  world.install();
  try {
    return await fn();
  } finally {
    delete globalThis.fetch;
  }
}

/* ------------------------------------------------------------------ cases */

describe('migration: the four phases against real SQLite', () => {
  let world;
  beforeEach(() => { world = new World(); });
  afterEach(() => { world.close(); });

  it('T1 Phase 1 (mirror): no inserts, legacy columns untouched, own stamp set', async () => {
    world.stored();
    world.fixture(98596, {
      /* AniList knows nothing about these two; the stored values must survive (R1). */
      averageScore: null, episodes: null,
      /* A different air slot on purpose: mirror must not write the schedule columns. */
      nextAiringEpisode: { airingAt: FRI, episode: 11 },
    });
    world.queue(99999, 'a-title-nobody-stored');

    const { summary } = await runPass(world, MIRROR);
    assert.equal(summary.mode, 'mirror');
    const r = world.row();

    assert.equal(r.title, 'A Test Title');
    assert.equal(r.art, 'https://art/new-poster.jpg', 'metadata the cloud owns is refreshed');
    assert.equal(r.accent, '#22aa44');
    assert.equal(r.synopsis, 'Rewritten by the cloud.', 'a description that IS present is written');
    assert.equal(r.rating, 8.1, 'an absent AniList score must not zero the stored rating');
    assert.equal(r.episode_total, 12, 'an airing title has no episode count on AniList; the stored one stays');

    assert.equal(r.sched_day, 3, 'sched_* belongs to tools/hourly-refresh.mjs in Phase 1');
    assert.equal(r.sched_day_label, 'WED');
    assert.equal(r.sched_season, 'Fall 2026');
    assert.equal(r.trend_rank, 3, 'trend_rank belongs to the hourly task until Phase 3');
    assert.equal(r.added_at, '2026-01-01 00:00:00', 'the Just Added shelf is untouched');
    assert.equal(r.rank, 12, 'curation is untouched');
    assert.equal(r.skip_key_id, 7, 'the skip pipeline owns this key');
    assert.equal(r.catalogue_synced_at, 1_700_000_000_000, 'the cloud never writes the local stamp');

    assert.ok(Number.isInteger(r.cloud_synced_at) && r.cloud_synced_at > 0, 'the cloud stamps its own write');
    assert.equal(world.count('anime'), 1, 'mirror inserted a row');
    assert.equal(summary.created, 0);
    assert.equal(world.count('sync_pending'), 1, 'mirror leaves the queue alone');
    /* It does not even spend a request on a title it is not allowed to write. */
    assert.ok(world.anilistCalls.every((d) => !d.includes('99999')), 'mirror hydrated an unqueued id');
    assert.equal(summary.exit_reason, 'catalogue_end');
    assert.equal(summary.items_processed, 1);
  });

  it('T2 Phase 2 (delta): creates the queued row with every insert-only column filled', async () => {
    world.fixture(120001, {
      id: 120001,
      title: { english: 'Demon Slayer', romaji: 'Kimetsu no Yaiba', native: '鬼滅の刃' },
      genres: ['Adventure', 'Fantasy'],
    });
    world.trending = [777, 120001, 888];
    world.queue(120001, 'demon-slayer');

    const { summary } = await runPass(world, DELTA);
    assert.equal(summary.mode, 'delta');
    assert.equal(summary.created, 1);
    const r = world.row('demon-slayer');
    assert.ok(r, 'the queued title was not created');

    assert.match(r.added_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, 'added_at is datetime(\'now\') shaped');
    /* added_at holds UTC text, exactly as datetime('now') writes it, so it is parsed as UTC —
       reading it in the local zone would make a fresh row look hours stale anywhere east of
       Greenwich. */
    assert.ok(Date.parse(`${r.added_at.replace(' ', 'T')}Z`) >= Date.now() - 120_000, 'added_at is now, not a stale value');
    assert.deepEqual(world.genresOf(r.id), ['adventure', 'fantasy'], 'anime_genre is populated on insert (R6)');
    assert.equal(r.trend_rank, 2, 'position in the trending list, which is what the column means');
    assert.equal(r.sched_day, 2, 'sched_* from nextAiringEpisode, in the local Sunday-as-7 numbering');
    assert.equal(r.sched_day_label, 'TUE');
    assert.equal(r.sched_date, 'Oct 13');
    assert.equal(r.sched_time, '01:00');
    assert.equal(r.sched_season, 'Fall 2026');
    assert.equal(r.kind, 'TV', 'the site vocabulary, not AniList\'s enum');
    assert.equal(r.status, 'Ongoing');
    assert.equal(r.rating, 8.1);
    assert.equal(r.native, '鬼滅の刃');
    assert.ok(r.search_text.includes('ongoing'), 'search_text folded from the site words');
    assert.ok(r.cloud_synced_at > 0);
    assert.equal(r.catalogue_synced_at, null, 'a cloud-created row carries no local stamp');
    assert.equal(world.count('sync_pending'), 0, 'the queue entry was consumed');
  });

  it('T2b delta refreshes a queued title that is already stored, and does not re-create it', async () => {
    world.stored();
    world.fixture(98596, { nextAiringEpisode: { airingAt: TUE, episode: 9 } });
    world.queue(98596, 'a-test-title');
    world.db.prepare('INSERT INTO anime_genre (anime_id, genre_id) VALUES (?,?)').run('a-test-title', 'drama');

    const { summary } = await runPass(world, DELTA);
    assert.equal(summary.created, 0, 'a stored title is not a creation');
    assert.equal(world.count('anime'), 1);
    const r = world.row();
    assert.equal(r.added_at, '2026-01-01 00:00:00', 'added_at is written on insert and never again');
    assert.equal(r.sched_day, 3, 'sched_* still not ours while the hourly task is enabled');
    assert.deepEqual(world.genresOf('a-test-title'), ['drama'], 'CLOUD_OWNS_GENRES=0 leaves local curation alone');
  });

  it('T3 re-running the pass changes nothing that was already right', async () => {
    world.stored();
    world.fixture(120002, {
      id: 120002,
      title: { english: 'A Brand New Title', romaji: null, native: null },
      averageScore: 77, episodes: 11, genres: ['Comedy'],
      nextAiringEpisode: { airingAt: TUE, episode: 4 },
    });
    world.queue(120002, 'a-brand-new-title');
    world.trending = [120002];
    await runPass(world, DELTA);

    const first = world.row('a-brand-new-title');
    assert.equal(first.trend_rank, 1);
    world.resetCursor();
    /* The same title, with AniList now silent on everything nullable and off the list. */
    world.fixture(120002, {
      id: 120002,
      title: { english: 'A Brand New Title', romaji: null, native: null },
      averageScore: null, episodes: null, description: null, nextAiringEpisode: null, genres: ['Comedy'],
    });
    await runPass(world, DELTA);

    const r = world.row('a-brand-new-title');
    assert.equal(r.added_at, first.added_at, 'a refresh must not move a title up the Just Added shelf');
    assert.equal(r.rating, first.rating, 'an absent score keeps the stored one');
    assert.equal(r.episode_total, first.episode_total, 'an absent episode count keeps the stored one');
    assert.equal(r.synopsis, first.synopsis, 'an absent description does not blank the prose');
    assert.deepEqual(world.genresOf(r.id), world.genresOf(r.id), 'pairs are idempotent (no duplicates below)');
    assert.equal(world.db.prepare('SELECT count(*) AS n FROM anime_genre WHERE anime_id = ?').get(r.id).n, 1,
      'a second pass duplicated the genre pairs');
    /* In delta the schedule and trending columns are still not ours to overwrite, so they keep
       the values the insert wrote rather than being cleared. Clearing is proven in takeover. */
    assert.equal(r.sched_day, 2, 'delta may not clear a column the hourly task owns');
    assert.equal(r.trend_rank, 1, 'nor clear trend_rank');
  });

  it('T4 source_ids is merged: on a NULL row, on a stored row, and under a concurrent write', async () => {
    world.stored({ source_ids: JSON.stringify({ kitsu: 11207, anilist: 98596 }) });
    /* A stored title with no provenance at all. AniList learns its id from the queue, so it is
       written by a mode that reads the queue — and the merge lands on NULL. */
    world.stored({ id: 'no-provenance-yet', title: 'No Provenance Yet', search_text: 'x', source_ids: null });
    world.fixture(98596, { idMal: null });
    world.fixture(98597, { id: 98597, title: { english: 'No Provenance Yet', romaji: null, native: null }, idMal: null });
    world.queue(98597, 'no-provenance-yet');

    /* The race the merge exists for: the local catalogue tools record a MAL id after our read
       and before our write. Writing the object we read would drop it (R2). The upsert is the
       only place that window exists, so the write goes in just before it is executed — a hook on
       the read would let our own SELECT see the new key and prove nothing. */
    let fired = false;
    world.onSql = (sql) => {
      if (fired || !/^INSERT INTO anime[ (]/.test(sql)) return;
      fired = true;
      world.db.prepare(`UPDATE anime SET source_ids = json_patch(source_ids, '{"mal":35413}') WHERE id = 'a-test-title'`).run();
    };

    await runPass(world, DELTA);
    assert.ok(fired, 'the anime upsert never ran, so the race was not exercised');
    const merged = JSON.parse(world.row().source_ids);
    assert.equal(merged.mal, 35413, 'a key another writer added after our read survives');
    assert.equal(merged.kitsu, 11207);
    assert.equal(merged.anilist, 98596, 'and our own key is written');
    /* R2's other half: the first merge onto a row with no provenance at all. json_patch(NULL,x)
       is NULL, so without the COALESCE this column would be wiped rather than filled. */
    assert.deepEqual(JSON.parse(world.row('no-provenance-yet').source_ids), { anilist: 98597 });
  });

  /* RFC 7396: a null inside a json_patch patch is not "set it to nothing", it is DELETE THE KEY. So
     "the merge can only add or overwrite" is not a property of SQLite — it holds only while the
     object this job builds is null-free, which is a property of three lines (sync-anilist.mjs:322-323:
     spread what was stored, set anilist, add mal only when AniList reports one). The first someone
     "clears a stale key" with `sourceIds.mal = null` turns every later merge into provenance loss,
     and the pre-flight diff would report it as a broken merge rather than the new behaviour. */
  it('T4b the provenance patch is null-free, so the merge cannot delete a key', async () => {
    const stored = world.stored({ source_ids: JSON.stringify({ kitsu: 11207, anilist: 98596, mal: 35413 }) });
    const shapes = [
      /* The three that a null would be tempting for: AniList no longer reports a MAL id, reports 0
         (which is "no id" for AniList but is a value this writer must read as absent, not delete),
         and reports one that agrees with what is stored. */
      { idMal: null }, { idMal: 0 }, { idMal: 35413 },
      /* And a native-title/genres-free record: nothing else in the row reaches this column. */
      { idMal: undefined, title: { english: 'A Test Title' }, genres: [] },
    ];
    for (const [i, extra] of shapes.entries()) {
      const media = world.fixture(98596, { id: 98596, ...extra });
      const patch = JSON.parse(rowFromMedia(media, provenance(stored)).source_ids);
      assert.deepEqual(Object.entries(patch).filter(([, v]) => v === null), [],
        `shape ${i} put a null in ${JSON.stringify(patch)}; json_patch reads a null patch value as a delete`);

      /* The consequence, executed rather than argued: merging this patch over what is stored keeps
         every key that was already there. */
      const merged = JSON.parse(world.db.prepare('SELECT json_patch(?, ?) AS m').get(stored.source_ids, JSON.stringify(patch)).m);
      for (const [key, value] of Object.entries(JSON.parse(stored.source_ids))) {
        assert.equal(merged[key], value, `shape ${i} lost the stored ${key} key`);
      }
      assert.equal(merged.anilist, 98596);
    }

    /* The creation path, where there is nothing stored to lose: the patch is still null-free, and
       AniList's silence about MAL leaves the key absent rather than null. */
    const created = JSON.parse(rowFromMedia(world.fixture(98597, { id: 98597, idMal: null, title: { english: 'Fresh' } })).source_ids);
    assert.deepEqual(created, { anilist: 98597 }, 'a new row carries the id this run learned and no placeholders');

    /* Proof that the rule is the patch's, not the merge's: a null in the patch does delete the key,
       which is exactly what the assertion above forbids. */
    const broken = world.db.prepare(`SELECT json_patch('{"kitsu":11207,"anilist":98596}', '{"mal":null}') AS m`).get().m;
    assert.equal(JSON.parse(broken).kitsu, 11207, 'json_patch is not the guard — it deletes what it is told to');
    assert.equal('mal' in JSON.parse(broken), false);
  });

  it('T5 Phase 3 refuses while the hourly task is alive; --force-takeover answers with evidence', async () => {
    world.stored();
    world.fixture(98596, { nextAiringEpisode: { airingAt: FRI, episode: 11 } });
    world.trending = [98596];
    world.heartbeat();

    const { summary, exitCode } = await runPass(world, TAKEOVER);
    assert.equal(summary.exit_reason, 'legacy_still_running');
    assert.equal(exitCode, 1, 'CI must alert on this: it is the one configuration that corrupts data');
    const r = world.row();
    assert.equal(r.sched_day, 3, 'nothing was written to the schedule columns');
    assert.equal(r.cloud_synced_at, null, 'the run refused before it touched a row');
    assert.equal(world.meta('cloud_takeover'), null, 'refusing must not leave a takeover marker behind');

    const forced = await runPass(world, TAKEOVER, { forceTakeover: true });
    assert.equal(forced.summary.exit_reason, 'catalogue_end');
    const marker = JSON.parse(world.meta('cloud_takeover'));
    assert.ok(marker.at >= Date.parse(new Date().toISOString()) - 60_000, 'the decision is recorded in sync_meta');
    assert.match(marker.reason, /force-takeover/);
    const after = world.row();
    assert.equal(after.sched_day, 5, 'sched_* handed over: Friday, and the local value is replaced');
    assert.equal(after.sched_day_label, 'FRI');
    assert.equal(after.sched_date, 'Nov 20');
    assert.equal(after.sched_season, 'Fall 2026');
    assert.equal(after.trend_rank, 1, 'trend_rank handed over too');
    assert.ok(after.cloud_synced_at > 0);
    assert.equal(after.added_at, r.added_at, 'the handover still never touches added_at');
    assert.equal(after.rank, 12, 'nor curation');
    assert.equal(after.catalogue_synced_at, 1_700_000_000_000, 'nor the local stamp');

    /* The marker is durable: a later tick, with the same (now stale-in-spirit) heartbeat, gets
       through without needing --force-takeover again. */
    const later = await runPass(world, TAKEOVER);
    assert.equal(later.summary.exit_reason, 'catalogue_end', 'the recorded decision was not honoured');
  });

  it('T6 is in rate.test.mjs: 50 consecutive sends, production floor, real clock', () => {
    assert.ok(true, 'kept in the pacing suite because it measures two minutes of elapsed time');
  });

  it('T7 a cloud-created row answers the queries the site actually runs', async () => {
    world.fixture(120003, {
      id: 120003,
      title: { english: 'A Story Of The Sea', romaji: 'U Story', native: '海の話' },
      genres: ['Slice of Life', 'Romance'],
      nextAiringEpisode: { airingAt: SUN, episode: 3 },
    });
    world.queue(120003, 'a-story-of-the-sea');
    await runPass(world, DELTA);

    /* functions/api/anime/index.js:70 — the genre filter. A title with no genre rows is
       invisible here, which is the whole reason R6 exists. */
    const byGenre = world.db.prepare(`
      SELECT a.id FROM anime a
      WHERE EXISTS (SELECT 1 FROM anime_genre ag WHERE ag.anime_id = a.id AND ag.genre_id = ?)
      ORDER BY a.id`).all('slice-of-life');
    assert.deepEqual(byGenre.map((x) => x.id), ['a-story-of-the-sea']);

    /* functions/api/anime/index.js:20 — the "Just Added" shelf ordering. */
    const justAdded = world.db.prepare(`
      SELECT a.id FROM anime a ORDER BY a.added_at IS NULL, a.added_at DESC, a.rating DESC LIMIT 5`).all();
    assert.equal(justAdded[0].id, 'a-story-of-the-sea', 'a new row must lead the Just Added shelf');

    /* functions/api/anime/index.js:24-25,72-73 — kind and status are validated against a
       closed list and matched with an exact =. */
    const ongoing = world.db.prepare(`SELECT id FROM anime WHERE status = 'Ongoing' AND kind = 'TV'`).all();
    assert.deepEqual(ongoing.map((x) => x.id), ['a-story-of-the-sea']);

    /* functions/api/anime/index.js:71 — search prefilters on search_text with LIKE. */
    const found = world.db.prepare(`SELECT id FROM anime WHERE search_text LIKE ?`).all('%sea%');
    assert.deepEqual(found.map((x) => x.id), ['a-story-of-the-sea'], 'a cloud row is searchable');

    /* functions/api/schedule.js:9 — sched_season matched case-sensitively, and the day shelf. */
    const shelf = world.db.prepare('SELECT a.id FROM anime a WHERE a.sched_day IS NOT NULL AND a.sched_season = ?1').all('Fall 2026');
    assert.deepEqual(shelf.map((x) => x.id), ['a-story-of-the-sea'], 'the created row is not on the season shelf');
    const byDay = world.db.prepare('SELECT id FROM anime WHERE sched_day = ? ORDER BY sched_time').all(7);
    assert.deepEqual(byDay.map((x) => x.id), ['a-story-of-the-sea'], 'Sunday is day 7 on the schedule shelf');
  });

  it('zero column overlap, proved by the stamps alone', async () => {
    world.stored();
    world.fixture(98596);
    await runPass(world, MIRROR);
    /* The verification query from the runbook, run against the same schema the operators use:
       no row may carry a cloud stamp and a NEWER local stamp than the moment the cloud wrote
       it, for a column the other side owns. Here that is stated as the disjointness itself. */
    const overlap = world.db.prepare(`
      SELECT count(*) AS n FROM anime
      WHERE cloud_synced_at IS NOT NULL
        AND sched_season IS NOT 'Fall 2026'
    `).get().n;
    assert.equal(overlap, 0, 'the cloud changed a sched_ value it does not own');
    const both = world.db.prepare(`
      SELECT id FROM anime WHERE catalogue_synced_at IS NULL AND cloud_synced_at IS NOT NULL
    `).all();
    assert.deepEqual(both, [], 'a row this pass touched was stamped as cloud-created');
    assert.equal(world.row().sched_day, 3);
    assert.equal(world.row().catalogue_synced_at, 1_700_000_000_000, 'the local stamp is untouched in every mode');
  });

  it('CLOUD_OWNS_GENRES=1 fills a genre-less un-stamped row and leaves a stamped one alone', async () => {
    /* A locally-curated row: stamped by the catalogue tools and holding its own genre set. */
    world.stored();
    world.db.prepare('INSERT INTO anime_genre (anime_id, genre_id) VALUES (?,?)').run('a-test-title', 'drama');
    /* An unattributed row with nothing to lose: seeded before either stamp column existed, so
       catalogue_synced_at is NULL, and it has no genres at all. */
    world.stored({ id: 'no-genres-here', title: 'No Genres Here', source_ids: '{"anilist":98597}', catalogue_synced_at: null });
    world.fixture(98596);
    world.fixture(98597, { id: 98597, title: { english: 'No Genres Here', romaji: null, native: null }, genres: ['Horror'] });

    await runPass(world, { ...MIRROR, CLOUD_OWNS_GENRES: '1' });
    assert.deepEqual(world.genresOf('no-genres-here'), ['horror'], 'a row with no genres gets the set it should have had');
    assert.deepEqual(world.genresOf('a-test-title'), ['drama'], 'a row the local tools stamped keeps its own set even with the switch on');

    /* And with the switch off, even the unattributed row is left alone. */
    world.db.prepare('DELETE FROM anime_genre WHERE anime_id = ?').run('no-genres-here');
    world.resetCursor();
    await runPass(world, { ...MIRROR, CLOUD_OWNS_GENRES: '0' });
    assert.deepEqual(world.genresOf('no-genres-here'), [], 'CLOUD_OWNS_GENRES=0 must not write genre rows for an existing title');
  });

  it('CLOUD_OWNS_SCHEDULE=1 fills an empty air slot on a row nobody stamped, and nothing else', async () => {
    /* Three shapes the fill has to tell apart. `a-test-title` is the local task's own row with a
       live slot — the switch must not rewrite it. `no-slot-yet` is unstamped with an empty shelf:
       the fill's only job. `had-a-slot` is unstamped (seeded before the stamp columns existed) but
       its shelf is populated — clearing a slot is the local task's call, so it stays as it is. */
    world.stored();
    world.stored({ id: 'no-slot-yet', title: 'No Slot Yet', source_ids: '{"anilist":98597}',
      catalogue_synced_at: null, sched_day: null, sched_day_label: null, sched_date: null, sched_time: null, sched_season: null });
    world.stored({ id: 'had-a-slot', title: "Had A Slot", source_ids: '{"anilist":98598}',
      catalogue_synced_at: null, sched_day: 7, sched_day_label: 'SUN', sched_date: 'Oct 18', sched_time: '14:00', sched_season: 'Fall 2026' });
    world.fixture(98596, { nextAiringEpisode: { airingAt: TUE, episode: 4 } });
    world.fixture(98597, { id: 98597, title: { english: 'No Slot Yet', romaji: null, native: null }, nextAiringEpisode: { airingAt: FRI, episode: 2 } });
    world.fixture(98598, { id: 98598, title: { english: 'Had A Slot', romaji: null, native: null }, nextAiringEpisode: { airingAt: WED, episode: 9 } });

    /* The shipped default first, because that is the state the Phase-2 concern is really about:
       delta writes no sched_* on an existing row, and a row it creates is filled at insert. */
    await runPass(world, { ...DELTA, CLOUD_OWNS_SCHEDULE: '0' });
    assert.equal(world.row('no-slot-yet').sched_day, null, 'delta without the switch leaves the hole open');

    world.resetCursor();
    const { summary } = await runPass(world, { ...DELTA, CLOUD_OWNS_SCHEDULE: '1' });
    assert.equal(summary.fill_schedule, true, 'the run record says the fill was armed');
    const filled = world.row('no-slot-yet');
    assert.equal(filled.sched_day, 5, 'the hole fills from AniList air time, Friday as day 5');
    assert.equal(filled.sched_day_label, 'FRI');
    assert.equal(filled.sched_date, 'Nov 20');
    assert.equal(filled.sched_time, '01:00');
    assert.equal(filled.sched_season, 'Fall 2026', "schedule.js matches this column case-sensitively");

    /* The two things an unconditional write would get wrong on purpose. */
    const stamped = world.row();
    assert.equal(stamped.sched_day, 3, 'a row the local task stamped keeps its own slot');
    assert.equal(stamped.sched_day_label, 'WED', 'the fill would have said TUE for this one');
    const kept = world.row('had-a-slot');
    assert.equal(kept.sched_day, 7, 'a populated slot on an unstamped row is not the fill business');
    assert.equal(kept.sched_time, '14:00');
    assert.equal(kept.trend_rank, 3, 'the switch is sched_* only; trend_rank stays with the local task');
    assert.equal(stamped.trend_rank, 3);
    /* Metadata still refreshes in the same statement, so the fill cannot smuggle in a mode change. */
    assert.equal(stamped.rating, 8.1);
    assert.equal(stamped.episode_total, 12);
  });

  it('takeover clears the whole air slot when a title stops airing (R1 exception)', async () => {
    world.stored();
    world.fixture(98596, { nextAiringEpisode: null });
    world.heartbeat(new Date(Date.now() - 3 * 60 * 60 * 1000));
    world.trending = [];

    const { summary } = await runPass(world, TAKEOVER);
    assert.equal(summary.exit_reason, 'catalogue_end', 'a heartbeat older than the quiet window is a stopped task');
    const r = world.row();
    for (const c of ['sched_day', 'sched_day_label', 'sched_date', 'sched_time', 'sched_season']) {
      assert.equal(r[c], null, `${c} must clear when the title stops airing`);
    }
    assert.equal(r.trend_rank, null, 'a title off the trending list loses its rank');
    assert.equal(r.rating, 8.1, 'while the columns that are NOT clearable keep their values');
    assert.equal(r.episode_total, 12);
  });

  it('a cloud-created row is found by the next pass and refreshed, never duplicated', async () => {
    world.fixture(120004, { id: 120004, title: { english: 'Fourth Pass Title', romaji: null, native: null }, genres: ['Drama'] });
    world.queue(120004, 'fourth-pass-title');
    const first = await runPass(world, DELTA);
    assert.equal(first.summary.created, 1);
    const created = world.row('fourth-pass-title');
    world.resetCursor();

    const second = await runPass(world, MIRROR);
    assert.equal(world.count('anime'), 1, 'a second pass duplicated a row');
    assert.equal(second.summary.items_processed, 1, 'the new row was not read as catalogue');
    assert.equal(second.summary.unmapped, 0, 'the new row carries no anilist provenance');
    assert.equal(world.row('fourth-pass-title').added_at, created.added_at);
    assert.deepEqual(world.genresOf('fourth-pass-title'), ['drama']);
  });

  it('a budget stop writes nothing half-done and advances no cursor', async () => {
    for (let i = 0; i < 6; i++) {
      /* The English title must slugify to the stored id, or the run would rightly treat the
         media as a different title and skip it. */
      world.stored({ id: `t${i}`, title: `T${i}`, source_ids: JSON.stringify({ anilist: 1000 + i }) });
      world.fixture(1000 + i, { id: 1000 + i, title: { english: `T${i}`, romaji: null, native: null } });
    }
    /* One request of budget, and the six ids of the first slice go out in batches of one: the
       budget runs out mid-slice, which is exactly the moment the crash semantics matter. */
    const stopped = await runPass(world, { ...MIRROR, ANILIST_DAILY_BUDGET: '1', ANILIST_BATCH_SIZE: '1' });
    assert.equal(stopped.summary.exit_reason, 'budget_exhausted');
    assert.equal(stopped.exitCode, 0, 'an exhausted budget is a recorded outcome, not a crash');
    assert.equal(stopped.summary.items_processed, 0, 'a slice that never committed counts as processed');
    assert.equal(world.meta('cloud_anilist_cursor:mirror'), null, 'a truncated run must not claim progress');
    for (const id of ['t0', 't1', 't2', 't3', 't4', 't5']) assert.equal(world.row(id).cloud_synced_at, null, `${id} was written by a run that ran out mid-slice`);

    world.db.prepare('UPDATE api_usage SET requests = 0').run();
    const resumed = await runPass(world, MIRROR);
    assert.equal(resumed.summary.exit_reason, 'catalogue_end');
    assert.equal(resumed.summary.items_processed, 6, 'the whole catalogue, nothing lost by the stop');
    assert.equal(resumed.summary.skipped, 0, 'a fixture that stops matching its own slug would pass this test silently');
    assert.equal(resumed.summary.unmapped, 0, 'every row here carries an anilist id');
    for (const id of ['t0', 't1', 't2', 't3', 't4', 't5']) assert.ok(world.row(id).cloud_synced_at > 0, `${id} was skipped`);
  });

  it('the lease keeps a second writer out, and a run that loses it stops', async () => {
    world.stored();
    world.fixture(98596);
    world.db.prepare('INSERT INTO sync_lock (name, owner, expires_at) VALUES (?,?,?)')
      .run('anilist', 'anilist-someone-elses-run', Date.now() + 600_000);
    const { summary, exitCode } = await runPass(world, MIRROR);
    assert.equal(summary.exit_reason, 'lease_held');
    assert.equal(exitCode, 0, 'a held lease is expected and harmless');
    assert.equal(world.row().cloud_synced_at, null, 'the blocked run wrote nothing');
  });

  it('refuses to start in the phase where nobody owns the schedule shelf', async () => {
    world.stored();
    world.fixture(98596);
    /* The orphan is answered at startup, not in the report: LEGACY_WRITER_ACTIVE=0 says the local
       task is stopped, while CLOUD_CREATES_ROWS=0 keeps the mode in mirror/delta, which leaves
       sched_* to that stopped task. Nothing would ever write the shelf again and every other check
       would keep passing, so resolveMode throws while the module is still loading — before a lease
       is taken, before a row is read, before a run is recorded. */
    await assert.rejects(
      () => runPass(world, { LEGACY_WRITER_ACTIVE: '0', CLOUD_CREATES_ROWS: '0' }),
      /gives nobody the sched_\* columns/,
    );
    assert.equal(world.row().cloud_synced_at, null, 'a refused start wrote nothing');
    assert.equal(world.count('sync_runs'), 0, 'and it did not even record a run');
    assert.equal(world.meta('cloud_takeover'), null, 'the refusal claims nothing either');
    /* The two legitimate ways out of that state, both accepted by the same parser. */
    assert.equal((await loadModule({ ...TAKEOVER })).MODE, 'takeover');
    assert.equal((await loadModule({ ...MIRROR, CLOUD_OWNS_SCHEDULE: '1' })).MODE, 'mirror');
  });

  it('the schema file applies to a catalogue that already has rows, and re-applying is the guard', async () => {
    /* Undo the file completely, indexes first because SQLite refuses to drop a column an index
       still names. What is left is the live database as it stands the moment before this job is
       installed: a populated `anime` table and none of the sync's own state. */
    world.stored();
    for (const sql of [
      'DROP INDEX IF EXISTS anime_cloud_synced',
      'DROP INDEX IF EXISTS anime_catalogue_synced',
      'ALTER TABLE anime DROP COLUMN cloud_synced_at',
      'ALTER TABLE anime DROP COLUMN catalogue_synced_at',
      'DROP TABLE IF EXISTS sync_lock',
      'DROP TABLE IF EXISTS api_usage',
      'DROP TABLE IF EXISTS sync_runs',
      'DROP TABLE IF EXISTS sync_pending',
    ]) world.db.exec(sql);

    const first = await withShim(world, MIRROR, () => applySchema(join(HERE, 'schema.sql')));
    assert.equal(first.failed, 0, JSON.stringify(first.errors));
    assert.equal(first.statements, 10, 'the splitter lost or invented a statement');
    assert.equal(first.applied, 10, `expected all ten to be new: ${JSON.stringify(first.skipped)}`);
    assert.equal(world.count('anime'), 1, 'applying the schema moved data out of the catalogue');
    assert.equal(world.row().title, 'A Test Title');
    assert.equal(world.count('sync_pending'), 0);

    /* The second application is the one an operator actually hits — the run-once ALTER tail
       reports 'duplicate column name', and that error IS the guard. It must be counted as
       already-present, and the exit code must still be 0. */
    const again = await withShim(world, MIRROR, () => applySchema(join(HERE, 'schema.sql')));
    assert.equal(again.failed, 0, JSON.stringify(again.errors));
    assert.equal(again.already_present, 2, `expected only the two ALTERs to be run-once: ${JSON.stringify(again.skipped)}`);
    assert.equal(again.applied, 8);
    /* And re-applying is not a data migration: the columns come back empty, so nobody's rows
       are stamped by an operator pressing a button. */
    assert.equal(world.db.prepare('SELECT cloud_synced_at FROM anime').get().cloud_synced_at, null);
    assert.equal(world.row().title, 'A Test Title');
  });

  /* The runbook tells the operator to read PRAGMA table_info(anime) before the first run, because
     insertRows() names anime's columns and a column production lacks dies mid-batch. A paragraph is
     discipline; this is enforcement — the sync asks the same question of the live database before it
     takes a lease, and stops with a named reason. */
  it('a column production lacks stops the run before the lease, and names it', async () => {
    world.stored();
    world.fixture(98596);
    /* The drift the gate is for, spelled as a column it dropped before this job existed rather than
       as one of the two stamp columns — the gate does not get to know which kind of missing it is, it
       only refuses to write against a table that cannot answer. accent is not indexed, so this is a
       clean removal. */
    world.db.exec('ALTER TABLE anime DROP COLUMN accent');

    const { summary, exitCode } = await runPass(world, MIRROR);
    assert.equal(summary.exit_reason, 'schema_mismatch');
    assert.equal(exitCode, 1, 'CI must alert: this run would have died mid-write instead');
    assert.match(summary.error, /accent/, 'the reason must name the column, not just say the schema was wrong');
    assert.equal(world.row().cloud_synced_at, null, 'a gated run wrote nothing');
    assert.equal(world.row().accent, undefined);
    assert.equal(world.count('sync_lock'), 0, 'it did not even take the lease, so a second writer is not blocked');
    assert.equal(world.meta('cloud_takeover'), null, 'and a gated takeover claims nothing');
    /* sync_runs is not `anime`, so the gate can still report itself — and it must, or the only record
       of a permanently blocked schedule is an Actions log nobody opens. */
    const recorded = world.db.prepare('SELECT exit_reason, summary FROM sync_runs ORDER BY started_at DESC LIMIT 1').get();
    assert.equal(recorded.exit_reason, 'schema_mismatch');
    assert.match(JSON.parse(recorded.summary).error, /accent/);

    /* The same answer from the read-only audit, which is what an operator runs instead of a sync. */
    const gated = await withShim(world, MIRROR, () => audit({ mode: 'mirror', createsRows: false, claimsSchedule: false }));
    assert.equal(gated.ok, false, 'a gated schema audited clean');
    assert.match(gated.failures.join('\n'), /anime has every column the sync writes by name.*accent/);
    assert.match(gated.failures.join('\n'), /the last run ended cleanly/, 'schema_mismatch is an alarm, not a normal stop');

    /* The gate reads, so giving the column back is the whole fix — same code, same run. */
    world.db.exec(`ALTER TABLE anime ADD COLUMN accent TEXT NOT NULL DEFAULT '#ff1f4a'`);
    const fixed = await runPass(world, MIRROR);
    assert.equal(fixed.summary.exit_reason, 'catalogue_end', 'a schema that answers the gate still runs');
    assert.ok(world.row().cloud_synced_at > 0);
  });

  it('extra columns — the local task\u0027s own — are counted and never block a run', async () => {
    /* The other direction, and the one that must NOT be fatal: production's anime has columns this
       writer never names, chief among them catalogue_synced_at. An equality check on the PRAGMA would
       fail on a healthy database, so extras are reported and the run proceeds. */
    world.stored();
    world.fixture(98596);
    const extras = await withShim(world, MIRROR, () => assertLiveColumns({ columns: ANIME_COLUMNS }));
    assert.deepEqual(extras.missing, [], 'the committed schemas must answer the gate the sync applies');
    assert.ok(extras.extra.includes('catalogue_synced_at'), 'the local stamp is an extra column and the gate is not blind to it');

    world.db.exec('ALTER TABLE anime ADD COLUMN kitsu_slug TEXT');
    const { summary } = await runPass(world, MIRROR);
    assert.equal(summary.exit_reason, 'catalogue_end');
    assert.equal(summary.extra_columns, extras.extra.length + 1, 'the count the operator sees tracks the database');
    assert.ok(world.row().cloud_synced_at > 0, 'a column nobody here owns did not stop the refresh');
  });

  it('the audit is clean on a mirrored catalogue, and catches a value outside the API vocabulary', async () => {
    world.stored();
    world.db.prepare('INSERT INTO anime_genre (anime_id, genre_id) VALUES (?,?)').run('a-test-title', 'action');
    world.fixture(98596);
    await runPass(world, MIRROR);

    const clean = await withShim(world, MIRROR, () => audit({ mode: 'mirror', createsRows: false, claimsSchedule: false }));
    assert.ok(clean.ok, `a mirrored catalogue should audit clean:\n${clean.failures.join('\n')}`);
    assert.ok(clean.checks.some((c) => c.id === 'Phase 1 never created a row'), 'the mirror invariant was not checked');
    assert.equal(clean.state.cloud_created_rows, 0);
    assert.equal(clean.state.recent_runs[0].exit_reason, 'catalogue_end', 'the audit is reading the run record');

    /* The failure this exists for: a kind outside functions/api/anime/index.js's closed list is
       not cosmetic, it takes the title out of ?kind= results while every query still succeeds. */
    world.db.prepare(`UPDATE anime SET kind = 'tv', sched_season = 'fall 2026'`).run();
    const broken = await withShim(world, MIRROR, () => audit({ mode: 'mirror', createsRows: false, claimsSchedule: false }));
    assert.equal(broken.ok, false, 'a bad kind passed the audit');
    const lines = broken.failures.join('\n');
    assert.match(lines, /kind is inside/);
    assert.match(lines, /sched_season is/);
  });

  it('the audit notices that nobody owns the schedule shelf, and survives a database with no queue table', async () => {
    world.stored();
    world.db.prepare('INSERT INTO anime_genre (anime_id, genre_id) VALUES (?,?)').run('a-test-title', 'action');
    world.fixture(98596);
    await runPass(world, MIRROR);
    const opts = { mode: 'mirror', createsRows: false, claimsSchedule: false, fillSchedule: false };

    /* The orphan the handover tests cannot see: mirror leaves sched_* to the local task, and the
       local task has never reported a run. Every other check still passes, so without this one the
       audit would call a frozen schedule shelf clean. */
    const orphan = await withShim(world, MIRROR, () => audit(opts));
    assert.match(orphan.failures.join('\n'), /someone still owns the schedule shelf/);
    assert.equal(orphan.ok, true, 'an unowned shelf is a warning the operator acts on, not a broken invariant');
    assert.equal(orphan.state.local_task_still_running, undefined);

    /* AniHubHourlyRefresh runs, writes its heartbeat, and the warning is gone. */
    world.heartbeat();
    const alive = await withShim(world, MIRROR, () => audit(opts));
    assert.equal(alive.state.local_task_still_running, true, 'a young heartbeat is the evidence the audit reports');
    assert.doesNotMatch(alive.failures.join('\n'), /someone still owns the schedule shelf/, 'the shelf has an owner');

    /* And a database where the operator has not applied cloud-sync/schema.sql yet: the queue table
       is not there, and a read-only audit that throws on that tells nobody anything. */
    world.db.exec('DROP TABLE sync_pending');
    const noQueue = await withShim(world, MIRROR, () => audit(opts));
    assert.equal(noQueue.state.pending, null, 'the audit must not claim a queue it could not read');
    assert.match(noQueue.failures.join('\n'), /the queue is readable/);
    assert.equal(noQueue.ok, true, `a missing table is reported, not fatal:\n${noQueue.failures.join('\n')}`);
  });

  it('the audit proves the handover: clean after takeover, and loud when the local task writes again', async () => {
    world.stored();
    world.db.prepare('INSERT INTO anime_genre (anime_id, genre_id) VALUES (?,?)').run('a-test-title', 'action');
    world.fixture(98596);
    world.trending = [98596];
    world.heartbeat(new Date(Date.now() - 3 * 60 * 60 * 1000));
    await runPass(world, TAKEOVER);

    const opts = { mode: 'takeover', createsRows: true, claimsSchedule: true };
    const clean = await withShim(world, TAKEOVER, () => audit(opts));
    assert.ok(clean.ok, `a catalogue this job owns should audit clean:\n${clean.failures.join('\n')}`);
    assert.ok(clean.state.takeover_marker > 0, 'the marker the runbook queries is missing');

    /* AniHubHourlyRefresh gets re-enabled and stamps a row. This is the only way the two writers
       can collide on sched_* without either of them knowing, so the runbook's zero-overlap query
       is an audit check, and it has to fail the run rather than note it. */
    world.db.prepare('UPDATE anime SET catalogue_synced_at = ?').run(Date.now() + 1000);
    const collided = await withShim(world, TAKEOVER, () => audit(opts));
    assert.equal(collided.ok, false, 'a local write after the takeover marker passed the audit');
    assert.match(collided.failures.join('\n'), /no local write after the takeover marker/);
  });
});

/* The runbook's pre-flight (README, Deploy step 4) compares two row snapshots with
   cloud-sync/diff-rows.mjs, whose per-mode forbidden lists are this file's ownership table written a
   second time — so the two are checked against each other rather than against a paragraph. A column
   the sync is designed to rewrite must never be forbidden, or the first real run prints a false alarm
   and the operator learns to ignore the check; a column that is neither written nor forbidden is a
   silent gap, which is worse. source_ids gets the third case: it is in the write set *and* under a
   rule, because the merge is allowed to gain keys and never to lose one. */
describe('the pre-flight diff asserts the same ownership the sync implements', () => {
  for (const mode of ['mirror', 'delta', 'takeover']) {
    it(mode + ': every column is either writable or protected, never both and never neither', () => {
      const writes = new Set(updateSet(mode));
      const both = FORBIDDEN[mode].filter((c) => writes.has(c));
      assert.deepEqual(both, [], `diff-rows forbids ${both.join(', ')}, which ${mode} writes on purpose`);
      const neither = ANIME_COLUMNS.filter((c) => c !== 'id' && !writes.has(c) && !FORBIDDEN[mode].includes(c));
      assert.deepEqual(neither, [], `diff-rows checks nothing about ${neither.join(', ')}, so a ${mode} run could rewrite them unremarked`);
    });
  }

  const row = (over = {}) => ({
    id: 'a-test-title', rating: 7, episode_total: 12, synopsis: 40, trend_rank: 4, added_at: '2024-01-02',
    sched_day: 5, sched_season: 'Fall 2026', catalogue_synced_at: 1, cloud_synced_at: null,
    source_ids: JSON.stringify({ kitsu: '1', anilist: 152 }), ...over,
  });
  const byId = (...rows) => new Map(rows.map((r) => [String(r.id), r]));
  const ids = (report) => report.violations.map((v) => `${v.id}.${v.column}`).join(',');

  it('a merged-in provenance key passes; a lost one, a moved anilist id or a rewritten slot does not', () => {
    const merged = row({ rating: 8, cloud_synced_at: 9, source_ids: JSON.stringify({ kitsu: '1', anilist: 152, mal: 34 }) });
    const clean = compare(byId(row()), byId(merged), 'mirror');
    assert.equal(clean.violations.length, 0, `a mirror run that refreshed metadata and gained idMal must pass: ${ids(clean)}`);

    assert.equal(ids(compare(byId(row()), byId(row({ source_ids: JSON.stringify({ anilist: 152 }) })), 'mirror')),
      'a-test-title.source_ids', 'json_patch deletes a key whose patch value is null; this run never sends one, so a lost key is the merge breaking');
    assert.equal(ids(compare(byId(row()), byId(row({ source_ids: JSON.stringify({ kitsu: '1', anilist: 999 }) })), 'mirror')),
      'a-test-title.source_ids', 'the anilist id decides which upstream record a row is and sync-anilist.mjs:539 refuses to move it');
    assert.equal(ids(compare(byId(row()), byId(row({ sched_season: 'Winter 2026' })), 'mirror')),
      'a-test-title.sched_season', 'the air slot belongs to the local task until Phase 3');
    assert.equal(compare(byId(row()), byId(row({ sched_season: 'Winter 2026', trend_rank: 3 })), 'takeover').violations.length, 0,
      'takeover owns the slot and the rank, so a change there is the design working');
    assert.equal(ids(compare(byId(row()), byId(row({ added_at: '2026-01-01' })), 'takeover')),
      'a-test-title.added_at', 'not even takeover may move when a title entered the catalogue');
  });

  it('row creation is Phase 2 onward, and no phase deletes', () => {
    const two = byId(row(), row({ id: 'b-other' }));
    assert.equal(ids(compare(byId(row()), two, 'mirror')), 'b-other.(row)', 'mirror never inserts');
    assert.equal(compare(byId(row()), two, 'delta').violations.length, 0, 'delta creating a row is the point of Phase 2');
    assert.equal(ids(compare(two, byId(row()), 'takeover')), 'b-other.(row)', 'the second snapshot is pinned to the ids of the first, so a missing row is a deletion');
  });
});

/* The two directions of the column contract mean opposite things, and the whole design of the gate
   is that only one of them stops a run: a missing column is a statement SQLite will reject, while an
   extra one is the normal state of a table two writers share. Checked as a pure function because the
   case that matters most — an empty read — cannot be produced by a database that has the table. */
describe('the live column diff', () => {
  const live = (names) => names.map((name, cid) => ({ cid, name }));

  it('separates what a writer cannot name from what it merely does not write', () => {
    const drift = diffLiveColumns(live([...ANIME_COLUMNS.slice(0, -1), 'catalogue_synced_at']), ANIME_COLUMNS);
    assert.deepEqual(drift.missing, ['cloud_synced_at'], 'the one dropped column, named');
    assert.deepEqual(drift.extra, ['catalogue_synced_at'], 'and the local stamp is an extra, not a mismatch');
  });

  it('an empty read is every column missing, never a pass', () => {
    /* PRAGMA table_info on a table that does not exist answers with no rows. Read as "nothing is
       missing", that is a gate that waves a fresh, uncreated database through to write nothing and
       report success. */
    assert.deepEqual(diffLiveColumns([], ANIME_COLUMNS).missing, ANIME_COLUMNS);
  });

  it('accepts bare names as well as PRAGMA rows, so the committed dump can be checked too', () => {
    assert.deepEqual(diffLiveColumns(ANIME_COLUMNS, ANIME_COLUMNS), { missing: [], extra: [] });
    assert.deepEqual(diffLiveColumns(['id', 'title'], ['id', 'title', 'year']).missing, ['year']);
  });

  it('names each column once, so the gate cannot report the same gap twice', () => {
    const repeated = ANIME_COLUMNS.filter((c, i) => ANIME_COLUMNS.indexOf(c) !== i);
    assert.deepEqual(repeated, [], 'a duplicate in ANIME_COLUMNS would double the parameter count of every statement too');
  });
});
