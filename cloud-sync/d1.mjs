// D1 over its REST API, so the sync needs no wrangler, no npm install and no local
// machine. Rate-control relevance: every write path in this module is chunked against
// two documented ceilings — 90 bound parameters per statement (R14, an operator tunable)
// and the 100 KB maximum SQL size — because a single oversized statement fails the whole
// run, and a run that retries it burns its AniList budget again for nothing.
//
// Secrets come from the environment only (CI secrets). Nothing here is logged.

const BASE = 'https://api.cloudflare.com/client/v4';

/* D1's documented maximum SQL statement size is 100,000 bytes. Bound parameters keep the
   data out of the SQL text, so this is a backstop against a pathological column count
   rather than the usual constraint. */
const MAX_PARAMS = intEnv('D1_MAX_PARAMS_PER_STATEMENT', 90);
const MAX_SQL_BYTES = intEnv('D1_MAX_SQL_BYTES', 90_000);
const QUERY_TIMEOUT_MS = intEnv('D1_TIMEOUT_MS', 30_000);

function intEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive integer, got ${raw}`);
  return n;
}

function account() {
  const { CF_ACCOUNT_ID, CF_DATABASE_ID, CF_API_TOKEN } = process.env;
  const missing = [
    ['CF_ACCOUNT_ID', CF_ACCOUNT_ID],
    ['CF_DATABASE_ID', CF_DATABASE_ID],
    ['CF_API_TOKEN', CF_API_TOKEN],
  ].filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`d1: missing environment: ${missing.join(', ')}`);
  return { accountId: CF_ACCOUNT_ID, databaseId: CF_DATABASE_ID, token: CF_API_TOKEN };
}

/** Runs one statement with bound params. Returns { results, meta }. */
export async function d1Query(sql, params = []) {
  const { accountId, databaseId, token } = account();
  const res = await fetch(`${BASE}/accounts/${accountId}/d1/database/${databaseId}/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ sql, params }),
    signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
  });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`d1: HTTP ${res.status} non-JSON response: ${text.slice(0, 200)}`);
  }
  if (!res.ok || body.success === false) {
    throw new Error(`d1: HTTP ${res.status} ${JSON.stringify(body.errors ?? body.message ?? text).slice(0, 400)}`);
  }
  const result = body.result ?? {};
  return { results: result.results ?? [], meta: result.meta ?? result.metadata ?? {} };
}

export const d1All = async (sql, params = []) => (await d1Query(sql, params)).results;
export const d1First = async (sql, params = []) => (await d1All(sql, params))[0] ?? null;

/** How many rows fit one statement at `columns` each, by the parameter ceiling. */
export const rowsPerStatement = (columns) => Math.max(1, Math.floor(MAX_PARAMS / columns));

/**
 * Multi-row upsert, chunked by parameter count and by statement size. Never one
 * statement per row (R14). `conflictTarget` is the UNIQUE index (usually the primary
 * key); `update` lists the columns a conflict rewrites, via excluded.* so an update
 * adds no bound parameters. With `update` empty a conflicting row is skipped outright.
 *
 * `jsonMerge` names columns of `update` that hold a JSON object and were built by
 * merging a value this writer read earlier. Writing `excluded.col` there would drop a
 * key another writer added in between, so the merge is redone in SQLite instead:
 * json_patch(existing, new) keeps keys we never saw and lets our own keys win.
 *
 * `keepExisting` names columns where an absent new value means "the upstream source does
 * not know", not "the value is gone" — an airing title has no episode count on AniList, a
 * scoreless title has no rating. Absent means NULL and nothing else (R1): AniList returns
 * an explicit JSON null for a field it was asked about but does not have, while 0 is a
 * real value for `episodes` and '' can be real prose, so neither may be read as missing.
 * The caller therefore maps absent to null; a column that genuinely must be clearable (the
 * air slots, trend_rank) is left out of this list and written as-is.
 *
 * `fillIf` is for a column another writer owns, where this run may only FILL a hole:
 * `{ columns: [...], when: '<sql predicate over table columns>' }`. A conflicting row is
 * written only while it still satisfies `when` and only where this row carries a value;
 * anything else keeps the stored value, including a stored NULL — clearing a column that
 * belongs to someone else is not this writer's call. `when` is written by the caller, never
 * assembled from data, and is rejected if it holds a statement separator or a quote.
 * Returns the number of statements executed.
 */
