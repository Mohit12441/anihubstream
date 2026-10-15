/*
 * Describe the D1 credentials without printing them.
 *
 * Why this exists: a run that cannot reach D1 says so with `schema_probe_failed`, and the one line
 * it can quote back is undici's — `Headers.append: "<value>" is an invalid header value` — which
 * Actions then masks to `***` and splits across two log lines at the offending character. So the
 * artifact that names the failure hides it: an operator can see THAT a credential is malformed and
 * cannot see whether it has a trailing newline (fixable by saving it again with the same text) or a
 * newline in the middle (fixable only by finding out what got pasted). This tool answers that from
 * inside the same job, with the same `${{ secrets.* }}` bindings, and reports only facts derived
 * from the value — lengths, character classes, the index of the first illegal one, a short digest
 * for comparing a copy held elsewhere.
 *
 * Nothing here writes. It reads the environment, asks Node's header validator the one question the
 * sync will ask it at run time, and then tries the smallest possible D1 read (`SELECT 1`) so the
 * verdict covers the whole path rather than only the credential's shape.
 *
 * The read is built here rather than imported from d1.mjs, because d1.mjs is the module under test:
 * it refuses at `account()` before anything can be described, and a diagnostic that dies with the
 * same message as the job it exists to explain has learned nothing. doctor-secrets.test.mjs holds
 * the two files' header shapes equal, which is the price of the copy.
 */

import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

/* The three names every cloud-sync job binds. Listed rather than discovered from
   `process.env` so a secret that is MISSING from the repository shows up as its own row instead of
   silently narrowing the report to whatever happens to be set. */
export const CREDENTIAL_NAMES = ['CF_ACCOUNT_ID', 'CF_DATABASE_ID', 'CF_API_TOKEN'];

/**
 * The characters `Headers.append` refuses, exactly.
 *
 * Node's validator rejects NUL, LF and CR in a header value, and tab is legal inside one. What it
 * does NOT reject is whitespace at the ends: measured on the version CI runs (`new
 * Headers({authorization: 'Bearer abc\n'})`, Node 24.19), a trailing LF, a trailing CRLF and two
 * trailing line breaks all pass, a leading space passes, and only a break at index 0 of the token
 * or anywhere after a character does it throws. That is RFC 7230's optional-whitespace trim
 * happening before the check, and it is the reason this tool exists: it means a secret saved with a
 * newline at the END is not the bug — CI would be running it happily — while a break anywhere else
 * is, and the two are indistinguishable from the masked log line, which shows only that a break
 * fell inside the quoted value.
 *
 * So `header_accepted: false` says "there is a line break somewhere but the end", and
 * `first_failing_at` is the index of the one that made it false.
 */
const CONTROL = new Map([[0, 'NUL'], [9, 'TAB'], [10, 'LF'], [13, 'CR']]);

const codeAt = (value, i) => value.codePointAt(i);

/**
 * Derived facts about one credential. `undefined` (never configured) and `''` (configured empty)
 * are distinct states and both are reported, because they fail a run differently: the first makes
 * `d1.mjs` refuse at `account()` with a named missing-environment error, the second gets as far as
 * the header and then 400s at Cloudflare.
 */
export function examine(value) {
  if (value === undefined) return { present: false, empty: false, state: 'not configured' };
  if (value === '') return { present: true, empty: true, state: 'configured empty', ...legality(value) };
  return { present: true, empty: false, state: 'configured', ...shape(value), ...legality(value) };
}

/** Lengths and the location of everything that makes the value unusable as a header value. */
function shape(value) {
  const illegal = [];
  const controls = {};
  for (let i = 0; i < value.length; i += 1) {
    const code = codeAt(value, i);
    const name = CONTROL.get(code);
    const outside = code < 32 || code === 127;
    if (!name && !outside) continue;
    const label = name ?? `code ${code}`;
    controls[label] = (controls[label] ?? 0) + 1;
    if (code === 0 || code === 10 || code === 13) illegal.push({ at: i, char: label });
  }
  const first = value[0] ?? '';
  const last = value.at(-1) ?? '';
  /* The break that actually failed, as opposed to the ones the parser throws away: everything after
     the last non-whitespace character is trimmed before the value is checked, so a trailing break is
     reported in `illegal_header_characters` and is NOT what killed a run. `first_failing_at` is the
     one that was not trimmable, and a null here alongside `header_accepted: false` would mean the
     validator changed its rules on a newer Node. */
  const kept = value.replace(/\s+$/, '').length;
  const failing = illegal.filter((c) => c.at < kept);
  const breaks = (value.match(/[\r\n]/g) ?? []).length;
  const digestOf = (text) => createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
  return {
    chars: value.length,
    bytes: Buffer.byteLength(value, 'utf8'),
    /* Non-ASCII in a bearer token means mojibake rather than a typo: a value that was UTF-8 once
       and got read as latin-1 keeps the same length and stops authenticating. */
    non_ascii: [...value].filter((c) => codeAt(c, 0) > 126).length,
    spaces: (value.match(/ /g) ?? []).length,
    /* Reported as booleans, not as the characters: the ends of a value are where a bad paste shows
       up, and "starts with a space" is a diagnosis while `" ${token}"` is half an exposure. */
    starts_with_whitespace: /^\s/.test(first),
    ends_with_whitespace: /\s$/.test(last),
    control_characters: controls,
    illegal_header_characters: illegal,
    first_failing_at: failing.length ? failing[0].at : null,
    digest: digestOf(value),
    /* Reported only when there is a break to remove, because it answers the question that comes
       straight after the defect: is this the same token with a bad paste, or a different token? If
       the digest of the value with its line breaks deleted equals the digest of the copy held
       elsewhere, nothing was mistyped and re-saving the same secret fixes the job. */
    digest_without_breaks: breaks ? digestOf(value.replace(/[\r\n]/g, '')) : null,
  };
}

