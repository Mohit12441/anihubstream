// The D1 credentials are described, never printed — and the two facts that matter here were
// measured against Node 24.19 rather than assumed: a secret saved with a newline at the END is
// silently trimmed and sent (`'Bearer abc\n'` is accepted), while the same break at the start of the
// token or anywhere inside it throws `Headers.append: … is an invalid header value` and kills every
// D1 call in the job before the request leaves the runner. That is the difference between a sync
// run that works and one that exits `schema_probe_failed`, and the Actions log cannot show it: the
// runner masks the value to `***` and the break splits the line in two, so the artifact that names
// the failure hides where. These guards pin the validator's boundary (so nobody "fixes" the CI bug
// with a `.trim()` that could not have been the cause), and prove the report carries only derived
// facts.
//
//   node --test cloud-sync/doctor-secrets.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { examine, doctor, redact } from './doctor-secrets.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* Standing in for a real Cloudflare API token: high-entropy-looking, and long enough that a
   four-character fragment of it is unambiguous when checking it never reaches the output. */
const SECRET = 'cf0124abcdef6789abcdef6789abcdef6789AB';

const fetchStub = (reply) => async () => ({
  ok: true,
  status: 200,
  text: async () => (typeof reply === 'string' ? reply : JSON.stringify(reply)),
});

const liveShape = { success: true, result: [{ results: [{ one: 1 }], meta: {} }] };

describe('what makes a bearer value unusable', () => {
  /* The boundary the CI failure sits on. Each of these was true of `new Headers()` in Node 24.19
     when this was written; if a Node upgrade changes it, this test is the thing that says so, in
     the same job that runs the sync — not a comment that remembers it. */
  const cases = [
    ['a trailing LF is trimmed and sent', 'abc\n', true],
    ['a trailing CRLF is trimmed and sent', 'abc\r\n', true],
    ['two trailing breaks are trimmed and sent', 'abc\n\n', true],
    ['a trailing break plus a space is sent', 'abc\n ', true],
    ['a leading space is sent', ' abc', true],
    ['a tab inside the token is sent', 'ab\tcd', true],
    ['a non-ASCII byte is sent (and flagged as mojibake elsewhere)', 'ab\u00e9cd', true],
    ['a break at index 0 is refused', '\nabc', false],
    ['a break in the middle is refused', 'ab\ncd', false],
    ['a lone CR in the middle is refused', 'a\rb', false],
    ['a NUL is refused', 'a\u0000b', false],
  ];
  for (const [name, token, accepted] of cases) {
    it(`${name}`, () => {
      const seen = examine(token);
      assert.equal(seen.header_accepted, accepted);
      /* The two answers have to describe the same event: one is what Node's validator says about
         the composed header, the other is what this tool claims to have located in the value. A
         Node upgrade that trims differently makes them disagree, and this names it — the same commit
         that bumps CI's pin is the one that would find out. */
      assert.equal(seen.first_failing_at === null, accepted);
    });
  }

  it('locates the break it refuses, which is the whole reason it exists', () => {
    const seen = examine('ab\r\ncdef\n');
    assert.equal(seen.header_accepted, false);
    /* Index 2 is inside the token; the trailing break at 8 is not what failed — every position is
       reported, and `first_failing_at` is the one that was not trimmable, so a report that only
       said "contains a newline" would have sent the operator to trim(), which cannot fix it. */
    assert.equal(seen.first_failing_at, 2);
    assert.deepEqual(seen.illegal_header_characters, [{ at: 2, char: 'CR' }, { at: 3, char: 'LF' }, { at: 8, char: 'LF' }]);
    assert.deepEqual(seen.control_characters, { CR: 1, LF: 2 });
    assert.equal(seen.ends_with_whitespace, true);
    assert.equal(seen.chars, 9);
  });

  it('separates not-configured from configured-empty, because they fail a run differently', () => {
    assert.deepEqual(examine(undefined), { present: false, empty: false, state: 'not configured' });
    const empty = examine('');
    assert.equal(empty.present, true);
    assert.equal(empty.empty, true);
    /* Empty is the one shape that reaches the endpoint and gets refused there rather than here:
       `'Bearer '` is a legal header value, so `header_accepted` stays true and the report has to
       name it as absent instead of letting an empty read look like a healthy schema. */
    assert.equal(empty.header_accepted, true);
  });

  it('separates a bad paste from a wrong token', () => {
    /* The question after "your secret has a line break in it" is whether the secret is otherwise the
       right one, and the answer decides the fix: re-save the same token, or work out where the text
       itself came apart. Same value with a break inserted has to share the digest of the clean one. */
    const mangled = examine(`${SECRET.slice(0, 20)}\n${SECRET.slice(20)}`);
    assert.equal(mangled.digest_without_breaks, examine(SECRET).digest);
    assert.notEqual(mangled.digest, examine(SECRET).digest);
    assert.equal(examine(SECRET).digest_without_breaks, null);
  });

  it('carries a digest an operator can compare against the copy held elsewhere', () => {
    const seen = examine(SECRET);
    /* 16 hex characters: enough to tell two paste-mangled values apart, short enough that the
       report cannot be turned into the token even by someone who already knows its length. */
    assert.match(seen.digest, /^[0-9a-f]{16}$/);
    assert.notEqual(seen.digest, examine(`${SECRET}\n`).digest);
    assert.equal(seen.bytes, SECRET.length);
    assert.equal(seen.non_ascii, 0);
  });
});

