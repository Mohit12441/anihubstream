import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { run } from './sync-anilist.mjs';

const realFetch = globalThis.fetch;
const realEnv = { ...process.env };

describe('sync-anilist terminal cursor persistence', () => {
  let calls;
  let storedMeta;
  let leaseOwner;

  beforeEach(() => {
    calls = [];
    storedMeta = new Map();
    leaseOwner = null;

    process.env.CF_ACCOUNT_ID = 'test-account-id';
    process.env.CF_DATABASE_ID = 'test-database-id';
    process.env.CF_API_TOKEN = 'test-token';
    process.env.MODE = 'mirror';
    process.env.LEGACY_WRITER_ACTIVE = '1';
    process.env.CLOUD_CREATES_ROWS = '0';
    process.env.CLOUD_OWNS_SCHEDULE = '0';
    process.env.CLOUD_OWNS_GENRES = '0';
    process.env.ANILIST_MIN_INTERVAL_MS = '20';
    process.env.MAX_ITEMS_PER_RUN = '100';

    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url, init });
      const body = init.body ? JSON.parse(init.body) : {};
      const sql = body.sql || '';
      const params = body.params || [];

      // D1 query dispatcher
      if (sql.includes('pragma_table_info')) {
        const pragma = [
          { name: 'id', type: 'TEXT', notnull: 1, dflt_value: null, pk: 1 },
          { name: 'title', type: 'TEXT', notnull: 1, dflt_value: "''" },
          { name: 'native', type: 'TEXT', notnull: 1, dflt_value: "''" },
          { name: 'year', type: 'INTEGER', notnull: 1, dflt_value: '0' },
          { name: 'rating', type: 'REAL', notnull: 1, dflt_value: '0' },
          { name: 'season', type: 'TEXT', notnull: 1, dflt_value: "''" },
          { name: 'kind', type: 'TEXT', notnull: 1, dflt_value: "'TV'" },
          { name: 'status', type: 'TEXT', notnull: 1, dflt_value: "'Finished'" },
          { name: 'art', type: 'TEXT', notnull: 1, dflt_value: "''" },
          { name: 'key_art', type: 'TEXT', notnull: 1, dflt_value: "''" },
          { name: 'accent', type: 'TEXT', notnull: 1, dflt_value: "''" },
          { name: 'synopsis', type: 'TEXT', notnull: 1, dflt_value: "''" },
          { name: 'rank', type: 'INTEGER', notnull: 0, dflt_value: null },
          { name: 'trend_rank', type: 'INTEGER', notnull: 0, dflt_value: null },
          { name: 'alt_seasons', type: 'TEXT', notnull: 0, dflt_value: null },
          { name: 'sched_day', type: 'INTEGER', notnull: 0, dflt_value: null },
          { name: 'sched_day_label', type: 'TEXT', notnull: 0, dflt_value: null },
          { name: 'sched_date', type: 'TEXT', notnull: 0, dflt_value: null },
          { name: 'sched_time', type: 'TEXT', notnull: 0, dflt_value: null },
          { name: 'sched_season', type: 'TEXT', notnull: 0, dflt_value: null },
          { name: 'source_ids', type: 'TEXT', notnull: 0, dflt_value: null },
          { name: 'skip_key_id', type: 'TEXT', notnull: 0, dflt_value: null },
          { name: 'skip_key_space', type: 'TEXT', notnull: 0, dflt_value: null },
          { name: 'episode_total', type: 'INTEGER', notnull: 0, dflt_value: null },
          { name: 'added_at', type: 'TEXT', notnull: 0, dflt_value: null },
          { name: 'search_text', type: 'TEXT', notnull: 0, dflt_value: null },
          { name: 'cloud_synced_at', type: 'INTEGER', notnull: 0, dflt_value: null },
          { name: 'catalogue_synced_at', type: 'INTEGER', notnull: 0, dflt_value: null },
        ];
        return {
          status: 200,
          ok: true,
          text: async () => JSON.stringify({ success: true, result: [{ results: pragma, success: true, meta: {} }] }),
        };
      }

      if (sql.includes('FROM sqlite_master WHERE type =')) {
        const tables = [
          'anime', 'genre', 'anime_genre', 'sync_lock', 'api_usage', 'sync_runs', 'sync_meta',
        ].map((name) => ({ name }));
        return {
          status: 200,
          ok: true,
          text: async () => JSON.stringify({ success: true, result: [{ results: tables, success: true, meta: {} }] }),
        };
      }

      if (sql.includes('SELECT value FROM sync_meta WHERE key = ?')) {
        const key = params[0];
        const val = storedMeta.get(key);
        const results = val !== undefined ? [{ value: val }] : [];
        return {
          status: 200,
          ok: true,
          text: async () => JSON.stringify({ success: true, result: [{ results, success: true, meta: {} }] }),
        };
      }

      if (sql.includes('INSERT INTO sync_meta (key, value) VALUES (?1, ?2)') || sql.includes('INSERT INTO sync_meta (key, value) VALUES (?, ?)')) {
        const key = params[0];
        const val = params[1];
        storedMeta.set(key, val);
        return {
          status: 200,
          ok: true,
          text: async () => JSON.stringify({ success: true, result: [{ results: [], success: true, meta: { changes: 1 } }] }),
        };
      }

      if (sql.includes('INSERT INTO sync_lock')) {
        leaseOwner = params[1];
        return {
          status: 200,
          ok: true,
          text: async () => JSON.stringify({ success: true, result: [{ results: [], success: true, meta: { changes: 1 } }] }),
        };
      }

      if (sql.includes('SELECT owner FROM sync_lock WHERE name = ?1')) {
        return {
          status: 200,
          ok: true,
          text: async () => JSON.stringify({ success: true, result: [{ results: [{ owner: leaseOwner }], success: true, meta: {} }] }),
        };
      }

      if (sql.includes('DELETE FROM sync_lock')) {
        leaseOwner = null;
        return {
          status: 200,
          ok: true,
          text: async () => JSON.stringify({ success: true, result: [{ results: [], success: true, meta: { changes: 1 } }] }),
        };
      }

      if (sql.includes('SELECT requests FROM api_usage')) {
        return {
          status: 200,
          ok: true,
          text: async () => JSON.stringify({ success: true, result: [{ results: [{ requests: 0 }], success: true, meta: {} }] }),
        };
      }

      if (sql.includes('SELECT id, label FROM genre')) {
        return {
          status: 200,
          ok: true,
          text: async () => JSON.stringify({ success: true, result: [{ results: [], success: true, meta: {} }] }),
        };
      }

      if (sql.includes('FROM anime WHERE id > ? ORDER BY id')) {
        // Return empty slice so catalogue is at end
        return {
          status: 200,
          ok: true,
          text: async () => JSON.stringify({ success: true, result: [{ results: [], success: true, meta: {} }] }),
        };
      }

      if (sql.includes('INSERT INTO sync_runs')) {
        return {
          status: 200,
          ok: true,
          text: async () => JSON.stringify({ success: true, result: [{ results: [], success: true, meta: { changes: 1 } }] }),
        };
      }

      return {
        status: 200,
        ok: true,
        text: async () => JSON.stringify({ success: true, result: [{ results: [], success: true, meta: {} }] }),
      };
    };
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    for (const k of Object.keys(process.env)) {
      if (realEnv[k] === undefined) delete process.env[k];
      else process.env[k] = realEnv[k];
    }
  });

  it('persists terminal cursor with done:true when slice is empty', async () => {
    const summary = await run({ forceTakeover: false });

    assert.equal(summary.exit_reason, 'catalogue_end');
    assert.ok(summary.cursor, 'summary should have cursor');
    assert.equal(summary.cursor.done, true);
    assert.equal(summary.cursor.after, '');
    assert.equal(summary.cursor.pendingAfter, 0);
    assert.ok(summary.cursor.doneAt > 0);

    const rawPersisted = storedMeta.get('cloud_anilist_cursor:mirror');
    assert.ok(rawPersisted, 'cursor must be persisted in sync_meta under cloud_anilist_cursor:mirror');
    const persisted = JSON.parse(rawPersisted);
    assert.equal(persisted.done, true);
    assert.equal(persisted.after, '');
    assert.equal(persisted.pendingAfter, 0);
    assert.equal(persisted.doneAt, summary.cursor.doneAt);
  });
});
