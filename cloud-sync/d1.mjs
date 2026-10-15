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
 * The column set a writer names, checked against the set the database actually has. Three buckets,
 * because they mean different things and only two of them stop a run:
 *
 *   `missing` — a column in `wanted` that the table does not have. Fatal, and fatal in an
 *      unhelpful way: insertRows() writes ANIME_COLUMNS by name, so the first chunked upsert
 *      dies on `no such column: …` mid-batch, with an error that says nothing about which side
 *      drifted. Checking it before a lease is taken turns that into a named exit.
 *   `extra` — a column the table has that `wanted` does not name. This is the normal state of a
 *      shared table: production carries the local task's stamp (catalogue_synced_at) and every
 *      other column root schema.sql has never carried. A strict equality check would fail on a
 *      healthy database, so extras are reported and never block a run.
 *   `unwritable` — the one shape of extra that does block one: NOT NULL with no default. Every
 *      INSERT that omits it fails on the constraint, for every row in the chunk, while a gate that
 *      only counted extras would call the schema clean. A default (or a nullable column) is fine,
 *      because SQLite fills it in.
 *
 * `live` accepts `PRAGMA table_info` rows or bare names, so the committed production dump
 * (cloud-sync/schema.live.sql) can be fed to the same function the sync uses. Bare names answer
 * only the first two buckets — there is no notnull in a name — and an empty read is not "no missing
 * columns" but "all of them": a table that does not exist returns no rows, and a gate that waves
 * that through is not a gate.
 */
export function diffLiveColumns(live, wanted) {
  const rows = live.map((r) => (typeof r === 'string' ? { name: r } : r ?? {})).filter((r) => r.name);
  const have = new Set(rows.map((r) => r.name));
  const extras = rows.filter((r) => !wanted.includes(r.name));
  return {
    missing: wanted.filter((c) => !have.has(c)),
    extra: extras.map((r) => r.name),
    unwritable: extras.filter((r) => Number(r.notnull) === 1 && r.dflt_value === null).map((r) => r.name),
  };
}

/* --------------------------------------------------------------- DDL fallback reading */

/* SQLite's lexical rules, not a regex approximation: `--` runs to end of line, a quoted
   literal or identifier runs to its closer with a doubled quote meaning the quote itself,
   and [brackets] have no escape at all. Comments emit nothing, so a comma inside one cannot
   split a column item and the word NOT inside a comment cannot fake a NOT NULL. This is the
   same walk apply-schema.mjs splits statements with, applied to the same kind of text. */
function tokenizeDdl(sql) {
  const tokens = [];
  const n = sql.length;
  let i = 0;
  while (i < n) {
    const ch = sql[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '-' && sql[i + 1] === '-') {
      while (i < n && sql[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && sql[i + 1] === '*') {
      i += 2;
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i = Math.min(n, i + 2);
      continue;
    }
    const start = i;
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      let value = '';
      i++;
      while (i < n) {
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) { value += quote; i += 2; continue; }
          i++;
          break;
        }
        value += sql[i];
        i++;
      }
      tokens.push({ type: quote === "'" ? 'string' : 'ident', text: sql.slice(start, i), value, start, end: i });
      continue;
    }
    if (ch === '[') {
      const close = sql.indexOf(']', i + 1);
      const end = close < 0 ? n : close + 1;
      tokens.push({ type: 'ident', text: sql.slice(start, end), value: sql.slice(i + 1, close < 0 ? n : close), start, end });
      i = end;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      while (i < n && /[A-Za-z0-9_$]/.test(sql[i])) i++;
      tokens.push({ type: 'word', text: sql.slice(start, i), value: sql.slice(start, i), start, end: i });
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(sql[i + 1] ?? ''))) {
      while (i < n && /[0-9A-Za-z_.]/.test(sql[i])) i++;
      if (/^[0-9.]+[eE]$/.test(sql.slice(start, i)) && (sql[i] === '+' || sql[i] === '-') && /[0-9]/.test(sql[i + 1] ?? '')) {
        i += 2;
        while (i < n && /[0-9]/.test(sql[i])) i++;
      }
      tokens.push({ type: 'number', text: sql.slice(start, i), value: sql.slice(start, i), start, end: i });
      continue;
    }
    tokens.push({ type: 'punct', text: ch, value: ch, start, end: i + 1 });
    i++;
  }
  return tokens;
}

const TABLE_CONSTRAINT_HEADS = new Set(['CONSTRAINT', 'PRIMARY', 'UNIQUE', 'CHECK', 'FOREIGN']);