export async function insertRows({ table, columns, rows, conflictTarget = ['id'], update = [], jsonMerge = [], keepExisting = [], fillIf = { columns: [], when: '' } }) {
  const ident = /^[a-z_][a-z0-9_]*$/i;
  if (!ident.test(table)) throw new Error(`d1: bad table name ${table}`);
  for (const c of [...columns, ...conflictTarget, ...update, ...jsonMerge, ...keepExisting, ...fillIf.columns]) {
    if (!ident.test(c)) throw new Error(`d1: bad column name ${c}`);
  }
  if (!rows.length) return 0;
  for (const c of [...conflictTarget, ...update, ...jsonMerge, ...keepExisting, ...fillIf.columns]) {
    if (!columns.includes(c)) throw new Error(`d1: '${c}' is not in the insert list for ${table}`);
  }
  for (const [c, strategy] of [...jsonMerge.map((x) => [x, 'jsonMerge']), ...keepExisting.map((x) => [x, 'keepExisting']), ...fillIf.columns.map((x) => [x, 'fillIf'])]) {
    if (!update.includes(c)) throw new Error(`d1: ${strategy} column '${c}' is not in the update list`);
    if ([jsonMerge, keepExisting, fillIf.columns].filter((list) => list.includes(c)).length > 1) {
      throw new Error(`d1: '${c}' is named by two write strategies at once`);
    }
  }
  if (fillIf.columns.length) {
    const when = String(fillIf.when ?? '').trim();
    if (!when) throw new Error(`d1: fillIf.columns without a when predicate would make the fill unconditional`);
    /* Not a defence against input — no caller assembles `when` from data. It is a defence
       against a future caller doing so, in a module whose statements go to production D1. */
    if (/[;'"]|(--)|(\/\*)/.test(when)) throw new Error(`d1: fillIf.when must be a plain predicate over column names, got ${when.slice(0, 80)}`);
    fillIf.when = when;
  }

  const setExpr = (c) => {
    if (jsonMerge.includes(c)) {
      /* R2: COALESCE on the stored side, so the first merge onto a row whose provenance is
         still NULL writes the new object rather than json_patch(NULL, …) = NULL. Anything
         that is not valid JSON is replaced wholesale — tools/sync-catalogue.mjs writes the
         whole object, and its version is authoritative for the keys it knows. */
      return `${c} = CASE WHEN json_valid(COALESCE(${table}.${c}, '{}')) THEN json_patch(COALESCE(${table}.${c}, '{}'), excluded.${c}) ELSE excluded.${c} END`;
    }
    if (keepExisting.includes(c)) {
      /* R1: NULL alone means absent. Not hasOwn, not falsy — 0 and '' are values. */
      return `${c} = CASE WHEN excluded.${c} IS NULL THEN ${table}.${c} ELSE excluded.${c} END`;
    }
    if (fillIf.columns.includes(c)) {
      return `${c} = CASE WHEN ${fillIf.when} AND excluded.${c} IS NOT NULL THEN excluded.${c} ELSE ${table}.${c} END`;
    }
    return `${c}=excluded.${c}`;
  };
  const perRow = `(${columns.map(() => '?').join(',')})`;
  const header = `INSERT INTO ${table} (${columns.join(',')}) VALUES `;
  const target = ` ON CONFLICT (${conflictTarget.join(',')})`;
  const tail = update.length
    ? `${target} DO UPDATE SET ${update.map(setExpr).join(', ')}`
    : `${target} DO NOTHING`;

  let statements = 0;
  let batch = [];
  let values = [];
  const flush = async () => {
    if (!batch.length) return;
    const sql = header + batch.join(',') + tail;
    if (Buffer.byteLength(sql) > MAX_SQL_BYTES) throw new Error(`d1: statement of ${Buffer.byteLength(sql)} bytes over the ${MAX_SQL_BYTES} limit`);
    await d1Query(sql, values);
    statements++;
    batch = [];
    values = [];
  };

  for (const row of rows) {
    if (row.length !== columns.length) throw new Error(`d1: row has ${row.length} values, table has ${columns.length} columns`);
    const flat = row.map((v) => (v === undefined ? null : v));
    const widened = Buffer.byteLength(`${header}${batch.concat(perRow).join(',')}`);
    if (batch.length && (values.length + flat.length > MAX_PARAMS || widened > MAX_SQL_BYTES)) await flush();
    batch.push(perRow);
    values.push(...flat);
  }
  await flush();
  return statements;
}