/**
 * The question the sync will ask at run time, asked here instead: can this value be put in an
 * `authorization` header at all. `new Headers()` runs the same validator `fetch` does, so this
 * agrees with the real request rather than with a reimplementation of it.
 *
 * The thrown message quotes the value, so it is never returned — the verdict is a boolean and the
 * reason is the shape above, which is why shape is computed first.
 */
function legality(value) {
  try {
    new Headers({ authorization: `Bearer ${value}` });
    return { header_accepted: true };
  } catch {
    return { header_accepted: false };
  }
}

/**
 * Remove credential material from an error message before it becomes output.
 *
 * Two passes, because they catch different things: every known value is replaced literally (a token
 * echoed inside a Cloudflare error body, or inside undici's own message), then any quoted span is
 * replaced — which catches the same value arriving from a secret this tool was not handed, and
 * catches it split across lines, where a line-based scrub would miss the halves.
 */
export function redact(message, values = []) {
  let out = String(message ?? '');
  for (const value of values) {
    /* Below four characters a scrub is a find-and-replace over ordinary text: it shreds the message
       it was written to clean, and a credential that short is not a credential. GitHub's own log
       masker applies the same floor for the same reason. */
    if (!value || value.length < 4) continue;
    out = out.split(value).join('***');
    /* A CRLF-carrying secret is echoed into a message with the line break still in it, so the two
       halves are separate substrings of what remains after the whole-value pass. */
    for (const part of value.split(/[\r\n]+/)) if (part.length >= 4) out = out.split(part).join('***');
  }
  return out.replace(/"(?:[^"\\]|\\.)*"/g, '"***"');
}

/**
 * The smallest D1 read the endpoint can be asked for, shaped so its failure can be reported without
 * its message being trusted. `SELECT 1` binds nothing and matches no pattern, so it exercises the
 * URL, the header and the response envelope and nothing else — which is exactly the set of things a
 * `schema_probe_failed` run needs distinguished.
 */
export async function reachD1(env = process.env, fetchImpl = globalThis.fetch) {
  const values = CREDENTIAL_NAMES.map((n) => env[n] ?? '');
  const missing = CREDENTIAL_NAMES.filter((n) => !env[n]);
  if (missing.length) return { ok: false, stage: 'environment', detail: `not configured: ${missing.join(', ')}` };
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/d1/database/${env.CF_DATABASE_ID}/query`;
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.CF_API_TOKEN}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sql: 'SELECT 1 AS one', params: [] }),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* answered something that is not JSON */ }
    if (!res.ok || body?.success === false) {
      const errors = body?.errors ?? body?.messages ?? [];
      return {
        ok: false,
        stage: 'd1_query',
        http: res.status,
        /* Codes and count, not text: Cloudflare echoes parts of the request into its error messages
           and the token is in it. `7500 / LIKE or GLOB pattern too complex` is the one code worth
           naming by message, and no `SELECT 1` can produce it. */
        cloudflare_errors: Array.isArray(errors) ? errors.map((e) => e?.code ?? null) : [],
        detail: redact(text.slice(0, 200), values),
      };
    }
    const result = Array.isArray(body.result) ? body.result[0] : body.result;
    const rows = result?.results ?? [];
    return { ok: rows.length === 1 && rows[0]?.one === 1, stage: 'd1_query', read_back: rows.length ? rows[0].one : null };
  } catch (err) {
    /* undici's validation error quotes the header value; Cloudflare's error bodies can echo it. */
    return { ok: false, stage: 'request', detail: redact(err.message, values) };
  }
}

/** The report: one row per credential, then the reachability verdict, then the operator's answer. */
export async function doctor(env = process.env, fetchImpl = globalThis.fetch) {
  const report = { checked_at: new Date().toISOString(), credentials: [], d1: null, ok: false, why: '' };
  for (const name of CREDENTIAL_NAMES) report.credentials.push({ name, ...examine(env[name]) });

  const malformed = report.credentials.filter((c) => c.header_accepted === false).map((c) => c.name);
  const absent = report.credentials.filter((c) => !c.present || c.empty).map((c) => c.name);
  report.d1 = await reachD1(env, fetchImpl);
  report.ok = report.d1.ok && !malformed.length && !absent.length;
  if (absent.length) report.why = `${absent.join(', ')} is unset or empty — bind the secret in Actions → secrets → repository actions secrets`;
  else if (malformed.length) report.why = `${malformed.join(', ')} cannot be a header value — a break at the very end would have been trimmed and sent, so first_failing_at names the break at the start or inside the token: re-save it as one unbroken line, and digest_without_breaks already says whether the token itself was ever mistyped`;
  else if (!report.d1.ok) report.why = `the credential shapes are fine but the read did not come back (stage ${report.d1.stage}${report.d1.http ? `, HTTP ${report.d1.http}` : ''}${report.d1.cloudflare_errors?.length ? `, codes ${report.d1.cloudflare_errors.join('/')}` : ''}) — a token that verifies elsewhere and 400s here is scoped to a different account or database`;
  else report.why = `all three credentials are header-legal and one bound read came back`;
  return report;
}

const invokedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (invokedDirectly) {
  const report = await doctor();
  console.log(JSON.stringify(report, null, process.env.QUIET ? 0 : 2));
  console.error(report.ok ? `OK: ${report.why}` : `${report.why}`);
  process.exitCode = report.ok ? 0 : report.d1.stage === 'request' || report.d1.stage === 'environment' ? 2 : 1;
}