/** One column item of a CREATE TABLE body; null when the item is a table constraint. */
function parseColumnItem(item, sql) {
  const first = item[0];
  if (!first) return null;
  if (first.type === 'word' && TABLE_CONSTRAINT_HEADS.has(first.text.toUpperCase())) return null;
  if (first.type === 'number' || first.type === 'punct') return null;
  const name = first.value;
  let notnull = 0;
  let dflt_value = null;
  let depth = 0;
  for (let j = 1; j < item.length; j++) {
    const t = item[j];
    if (t.text === '(') { depth++; continue; }
    if (t.text === ')') { depth--; continue; }
    /* Only the column's own top level counts: a NOT NULL inside CHECK (...) or a parenthesised
       DEFAULT is an expression, and pragma_table_info does not report it either. */
    if (depth > 0 || t.type !== 'word') continue;
    const kw = t.text.toUpperCase();
    if (kw === 'NOT' && item[j + 1]?.type === 'word' && item[j + 1].text.toUpperCase() === 'NULL') {
      notnull = 1;
      j++;
      continue;
    }
    if (kw === 'DEFAULT') {
      const v = item[j + 1];
      if (!v) break;
      if (v.text === '(') {
        let d = 0;
        let end = -1;
        for (let k = j + 1; k < item.length; k++) {
          if (item[k].text === '(') d++;
          else if (item[k].text === ')' && --d === 0) { end = k; break; }
        }
        const last = item[end >= 0 ? end : item.length - 1];
        dflt_value = sql.slice(v.start, last.end);
        j = end >= 0 ? end : item.length;
      } else if ((v.text === '+' || v.text === '-') && item[j + 2]) {
        dflt_value = sql.slice(v.start, item[j + 2].end);
        j += 2;
      } else if (v.type === 'word' && /^x$/i.test(v.text) && item[j + 2]?.type === 'string') {
        /* A blob literal X'ABCD' lexes as a word and a string; the value is both, together. */
        dflt_value = sql.slice(v.start, item[j + 2].end);
        j += 2;
      } else {
        dflt_value = v.text;
        j++;
      }
      continue;
    }
  }
  return { name, notnull, dflt_value };
}

/**
 * The column list of one CREATE TABLE statement, as rows shaped like pragma_table_info's, so
 * the same `diffLiveColumns` reads both probes. This is the fallback for an endpoint that
 * refuses the table-valued SELECT — which is the one thing the preferred probe cannot be
 * proven against from here, so the contingency ships instead of waiting to be needed.
 *
 * sqlite_master keeps the statement text verbatim (comments included) and SQLite rewrites it
 * when ALTER TABLE ADD COLUMN appends a column, so the text covers every column of a live table.
 * A quirk in favour of trusting it: ADD COLUMN cannot create NOT NULL without a default, the
 * one shape the unwritable bucket is about.
 *
 * Fidelity limits, deliberate: `dflt_value` keeps the outer parentheses of an expression default
 * rather than stripping them like pragma does, because only its NULLness is load-bearing. [] is
 * returned for anything not recognisable as a plain CREATE TABLE (VIRTUAL TABLE, an unterminated
 * body) — empty reads as "every wanted column is missing", which fails the gate rather than
 * waving the table through.
 */
export function columnsFromDdl(sql) {
  const tokens = tokenizeDdl(sql);
  const word = (t, w) => t && t.type === 'word' && t.text.toUpperCase() === w;
  if (!word(tokens[0], 'CREATE')) return [];
  let k = 1;
  if (word(tokens[k], 'TEMP') || word(tokens[k], 'TEMPORARY')) k++;
  if (!word(tokens[k], 'TABLE')) return [];
  /* The first `(` token is the body opener: a table name can be quoted but is still one token,
     so no `(` can precede the real one. */
  const open = tokens.findIndex((t) => t.text === '(');
  if (open < 0) return [];
  let depth = 0;
  let close = -1;
  for (let i = open + 1; i < tokens.length; i++) {
    if (tokens[i].text === '(') depth++;
    else if (tokens[i].text === ')') { if (depth === 0) { close = i; break; } depth--; }
  }
  if (close < 0) return [];

  const items = [];
  let current = [];
  let itemDepth = 0;
  for (let i = open + 1; i < close; i++) {
    const t = tokens[i];
    if (t.text === '(') itemDepth++;
    else if (t.text === ')') itemDepth--;
    else if (t.text === ',' && itemDepth === 0) { items.push(current); current = []; continue; }
    current.push(t);
  }
  if (current.length) items.push(current);

  const columns = [];
  for (const item of items) {
    const col = parseColumnItem(item, sql);
    if (col) columns.push(col);
  }
  return columns;
}

/* ------------------------------------------------------------------------- live probes */

