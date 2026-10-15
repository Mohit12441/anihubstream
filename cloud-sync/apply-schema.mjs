// Apply a .sql file to the D1 database over the same REST API the sync uses, so a schema
// change needs no wrangler, no npm install and no local machine — the same property that made
// the sync CI-only. Run from the ops workflow (Actions → cloud-ops → apply-schema) or by hand:
//
//   node --env-file=.env cloud-sync/apply-schema.mjs cloud-sync/schema.sql
//
// D1's /query endpoint takes one statement per call, so the file is split here. SQLite's own
// lexical rules are what make that safe: `--` runs to end of line, `/* */` runs to its closer,
// a quoted literal runs to its closer with a doubled quote meaning a literal quote, and only a
// `;` seen outside all three ends a statement. Splitting on lines and semicolons gets this wrong
// on the repo's own files — the root schema.sql uses `/* */` comments and both files put
// apostrophes inside comments — so this walks the characters. Anything it cannot close (an
// unterminated literal, comment, or statement left without a `;`) throws before the first
// statement is sent, which is the whole point: a half-parsed migration applied to the live
// catalogue is worse than no migration.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { d1Query } from './d1.mjs';

/** Statements, each with the line its first token appeared on, so a failure can be pointed at. */
export function splitStatements(sql) {
  const out = [];
  let buffer = '';
  let line = 1;
  let startLine = 1;
  let open = false; // a non-space character has been seen since the last `;`
  let i = 0;

  const append = (ch) => {
    if (!open && /\S/.test(ch)) { open = true; startLine = line; }
    buffer += ch;
  };

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === '\n') { line++; append(ch); i++; continue; }

    if (ch === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      continue; // stop on the newline, so the branch above counts it
    }
    if (ch === '/' && next === '*') {
      const from = line;
      i += 2;
      let closed = false;
      while (i < sql.length) {
        if (sql[i] === '*' && sql[i + 1] === '/') { i += 2; closed = true; break; }
        if (sql[i] === '\n') line++;
        i++;
      }
      if (!closed) throw new Error(`unterminated block comment starting at line ${from}`);
      continue; // i is already past `*/`
    }
    if (ch === "'" || ch === '"') {
      const from = line;
      const quote = ch;
      append(ch);
      i++;
      let closed = false;
      while (i < sql.length) {
        const c = sql[i];
        if (c === '\n') line++;
        append(c);
        i++;
        if (c !== quote) continue;
        if (sql[i] === quote) { append(sql[i]); i++; } // a doubled quote is the literal quote
        else { closed = true; break; }
      }
      if (!closed) {
        throw new Error(`unterminated ${quote === "'" ? 'string literal' : 'quoted identifier'} starting at line ${from}`);
      }
      continue;
    }
    if (ch === ';') {
      if (open) out.push({ line: startLine, sql: buffer.trim() });
      buffer = '';
      open = false;
      i++;
      continue;
    }
    append(ch);
    i++;
  }
  if (open) throw new Error(`unterminated statement starting at line ${startLine} (a file must end each statement with ';')`);
  return out;
}

const ALREADY = /duplicate column name|already exists|no such table: (sqlite_|index_)/i;

/**
 * Apply one file. Returns the tally; `failed` is what decides the exit code, and `skipped` is the
 * schema's own idempotence guard firing, not an error.
 */
export async function applySchema(file) {
  const statements = splitStatements(readFileSync(file, 'utf8'));
  const applied = [];
  const skipped = [];
  const failed = [];
  for (const { line, sql: statement } of statements) {
    const head = statement.replace(/\s+/g, ' ').slice(0, 72);
    try {
      await d1Query(statement, []);
      applied.push(head);
    } catch (err) {
      if (ALREADY.test(err.message)) skipped.push(`${head} — ${err.message.slice(0, 80)}`);
      else failed.push({ line, head, error: err.message.slice(0, 300) });
    }
  }
  return {
    file, statements: statements.length, applied: applied.length,
    already_present: skipped.length, failed: failed.length,
    skipped: skipped.slice(0, 10), errors: failed.slice(0, 10),
  };
}

const invokedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (invokedDirectly) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node cloud-sync/apply-schema.mjs <path.sql>');
    process.exitCode = 2;
  } else {
    try {
      const result = await applySchema(file);
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.failed ? 1 : 0;
    } catch (err) {
      console.error(`apply-schema: ${err.message}`);
      process.exitCode = 2;
    }
  }
}
