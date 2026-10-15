// Pins the D1 REST response parser against both envelope shapes it must read: the live array
// shape (one entry per statement, carrying its own `results`/`meta`) and the object shape that
// puts those fields on `result` directly. Every case runs against a stubbed fetch, so no
// request leaves the process and every credential here is a literal.
//
// The empty/malformed cases are load-bearing: an unreadable envelope must surface as zero rows —
// which the schema gate then reports as a named mismatch — never as a healthy read. The last
// block drives the real probe readers through the live array envelope, so the regression that
// returned an all-missing diff with empty raws is pinned at the layer that produced it.
//
//   node --test cloud-sync/d1.test.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { d1Query, d1All, d1First, assertLiveColumns, assertLiveTables } from './d1.mjs';

const ENV = { CF_ACCOUNT_ID: 'test-account-id', CF_DATABASE_ID: 'test-database-id', CF_API_TOKEN: 'test-token' };
const realFetch = globalThis.fetch;
let saved;
let calls;

const installFetch = (respond) => {
  calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, init });
    return respond(calls.length, url, init);
  };
};

const jsonResponse = (body, status = 200) => ({
  status,
  ok: status >= 200 && status < 300,
  text: () => Promise.resolve(JSON.stringify(body)),
});

/** The live envelope: `result` is an array with one entry per statement, `errors` always present. */
const envelope = (result, errors = []) => ({ success: errors.length === 0, result, errors });

/** What the live /query endpoint returns for one statement: the entry, array-wrapped. */
const liveEntry = (results, meta = {}) => envelope([{ results, success: true, meta }]);

beforeEach(() => {
  saved = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));
  Object.assign(process.env, ENV);
});

afterEach(() => {
  for (const k of Object.keys(ENV)) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  globalThis.fetch = realFetch;
});

describe('d1Query envelope parsing', () => {
  it('reads rows and meta from the live array-shaped envelope', async () => {
    const meta = { changed_db: false, rows_written: 0, rows_read: 2 };
    installFetch(() => jsonResponse(liveEntry([{ name: 'anime' }, { name: 'genre' }], meta)));
    const out = await d1Query('SELECT name FROM sqlite_master');
    assert.equal(calls.length, 1);
    assert.deepEqual(out.results, [{ name: 'anime' }, { name: 'genre' }]);
    assert.deepEqual(out.meta, meta);
  });

  it('reads the object-shaped envelope the same way', async () => {
    installFetch(() => jsonResponse(envelope({ results: [{ n: 400 }], meta: { rows_read: 400 } })));
    const out = await d1Query('SELECT COUNT(*) AS n FROM anime');
    assert.deepEqual(out.results, [{ n: 400 }]);
    assert.deepEqual(out.meta, { rows_read: 400 });
  });

  it('falls back to `metadata` when the entry names its meta that', async () => {
    installFetch(() => jsonResponse(envelope({ results: [{ ok: 1 }], metadata: { duration: 1.25 } })));
    const out = await d1Query('SELECT 1 AS ok');
    assert.deepEqual(out.results, [{ ok: 1 }]);
    assert.deepEqual(out.meta, { duration: 1.25 });
  });

  it('an empty per-statement array reads as zero rows, and the gate fails on it rather than passing', async () => {
    installFetch(() => jsonResponse(envelope([])));
    assert.deepEqual(await d1All('SELECT name FROM sqlite_master'), []);
    const probe = await assertLiveTables({ tables: ['anime'] });
    assert.deepEqual(probe.missing, ['anime'], 'an empty read must be named missing, never read as a clean table list');
    assert.deepEqual(probe.raw, []);
  });

  it('a missing result field reads as zero rows', async () => {
    installFetch(() => jsonResponse({ success: true }));
    assert.deepEqual((await d1Query('SELECT 1')).results, []);
    assert.deepEqual((await d1Query('SELECT 1')).meta, {});
    assert.equal(await d1First('SELECT 1'), null);
  });

  it('a failed envelope still throws, naming the errors', async () => {
    installFetch(() => jsonResponse({ success: false, errors: [{ code: 1001, message: 'boom' }] }));
    await assert.rejects(d1Query('SELECT 1'), /boom/);
  });

  it('a non-JSON body still throws, naming the status', async () => {
    installFetch(() => ({ status: 502, ok: false, text: () => Promise.resolve('<html>bad gateway') }));
    await assert.rejects(d1Query('SELECT 1'), /HTTP 502 non-JSON/);
  });

  it('posts sql and params to the account-and-database endpoint with bearer auth', async () => {
    installFetch(() => jsonResponse(liveEntry([{ ok: 1 }])));
    await d1Query('SELECT ? AS a, ? AS b', [7, 'x']);
    assert.equal(calls[0].url, `https://api.cloudflare.com/client/v4/accounts/${ENV.CF_ACCOUNT_ID}/d1/database/${ENV.CF_DATABASE_ID}/query`);
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers.authorization, `Bearer ${ENV.CF_API_TOKEN}`);
    assert.deepEqual(JSON.parse(calls[0].init.body), { sql: 'SELECT ? AS a, ? AS b', params: [7, 'x'] });
    assert.ok(calls[0].init.signal instanceof AbortSignal, 'the query timeout rides on the request');
  });
});

describe('probe readers through the live envelope', () => {
  it('assertLiveColumns sees the pragma rows, not an all-missing diff with an empty raw', async () => {
    const pragma = [
      { name: 'id', type: 'INTEGER', notnull: 1, dflt_value: null },
      { name: 'title', type: 'TEXT', notnull: 1, dflt_value: "''" },
    ];
    installFetch(() => jsonResponse(liveEntry(pragma, { rows_read: 2 })));
    const out = await assertLiveColumns({ table: 'anime', columns: ['id', 'title', 'cloud_synced_at'] });
    assert.equal(out.via, 'pragma_table_info');
    assert.deepEqual(out.missing, ['cloud_synced_at']);
    assert.deepEqual(out.raw, pragma);
  });

  it('assertLiveTables sees the real table list out of the live envelope', async () => {
    const names = ['anime', 'anime_genre', 'api_usage', 'genre', 'sync_lock', 'sync_meta', 'sync_runs'];
    installFetch(() => jsonResponse(liveEntry(names.map((name) => ({ name })))));
    const out = await assertLiveTables({ tables: ['anime', 'sync_pending'] });
    assert.deepEqual(out.missing, ['sync_pending']);
    assert.deepEqual(out.raw.map((r) => r.name), names);
  });
});