/**
 * `diffLiveColumns` against the live database. Returns the diff rather than throwing on a
 * disagreement — what a mismatch costs is the caller's decision, which is the entire point of asking
 * before the lease. A read that cannot happen at all does throw, and callers must treat that as its
 * own failure: an endpoint that refuses this query shape and a table that lacks a column are two
 * different afternoons.
 *
 * The table-valued form is used deliberately. `PRAGMA table_info(anime)` is a bare pragma statement,
 * and the REST /query endpoint is stricter about statement shape than a SQLite shell; the
 * `pragma_table_info()` function is an ordinary SELECT over the same rows and returns `notnull` and
 * `dflt_value` as columns, which is what the unwritable check needs.
 *
 * `via` names which read answered. `sqlite_master` in a run log means the preferred shape was
 * refused and the columns came from parsed DDL — the answer a run proceeded on either way, but the
 * distinction an operator wants when the two disagree some day. Only when both reads fail does this
 * throw, naming both, so the run's reason says the probe itself never answered rather than pretending
 * to be a mismatch.
 */
export async function assertLiveColumns({ table = 'anime', columns }) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(table)) throw new Error(`d1: bad table name ${table}`);
  let rows;
  let via = 'pragma_table_info';
  try {
    rows = await d1All(`SELECT name, type, "notnull", dflt_value FROM pragma_table_info('${table}')`);
  } catch (pragmaErr) {
    via = 'sqlite_master';
    let ddlRow;
    try {
      ddlRow = await d1First(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = '${table}'`);
    } catch (ddlErr) {
      throw new Error(`d1: column probe failed on both reads — pragma_table_info: ${pragmaErr.message}; sqlite_master: ${ddlErr.message}`);
    }
    /* A missing row is a missing table, which reads as every column missing — named by the
       caller, never silently passed. */
    rows = ddlRow?.sql ? columnsFromDdl(ddlRow.sql) : [];
  }
  return { ...diffLiveColumns(rows, columns), via };
}

/**
 * The tables the sync reaches for, checked like the columns and before the same lease. A gate
 * that validates a column surface and lets the run die mid-flight on `no such table: sync_pending`
 * has moved the failure, not prevented it — and whether a missing queue table kills a run at all
 * depends on a mode switch (the queue is only read by the modes that create rows), an answer that
 * belongs in the gate rather than in a paragraph of reasoning. One sqlite_master read; `missing`,
 * named, is the whole report.
 */
export async function assertLiveTables({ tables }) {
  const rows = await d1All(`SELECT name FROM sqlite_master WHERE type = 'table'`);
  const have = new Set(rows.map((r) => r.name));
  return { missing: tables.filter((t) => !have.has(t)) };
}

/**
 * What is wrong with the live schema, or null — one function for both writers and for verify.mjs,
 * so the audit and a run cannot disagree about which fault is which. The fault is a reason and a
 * sentence, not a thrown error: callers decide what to record and which exit code it earns.
 *
 *   'schema_mismatch'   — a wanted column or a required table is absent. Something the code names
 *      does not exist, so no write can land as written; the error names each missing item.
 *   'schema_unwritable' — every column and table present, but an extra is NOT NULL without a
 *      default. A different afternoon from a mismatch: nothing the repo names is missing; the
 *      live table carries a column the writers do not know, and SQLite refuses every insert that
 *      omits it. Its own reason because the fix differs — default the column, make it nullable —
 *      and because a report that says 'mismatch' sends the operator hunting a column that is not
 *      missing. A missing column/table outranks it: it is the more fundamental fault, and one
 *      message naming both would bury it.
 */
export function schemaFaults({ columns, tables }) {
  if (columns.missing.length || tables.missing.length) {
    const reasons = [];
    if (columns.missing.length) reasons.push(`lacks the column${columns.missing.length > 1 ? 's' : ''} ${columns.missing.join(', ')} — apply cloud-sync/schema.sql if one of them is a stamp column, otherwise the writer's column list and the live table disagree and one of them has to change`);
    if (tables.missing.length) reasons.push(`lacks the table${tables.missing.length > 1 ? 's' : ''} ${tables.missing.join(', ')} — apply cloud-sync/schema.sql; an applied subset of it is normal mid-rollout, and a run cannot proceed without what it names`);
    return { reason: 'schema_mismatch', error: `production: ${reasons.join('; and it ')} — nothing was written` };
  }
  if (columns.unwritable.length) {
    return {
      reason: 'schema_unwritable',
      error: `production anime has ${columns.unwritable.join(', ')} NOT NULL without a default, so every insert that omits it fails on the constraint — give the column a default or make it nullable; nothing was written`,
    };
  }
  return null;
}

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