describe('the report the job prints', () => {
  it('names every credential it was asked about, set or not', async () => {
    const report = await doctor({ CF_ACCOUNT_ID: 'a', CF_DATABASE_ID: 'd' }, fetchStub(liveShape));
    assert.deepEqual(report.credentials.map((c) => c.name), ['CF_ACCOUNT_ID', 'CF_DATABASE_ID', 'CF_API_TOKEN']);
    assert.equal(report.ok, false);
    assert.match(report.why, /CF_API_TOKEN is unset or empty/);
  });

  it('passes when the three shapes are legal and one bound read came back', async () => {
    const report = await doctor(
      { CF_ACCOUNT_ID: 'a', CF_DATABASE_ID: 'd', CF_API_TOKEN: SECRET },
      fetchStub(liveShape),
    );
    assert.equal(report.ok, true);
    assert.equal(report.d1.ok, true);
    assert.equal(report.d1.stage, 'd1_query');
  });

  it('reports an internal break as the credential defect it is, and does not blame the schema', async () => {
    const report = await doctor(
      { CF_ACCOUNT_ID: 'a', CF_DATABASE_ID: 'd', CF_API_TOKEN: `\n${SECRET}` },
      fetchStub(liveShape),
    );
    assert.equal(report.ok, false);
    assert.match(report.why, /CF_API_TOKEN cannot be a header value/);
    assert.match(report.why, /one unbroken line/);
    const token = report.credentials.find((c) => c.name === 'CF_API_TOKEN');
    assert.equal(token.first_failing_at, 0);
  });

  it('does not call an unreadable endpoint a healthy schema: a read that answers something else fails', async () => {
    const wrapped = await doctor({ CF_ACCOUNT_ID: 'a', CF_DATABASE_ID: 'd', CF_API_TOKEN: SECRET },
      fetchStub({ success: true, result: [{ results: [], meta: {} }] }));
    assert.equal(wrapped.d1.ok, false);
    assert.equal(wrapped.ok, false);
    assert.match(wrapped.why, /the read did not come back/);

    const refused = await doctor({ CF_ACCOUNT_ID: 'a', CF_DATABASE_ID: 'd', CF_API_TOKEN: SECRET },
      async () => ({ ok: false, status: 403, text: async () => JSON.stringify({ success: false, errors: [{ code: 10000, message: `Authentication error: ${SECRET}` }] }) }));
    assert.equal(refused.d1.http, 403);
    assert.deepEqual(refused.d1.cloudflare_errors, [10000]);
    assert.ok(!JSON.stringify(refused).includes(SECRET.slice(0, 8)), 'the error body is scrubbed before it is reported');
  });

  it('prints no part of what it examined', async () => {
    /* The failure this guards is the tool's own: undici quotes the whole header value in its
       message, and a run that catches that message and reports it has published the secret into the
       log the report was written to avoid. `redact` is the only path from an error to output. */
    const report = await doctor({ CF_ACCOUNT_ID: SECRET, CF_DATABASE_ID: SECRET, CF_API_TOKEN: SECRET },
      async () => { throw new TypeError(`Headers.append: "Bearer ${SECRET}" is an invalid header value.`); });
    const text = JSON.stringify(report);
    for (let i = 0; i + 4 <= SECRET.length; i += 1) {
      assert.ok(!text.includes(SECRET.slice(i, i + 4)), `the report leaks fragment ${i}`);
    }
    assert.equal(report.d1.stage, 'request');
    assert.match(report.d1.detail, /invalid header value/);
  });

  it('probes the header the sync actually sends', () => {
    /* The doctor builds its own request instead of importing d1Query, on purpose: d1.mjs refuses at
       account() before anything can be described, and a tool that dies with the same message as the
       job it is diagnosing has learned nothing. Duplicating one header line is the cost, and this is
       the guard that keeps the copy honest — the string compared here is the one whose acceptance is
       the whole report. */
    const src = readFileSync(join(ROOT, 'cloud-sync', 'd1.mjs'), 'utf8');
    assert.match(src, /headers: \{ authorization: `Bearer \$\{token\}`/);
    assert.match(src, /https:\/\/api\.cloudflare\.com\/client\/v4/);
  });

  it('will not scrub a value too short to be a secret', () => {
    /* A one-character secret would turn every letter of the message into `***` — the floor keeps
       the report readable when a secret is mis-set to something trivial, which is the case where
       the report is the only thing the operator has left. */
    const out = redact('Headers.append: "ab" is an invalid header value.', ['a', 'ab']);
    assert.equal(out, 'Headers.append: "***" is an invalid header value.');
    assert.match(out, /invalid header value/);
  });

  it('scrubs a secret that arrives split by its own line break', () => {
    const value = `${SECRET}\nmore${SECRET}`;
    const out = redact(`d1: ${value} rejected`, [value]);
    assert.ok(!out.includes(SECRET));
    assert.ok(!out.includes('more'), 'the half after the break is gone too');
  });
});
