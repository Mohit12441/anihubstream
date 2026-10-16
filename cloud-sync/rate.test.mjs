// Hermetic pins for the rate limiter: every case is one of the acceptance criteria, run
// against a stubbed fetch so no request reaches AniList and no test needs the network.
//
// Only the pacing test uses the production 2500ms floor, because it measures real elapsed
// time; the rest ask for a fast floor so they assert behaviour instead of sleeping.
//
//   node --test cloud-sync/rate.test.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createAnilist, classify403, classifyGraphQLError, QueryTooComplex, RunAborted, BudgetExhausted } from './anilist.mjs';
import { insertRows, rowsPerStatement } from './d1.mjs';
import {
  ANIME_COLUMNS, KEEP_WHEN_ABSENT, LEGACY_OWNED, MODES, MODE_DEFAULT, NOT_NULL_KEPT, SCHED_COLUMNS, SCHED_FILL_GUARD, airSlot,
  completeFromStored, flagEnv, genreIndex, mapGenres, planRows, resolveMode, rowFromMedia, toTuple, updateSet, trendingRanks,
} from './sync-anilist.mjs';

/** A floor the tests can live with: 20ms spacing, ceiling high enough not to clamp it. */
const FAST = { minIntervalMs: 20, rateCeilingRpm: 3000, backoffBaseMs: 1, breakerCooldownMs: 10 };

const json = (data, headers = {}) => ({
  status: 200,
  headers: new Headers({ 'content-type': 'application/json', ...headers }),
  ok: true,
  text: () => Promise.resolve(JSON.stringify(data)),
});

const noContent = (status, body, headers = {}) => ({
  status,
  headers: new Headers(headers),
  ok: false,
  text: () => Promise.resolve(body),
});

let calls;
const installFetch = (respond) => {
  calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, init, at: Date.now() });
    return respond(calls.length, url, init);
  };
  return calls;
};

const EMPTY_PAGE = () => json({ data: { Page: { pageInfo: { hasNextPage: false }, media: [] } } });

/* The limiter paces against its own anchor: Date.now() taken inside sendOnce, one statement
   before fetch is called. The stub above takes a second Date.now() when it is invoked. Both are
   truncated to whole milliseconds, so a true 2500ms gap between sends can measure 2499 here.
   The slack is in the measurement, never in the spacing — and it cannot accumulate, because the
   limiter re-reads the clock after every sleep rather than trusting the timer. Anything under
   2499 is a real breach, so this stays at 1. */
const MEASURE_SLACK_MS = 1;

describe('1. pacing ceiling (criterion: never above 30 req/min, even worst case)', () => {
  beforeEach(() => { delete process.env.ANILIST_MIN_INTERVAL_MS; delete process.env.ANILIST_RATE_CEILING_RPM; });

  it('spaces consecutive request starts by at least the production interval', async () => {
    installFetch(EMPTY_PAGE);
    const api = createAnilist({});
    assert.equal(api.spacing, 2500, 'the default is the documented 24 req/min spacing');
    for (let i = 0; i < 3; i++) await api.pageIds({ page: i + 1 });
    assert.equal(calls.length, 3);
    for (let i = 1; i < calls.length; i++) {
      const gap = calls[i].at - calls[i - 1].at;
      assert.ok(gap >= 2500 - MEASURE_SLACK_MS, `gap ${gap}ms below the 2500ms floor`);
    }
    assert.equal(api.interval, 2500, 'no signal, so the learned interval never moved');
  });

  it('paces from the send instant, not from the response (R2 "start-to-start")', async () => {
    /* The distinction only shows up when a reply is slow, so the stub holds the first response for
       900ms. Paced from the send — which is what anilist.mjs:151 does, taking Date.now() as the
       request leaves — the two starts stay 2500ms apart whatever the latency did. Re-anchored on
       the completion, this gap would be ~3400ms, and the difference is visible without reading a
       single private field. */
    const slowThenFast = (n) => (n === 1
      ? new Promise((resolve) => setTimeout(() => resolve(json({ data: { Page: { pageInfo: { hasNextPage: false }, media: [] } } })), 900))
      : Promise.resolve(json({ data: { Page: { pageInfo: { hasNextPage: false }, media: [] } } })));
    installFetch(slowThenFast);
    const api = createAnilist({});
    const t0 = Date.now();
    await api.pageIds({ page: 1 });
    await api.pageIds({ page: 2 });
    assert.equal(api.stats.requests, 2);
    const gap = calls[1].at - calls[0].at;
    assert.ok(gap >= 2500 - MEASURE_SLACK_MS, `second send left ${gap}ms after the first, under the floor`);
    assert.ok(gap < 2500 + 900, `a ${gap}ms gap means the limiter waited out the 900ms response too — it paced from the completion, not the send`);
    assert.ok(Date.now() - t0 >= 2500 - MEASURE_SLACK_MS, 'the run as a whole cannot be faster than one spacing');
  });

  it('holds the floor across 50 consecutive sends (T6)', async () => {
    /* The acceptance criterion is stated over 50 sends, because a short run can hide an
       anchor that drifts by a millisecond per request. This costs about two minutes of real
       elapsed time and that is the point: it measures the clock the limiter is actually
       paced against, at the production floor, with no stubbed timers. */
    installFetch(EMPTY_PAGE);
    const api = createAnilist({});
    for (let i = 0; i < 50; i++) await api.pageIds({ page: i + 1 });
    assert.equal(calls.length, 50);
    let worst = Infinity;
    for (let i = 1; i < calls.length; i++) worst = Math.min(worst, calls[i].at - calls[i - 1].at);
    assert.ok(worst >= 2500 - MEASURE_SLACK_MS, `a 50-send run put ${worst}ms between two starts; the floor is 2500ms`);
    assert.equal(api.interval, 2500);
    /* 49 gaps of at least 2500ms is the whole claim in one number: 24 req/min, never more. */
    assert.ok(calls[49].at - calls[0].at >= 49 * 2500 - MEASURE_SLACK_MS, `${calls[49].at - calls[0].at}ms for 49 gaps: the floor leaked`);
  });

  it('refuses a MIN_INTERVAL that would breach the rpm ceiling', () => {
    process.env.ANILIST_MIN_INTERVAL_MS = '100';
    const warn = [];
    const api = createAnilist({ onWarn: (m) => warn.push(m) });
    assert.ok(api.spacing >= 2500, `clamped floor is ${api.spacing}ms`);
    assert.match(warn.join(' '), /clamped/);
  });

  it('relaxes after a streak of clean requests, but never below the floor (R4)', async () => {
    installFetch(EMPTY_PAGE);
    const api = createAnilist({ ...FAST, decaySuccesses: 3, startIntervalMs: 300 });
    for (let i = 0; i < 8; i++) await api.request('{ a }');
    assert.ok(api.interval < 300, `eight clean requests did not relax the 300ms start (${api.interval}ms)`);
    assert.ok(api.interval >= 20, `relaxed below the configured floor (${api.interval}ms)`);
  });

  it('clamps the learned interval to the floor and the cap', () => {
    const api = createAnilist({ ...FAST });
    api.setInterval(1);
    assert.equal(api.interval, 20, 'a stored value cannot take us under the floor');
    api.setInterval(10_000_000);
    assert.equal(api.interval, 30000, 'nor over the documented cap');
  });

  it('ignores responses that carry no rate headers at all', async () => {
    installFetch(EMPTY_PAGE);
    const api = createAnilist({ ...FAST });
    await api.request('{ a }');
    assert.equal(api.spacing, 20, 'a missing header is not "zero quota left"');
  });

  it('widens on a low X-RateLimit-Remaining window without persisting it', async () => {
    installFetch(() => json({ data: { Page: { media: [] } } },
      { 'x-ratelimit-remaining': '3', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 120) }));
    const api = createAnilist({ ...FAST });
    await api.request('{ a }');
    assert.ok(api.spacing > 36000 && api.spacing <= 40000, `120s window over 3 requests => ${api.spacing}ms`);
    assert.equal(api.interval, 20, 'the header widen is transient, not the learned value');
  });
});

describe('2. 403 handling (criterion: a 403 never produces a retry storm)', () => {
  const blocked = () => noContent(403, '<html>You have been manually blocked</html>', { 'content-type': 'text/html' });

  it('classifies the four 403 bodies differently', () => {
    assert.equal(classify403('You have been manually blocked'), 'blocked');
    assert.equal(classify403('{"errors":[{"message":"The AniList API has been temporarily disabled due to severe stability issues"}]}'), 'disabled');
    assert.equal(classify403('<html>Just a moment...</html>'), 'challenge');
    assert.equal(classify403('forbidden'), 'forbidden');
  });

  it('opens the circuit, then aborts the run instead of burning the budget', async () => {
    installFetch(blocked);
    const saved = [];
    const api = createAnilist({ onThrottle: (s) => saved.push(s), ...FAST });
    await assert.rejects(() => api.request('{ Page(page:1,perPage:1){ media{ id } } }'), RunAborted);
    assert.equal(api.stats.breaker_opens, 2);
    assert.ok(api.stats.requests <= 8, `spent ${api.stats.requests} requests against a blocked IP`);
    assert.ok(api.interval > 20, 'the learned interval grew');
    assert.ok(saved.length > 0, 'the widened interval was persisted for the next run');
  });

  it('does not fall back to a relay when AniList says the IP is blocked', async () => {
    installFetch(blocked);
    const api = createAnilist({ relayPrefix: 'https://relay.example/?quest=', ...FAST });
    await assert.rejects(() => api.request('{ x }'), RunAborted);
    assert.equal(api.stats.relay_used, false, 'routing around a deliberate block is not a fallback');
    assert.ok(calls.every((c) => !String(c.url).includes('relay.example')), 'not one request left via the relay');
  });

  it('switches to GET through the relay on a non-JSON 405 (R12)', async () => {
    installFetch((n) => (n === 1 ? noContent(405, '<html>method not allowed</html>') : json({ data: { a: 1 } })));
    const api = createAnilist({ relayPrefix: 'https://relay.example/?quest=', ...FAST });
    const data = await api.request('{ a }');
    assert.deepEqual(data, { a: 1 });
    assert.equal(api.stats.relay_used, true);
    assert.equal(calls[1].init.method, 'GET');
    assert.match(calls[1].url, /^https:\/\/relay\.example\/\?quest=https/);
  });

  it('gives up on a GraphQL error without retrying it', async () => {
    installFetch(() => json({ errors: [{ message: 'bad query' }] }));
    const api = createAnilist({ ...FAST });
    await assert.rejects(() => api.request('{ nonsense }'), /GraphQL error/);
    assert.equal(calls.length, 1, 'a malformed document is not a rate problem');
  });

  it('honours Retry-After on a 429', async () => {
    installFetch((n) => (n === 1 ? noContent(429, '', { 'retry-after': '1' }) : EMPTY_PAGE()));
    const api = createAnilist({ ...FAST });
    const at = Date.now();
    await api.request('{ a }');
    assert.ok(Date.now() - at >= 1000, 'waited out the stated retry-after');
    assert.equal(api.stats.s429, 1);
    assert.ok(api.interval > 20, 'a 429 also widened the learned interval (R4)');
  });
});

describe('3. budget and batching', () => {
  it('stops the run when the daily budget is spent (R7)', async () => {
    installFetch(EMPTY_PAGE);
    let left = 2;
    const api = createAnilist({ reserve: async () => left-- > 0, ...FAST });
    await api.request('{ a }');
    await api.request('{ b }');
    await assert.rejects(() => api.request('{ c }'), BudgetExhausted);
    assert.equal(calls.length, 2);
  });

  it('packs 25 aliased lookups into one request (R3)', async () => {
    installFetch(() => json({ data: { m0: { id: 1 } } }));
    const api = createAnilist({ ...FAST });
    await api.mediaByIds(Array.from({ length: 50 }, (_, i) => i + 1));
    assert.equal(calls.length, 2, 'fifty titles cost two requests, not fifty');
    const body = JSON.parse(calls[0].init.body);
    assert.equal((body.query.match(/Media\(id:/g) ?? []).length, 25);
    assert.match(body.query, /^{ m0: Media\(id: 1\)/);
  });

  it('refuses to interpolate anything that is not an integer id', async () => {
    installFetch(EMPTY_PAGE);
    const api = createAnilist({ ...FAST });
    await assert.rejects(() => api.mediaByIds(['1) } } malicious']), /non-negative integer/);
    assert.equal(calls.length, 0, 'the document never left the process');
    await assert.rejects(() => api.pageIds({ sort: 'DROP' }), /unsupported sort/);
  });

  it('sends a descriptive User-Agent on every request (R13)', async () => {
    const seen = installFetch(EMPTY_PAGE);
    const api = createAnilist({ ...FAST });
    await api.request('{ a }');
    assert.match(seen[0].init.headers['user-agent'], /AniHubStream.*contact/);
  });

  it('formats pageIds query with pagination on Page and type filter on media', async () => {
    const seen = installFetch(() => json({
      data: {
        Page: {
          pageInfo: { hasNextPage: false },
          media: [{ id: 101 }, { id: 202 }, { id: 303 }],
        },
      },
    }));
    const api = createAnilist({ ...FAST });
    const result = await api.pageIds({ page: 1, perPage: 10, sort: 'TRENDING_DESC' });

    assert.deepEqual(result, { ids: [101, 202, 303], hasNextPage: false });
    assert.equal(seen.length, 1);
    const body = JSON.parse(seen[0].init.body);
    // Page must have pagination arguments (page, perPage) and NO type argument
    assert.match(body.query, /Page\(page:\s*1,\s*perPage:\s*10\)/);
    assert.doesNotMatch(body.query, /Page\([^)]*type:/);
    // media must have type: ANIME filter
    assert.match(body.query, /media\(sort:\s*TRENDING_DESC,\s*type:\s*ANIME,\s*isAdult:\s*false\)/);

    // Verify trendingRanks correctly transforms the response into a 1-based rank map
    const ranks = await trendingRanks(api, 10);
    assert.equal(ranks.get(101), 1);
    assert.equal(ranks.get(202), 2);
    assert.equal(ranks.get(303), 3);
    assert.equal(ranks.get(999), undefined);
  });
});

describe('4. D1 write chunking (R14)', () => {
  beforeEach(() => {
    process.env.CF_ACCOUNT_ID = 'acct';
    process.env.CF_DATABASE_ID = 'db';
    process.env.CF_API_TOKEN = 'token';
  });

  it('fits 90 bound parameters into 3 rows of a 25-column table', () => {
    assert.equal(rowsPerStatement(25), 3);
    assert.equal(rowsPerStatement(3), 30);
  });

  it('writes multi-row upserts and binds every value in order', async () => {
    const seen = installFetch(() => json({ success: true, result: { results: [], meta: { changes: 1 } } }));
    const columns = ['id', 'title', 'year'];
    const rows = Array.from({ length: 40 }, (_, i) => [`t${i}`, `Title ${i}`, 2000 + i]);
    const statements = await insertRows({ table: 'anime', columns, rows, conflictTarget: ['id'], update: ['title', 'year'] });
    assert.ok(statements > 1, `expected chunking, got ${statements} statement(s)`);
    const sql = JSON.parse(seen[0].init.body).sql;
    assert.match(sql, /^INSERT INTO anime \(id,title,year\) VALUES \(\?,\?,\?\)/);
    assert.match(sql, /ON CONFLICT \(id\) DO UPDATE SET title=excluded\.title, year=excluded\.year$/);
    const bound = seen.reduce((n, c) => n + JSON.parse(c.init.body).params.length, 0);
    assert.equal(bound, 120, 'no row lost or duplicated across chunks');
    assert.deepEqual(JSON.parse(seen[0].init.body).params.slice(0, 3), ['t0', 'Title 0', 2000]);
  });

  it('rejects an update column that is not part of the insert list', async () => {
    installFetch(() => json({ success: true, result: {} }));
    await assert.rejects(() => insertRows({ table: 'anime', columns: ['id'], rows: [['a']], conflictTarget: ['id'], update: ['title'] }), /not in the insert list/);
  });

  it('merges a JSON column in SQLite rather than overwriting it', async () => {
    const seen = installFetch(() => json({ success: true, result: { results: [], meta: {} } }));
    await insertRows({
      table: 'anime', columns: ['id', 'source_ids'], rows: [['a', '{"anilist":1}']],
      conflictTarget: ['id'], update: ['source_ids'], jsonMerge: ['source_ids'],
    });
    const body = JSON.parse(seen[0].init.body);
    /* R2: the COALESCE is not decoration. json_patch(NULL, x) is NULL, so without it the first
       merge onto a row whose provenance has never been written would wipe it to NULL. */
    assert.match(body.sql, /source_ids = CASE WHEN json_valid\(COALESCE\(anime\.source_ids, '\{\}'\)\) THEN json_patch\(COALESCE\(anime\.source_ids, '\{\}'\), excluded\.source_ids\) ELSE excluded\.source_ids END/);
    assert.equal(body.params.length, 2, 'the merge adds no bound parameters');
  });

  it('rejects a jsonMerge column it was not asked to update', async () => {
    installFetch(() => json({ success: true, result: {} }));
    await assert.rejects(
      () => insertRows({ table: 'anime', columns: ['id', 'source_ids'], rows: [['a', '{}']], conflictTarget: ['id'], update: ['source_ids'], jsonMerge: ['id'] }),
      /jsonMerge column 'id' is not in the update list/,
    );
  });

  it('keeps the stored value only when the new one is actually absent', async () => {
    const seen = installFetch(() => json({ success: true, result: { results: [], meta: {} } }));
    await insertRows({
      table: 'anime', columns: ['id', 'rating', 'episode_total'], rows: [['a', 0, null]],
      conflictTarget: ['id'], update: ['rating', 'episode_total'], keepExisting: ['rating', 'episode_total'],
    });
    /* R1: NULL alone. A hasOwn test or a falsy test would both be wrong here — AniList returns
       explicit JSON null for a field it was asked about but does not have, while 0 is a real
       episode count and a real score. cloud-sync.test.mjs T3 proves it against SQLite. */
    assert.match(JSON.parse(seen[0].init.body).sql, /rating = CASE WHEN excluded\.rating IS NULL THEN anime\.rating ELSE excluded\.rating END/);
    assert.doesNotMatch(JSON.parse(seen[0].init.body).sql, /OR excluded\.rating = 0/, '0 must be writable');
  });

  it('refuses a column under two merge strategies at once', async () => {
    installFetch(() => json({ success: true, result: {} }));
    await assert.rejects(
      () => insertRows({ table: 'anime', columns: ['id', 'source_ids'], rows: [['a', '{}']], conflictTarget: ['id'], update: ['source_ids'], jsonMerge: ['source_ids'], keepExisting: ['source_ids'] }),
      /'source_ids' is named by two write strategies/,
    );
    /* The fill is the third strategy, and a column cannot be both "keep the stored value when we
       have none" and "only fill a hole in a row nobody stamped" — which one wins would be the
       order of two CASE branches, i.e. nothing an operator can read out of the statement. */
    await assert.rejects(
      () => insertRows({ table: 'anime', columns: ['id', 'sched_day'], rows: [[1, 3]], conflictTarget: ['id'], update: ['sched_day'], keepExisting: ['sched_day'], fillIf: { columns: ['sched_day'], when: 'anime.catalogue_synced_at IS NULL' } }),
      /'sched_day' is named by two write strategies/,
    );
    /* A fill with no predicate is an unconditional overwrite wearing the name of one. */
    await assert.rejects(
      () => insertRows({ table: 'anime', columns: ['id', 'sched_day'], rows: [[1, 3]], conflictTarget: ['id'], update: ['sched_day'], fillIf: { columns: ['sched_day'], when: '' } }),
      /fillIf\.columns without a when predicate/,
    );
  });
});

describe('5. column ownership by mode (checklist: old task and cloud must not fight)', () => {
  const media = (id, english, extra = {}) => ({
    id,
    title: { english },
    format: 'TV',
    status: 'RELEASING',
    averageScore: 80,
    season: 'FALL',
    seasonYear: 2024,
    coverImage: { large: 'https://art/poster.jpg', color: '#112233' },
    description: '<p>Body</p>',
    genres: ['Action', 'Sci-Fi'],
    ...extra,
  });
  const held = (anilistId) => ({
    sourceIds: anilistId ? { anilist: anilistId } : {},
    skipKeyId: 7,
    skipKeySpace: 'anilist',
    addedAt: '2026-01-01 00:00:00',
    rank: 12,
    altSeasons: null,
    catalogueSyncedAt: null,
    genreCount: 0,
  });

  it('mirror and delta overwrite exactly the same columns', () => {
    assert.deepEqual(updateSet('mirror'), updateSet('delta'),
      'delta differs from mirror only in what it may INSERT — that is what the stamps prove');
    for (const c of SCHED_COLUMNS) assert.ok(!updateSet('mirror').includes(c), `${c} belongs to tools/hourly-refresh.mjs`);
    for (const c of ['art', 'source_ids', 'search_text']) assert.ok(updateSet('mirror').includes(c));
  });

  it('the schedule fill adds only the air-slot columns, and only to the modes that do not own them', () => {
    /* CLOUD_OWNS_SCHEDULE=1 is a fill, not a claim: the update list grows by exactly the five
       sched_* columns, trend_rank stays out (it is a position in a list, not a hole), and
       takeover — which already owns all of them — is unchanged by the switch. */
    for (const mode of ['mirror', 'delta']) {
      const filled = updateSet(mode, { fillSchedule: true });
      assert.deepEqual(filled.filter((c) => SCHED_COLUMNS.includes(c)).sort(), [...SCHED_COLUMNS].sort(), `${mode}: the fill must reach every sched_ column`);
      assert.ok(!filled.includes('trend_rank'), `${mode}: the fill does not claim trend_rank`);
      assert.deepEqual(filled.filter((c) => !SCHED_COLUMNS.includes(c)), updateSet(mode), `${mode}: the fill added something besides the air slot`);
    }
    assert.deepEqual(updateSet('takeover', { fillSchedule: true }), updateSet('takeover'), 'takeover already owns the shelf');
    /* The default argument is Phase 1, so a caller that forgets the mode cannot get takeover's
       write set by accident — the same value resolveMode() lands on when nothing is set. */
    assert.deepEqual(updateSet(), updateSet(MODES[0]), 'the default is the first mode, mirror');
    assert.equal(MODE_DEFAULT, 'mirror');
    /* What the guard around the fill says, in the SQL it is written into: a row the local tools
       stamped, or one that already has any part of a slot, is not eligible. */
    for (const c of SCHED_COLUMNS) assert.match(SCHED_FILL_GUARD, new RegExp(`anime\\.${c} IS NULL`));
    assert.match(SCHED_FILL_GUARD, /anime\.catalogue_synced_at IS NULL/);
  });

  it('takeover is the only mode that claims the legacy columns', () => {
    const taken = updateSet('takeover');
    assert.deepEqual(taken.filter((c) => LEGACY_OWNED.includes(c)).sort(), [...LEGACY_OWNED].sort());
    assert.deepEqual([...updateSet('mirror'), ...LEGACY_OWNED.filter((c) => !updateSet('mirror').includes(c))].sort(), taken.sort());
  });

  it('rejects an unknown mode rather than guessing one', () => {
    assert.throws(() => updateSet('yolo'), /unknown mode/);
  });

  it('never overwrites added_at, rank, alt_seasons or the skip keys, in any mode', () => {
    const forbidden = ['trend_rank', 'added_at', 'rank', 'alt_seasons', 'skip_key_id', 'skip_key_space'];
    for (const mode of MODES) {
      /* trend_rank is legitimately claimable in takeover; it must still never be *overwritten*
         by a metadata pass, so takeover's list is checked for the schedule columns only. */
      for (const c of mode === 'takeover' ? forbidden.filter((f) => f !== 'trend_rank') : forbidden) {
        assert.ok(!updateSet(mode).includes(c), `${c} overwritten in ${mode}`);
      }
    }
  });

  it('mirror refuses to create, delta and takeover allow it', () => {
    const orphan = [media(40, 'A Title AniList Only Knows')];
    const mirror = planRows(orphan, new Map(), { mode: 'mirror' });
    assert.deepEqual(mirror.rows, [], 'Phase 1 must never insert an anime row');
    assert.equal(mirror.skipped.length, 1);
    assert.match(mirror.skipped[0].why, /does not create rows/);
    for (const mode of ['delta', 'takeover']) {
      const plan = planRows(orphan, new Map(), { mode });
      assert.equal(plan.rows.length, 1, `${mode} should create it`);
      assert.deepEqual(plan.created, ['a-title-anilist-only-knows']);
    }
  });

  it('will not create a row that renders a broken poster', () => {
    const bare = [media(41, 'No Art Yet', { coverImage: null, bannerImage: null })];
    for (const mode of ['delta', 'takeover']) {
      const plan = planRows(bare, new Map(), { mode });
      assert.deepEqual(plan.rows, [], `${mode} inserted a tile with no artwork`);
      assert.equal(plan.skipped[0].retryable, true, 'AniList publishes art later; the queue entry must survive');
    }
  });

  it('refreshes a matching row and keeps its provenance', () => {
    const plan = planRows([media(40, 'A Title')], new Map([['a-title', held(40)]]), { mode: 'mirror' });
    assert.equal(plan.skipped.length, 0);
    const row = plan.rows[0];
    assert.equal(row.id, 'a-title');
    assert.equal(row.added_at, '2026-01-01 00:00:00', 'Just Added shelf untouched');
    assert.equal(row.rank, 12, 'curation untouched');
    assert.equal(row.skip_key_id, 7, 'skip provenance untouched');
    assert.deepEqual(JSON.parse(row.source_ids), { anilist: 40 });
    assert.equal(toTuple(row).length, ANIME_COLUMNS.length, 'one value per column');
  });

  it('refuses to move a row held under a different AniList id', () => {
    const plan = planRows([media(99, 'A Title')], new Map([['a-title', held(40)]]), { mode: 'takeover' });
    assert.deepEqual(plan.rows, []);
    assert.match(plan.skipped[0].why, /held by anilist 40/);
    assert.equal(plan.skipped[0].retryable, false, 'a collision would recur every pass; the queue has to drain');
  });

  it('still updates a row whose provenance is unreadable, without inventing one', () => {
    const plan = planRows([media(40, 'A Title')], new Map([['a-title', held(null)]]), { mode: 'mirror' });
    assert.equal(plan.rows.length, 1);
    assert.equal(JSON.parse(plan.rows[0].source_ids).anilist, 40);
  });

  it('writes the site vocabulary, never AniList enum spellings', () => {
    const row = rowFromMedia(media(40, 'A Title', { format: 'TV', status: 'RELEASING', season: 'FALL', seasonYear: 2024 }));
    assert.equal(row.kind, 'TV');
    assert.equal(row.status, 'Ongoing');
    assert.equal(row.season, 'Fall 2024');
    assert.equal(row.search_text.includes('ongoing'), true, 'search_text folds the site word');
    /* functions/api/anime/index.js:24-25 rejects anything outside these lists, and filters
       with an exact `=`, so a refreshed row must still answer the same queries. */
    const STATUSES = ['Ongoing', 'Finished', 'Upcoming'];
    const KINDS = ['TV', 'Movie', 'OVA', 'ONA', 'Special'];
    assert.ok(STATUSES.includes(row.status) && KINDS.includes(row.kind));
    const slot = airSlot(media(40, 'A', { nextAiringEpisode: { airingAt: Math.floor(Date.UTC(2026, 9, 18, 14, 0) / 1000) } }));
    assert.equal(slot.sched_season, 'Fall 2026');
    assert.equal(slot.sched_day, 7, 'Sunday is 7, as tools/hourly-refresh.mjs stores it');
    assert.equal(slot.sched_date, 'Oct 18');
  });

  it('leaves a column AniList has no word for as absent, so the stored value survives', () => {
    const cancelled = rowFromMedia(media(40, 'A Title', { status: 'CANCELLED' }), held(40));
    assert.equal(cancelled.status, null, 'CANCELLED has no tile on this site: NULL, not an invented label');
    const hiatus = rowFromMedia(media(40, 'A Title', { status: 'HIATUS' }), held(40));
    assert.equal(hiatus.search_text, null, 'a shorter fold would silently drop a query the row answers today');
  });

  it('protects every column it writes from an absent upstream value', () => {
    for (const mode of MODES) {
      for (const c of updateSet(mode)) {
        const covered = c === 'source_ids' || KEEP_WHEN_ABSENT.includes(c);
        /* cloud_synced_at is the one column that is always a number this run produced, so it is
           neither merged nor kept — it is the proof of the write itself. */
        assert.ok(covered || LEGACY_OWNED.includes(c) || c === 'cloud_synced_at',
          `${c} would be blanked when AniList has no value`);
      }
    }
    /* The exception has to stay an exception: a finished title's slot must be clearable, and a
       title that left the trending list must not keep a stale rank. */
    for (const c of LEGACY_OWNED) assert.ok(!KEEP_WHEN_ABSENT.includes(c), `${c} must be clearable`);
    assert.ok(!KEEP_WHEN_ABSENT.includes('cloud_synced_at'), 'the stamp is always written');
  });

  it('never hands a NOT NULL column to SQLite as NULL, and keeps the stored value when it can', () => {
    /* The rule that the IS-NULL CASE alone cannot give: SQLite checks an INSERT ... ON CONFLICT's
       VALUES against the table's constraints before the DO UPDATE runs, so one absent score fails
       the whole chunked statement for every row in it. A refresh therefore writes a complete
       record, filled from the row it read — the same reason tools/sync-catalogue.mjs reads before
       it writes. */
    const prior = {
      ...held(40),
      stored: {
        title: 'Stored Title', native: 'スト', year: 2020, rating: 0, season: 'Spring 2020',
        kind: 'OVA', status: 'Ongoing', art: 'art/p.jpg', key_art: 'art/k.jpg', accent: '#123456',
        synopsis: 'Stored body',
      },
    };
    /* AniList answering nothing that the table requires: no score, no art, no colour, no
       description, no format, and a status the site has no word for. */
    const bare = media(40, 'A Title', {
      format: null, status: 'CANCELLED', averageScore: null, season: null, seasonYear: null,
      coverImage: null, description: null, startDate: null,
    });
    const row = rowFromMedia(bare, prior);
    assert.equal(row.rating, null, 'rowFromMedia keeps its contract: NULL means absent');
    const completed = completeFromStored(row, prior);
    for (const c of NOT_NULL_KEPT) assert.notEqual(completed[c], null, `${c} would fail the NOT NULL check`);
    assert.equal(completed.status, 'Ongoing', 'the stored status is kept rather than invented');
    assert.equal(completed.rating, 0, 'a stored 0 is a value, not an absent one');
    assert.equal(completed.year, 2020);
    assert.equal(completed.art, 'art/p.jpg');
    assert.equal(completed.accent, '#123456', 'a kept colour beats a repainted tile');
    assert.match(completed.search_text, /ova ongoing/, 'the fold is rebuilt from the columns actually written');
    /* A creation is already complete: it takes the site's sentinels, not a stored row. */
    for (const c of NOT_NULL_KEPT) assert.notEqual(rowFromMedia(bare, null)[c], null, `${c} on a new row`);
  });

  it('MODE is derived from the two phase switches, and refuses to contradict them', () => {
    assert.equal(resolveMode({ LEGACY_WRITER_ACTIVE: '1', CLOUD_CREATES_ROWS: '0' }), 'mirror');
    assert.equal(resolveMode({ LEGACY_WRITER_ACTIVE: '1', CLOUD_CREATES_ROWS: '1' }), 'delta');
    assert.equal(resolveMode({ LEGACY_WRITER_ACTIVE: '0', CLOUD_CREATES_ROWS: '1' }), 'takeover');
    assert.equal(resolveMode({}), 'mirror', 'the safe default when nothing is configured');
    assert.equal(resolveMode({ MODE: 'takeover' }), 'takeover', 'MODE alone is enough');
    assert.throws(() => resolveMode({ MODE: 'takeover', LEGACY_WRITER_ACTIVE: '1', CLOUD_CREATES_ROWS: '1' }), /contradicts/);
    assert.throws(() => resolveMode({ MODE: 'sideways' }), /not one of/);
    /* Every way the switches can disagree, including the two that would otherwise silently pick a
       different phase from the one the operator typed. */
    assert.throws(() => resolveMode({ MODE: 'mirror', CLOUD_CREATES_ROWS: '1' }), /contradicts/, 'mirror that may create rows is not mirror');
    assert.throws(() => resolveMode({ MODE: 'delta', LEGACY_WRITER_ACTIVE: '0' }), /contradicts/, 'delta with the task off is takeover');
    assert.throws(() => resolveMode({ MODE: 'takeover', LEGACY_WRITER_ACTIVE: '0' }), /contradicts/);
    assert.throws(() => resolveMode({ LEGACY_WRITER_ACTIVE: '0', CLOUD_CREATES_ROWS: '0' }), /gives nobody the sched_\* columns/, 'a reported-stopped task plus a mode that leaves its columns unwritten');
    assert.throws(() => resolveMode({ MODE: 'mirror', LEGACY_WRITER_ACTIVE: '0' }), /gives nobody the sched_\* columns/);
    /* Unset is not "stopped": the default is that the task is enabled, so the orphan guard only
       fires when an operator actually typed 0. */
    assert.equal(resolveMode({ CLOUD_CREATES_ROWS: '0' }), 'mirror');
    /* The escape hatch names itself in the refusal, because it is the fix for the one case where
       the state is real rather than a typo: the task broke and takeover is not today's decision. */
    assert.match((() => { try { resolveMode({ LEGACY_WRITER_ACTIVE: '0', CLOUD_CREATES_ROWS: '0' }); } catch (err) { return err.message; } })(), /CLOUD_OWNS_SCHEDULE=1/);
  });

  /* The switch values are read as exactly 0 or 1, and anything else refuses to start. This is
     not pedantry: `gh variable set NAME --body '{"value":"1"}'` — copied from a `gh api` example,
     and --body takes a literal string — stores that JSON text as the value. Coerced, it is NaN,
     and NaN answers to whichever comparison the parser happens to use: `value !== '0'` reads it as
     "the local task is still running" (safe, wrong), `value === '1'` reads it as "this run may
     create rows" (the reverse). Guessing is what cannot be allowed here, because the two switches
     decide who owns `sched_*` — so the run stops, names the variable, and quotes the command that
     stored the bad value. */
  it('refuses a phase switch that is not exactly 0 or 1, rather than guessing which one it meant', () => {
    /* '' is what a workflow sends for an unset repo Variable: default, not a parse failure. */
    assert.equal(resolveMode({ LEGACY_WRITER_ACTIVE: '', CLOUD_CREATES_ROWS: '' }), 'mirror');
    assert.equal(resolveMode({ LEGACY_WRITER_ACTIVE: ' 1 ', CLOUD_CREATES_ROWS: ' 0' }), 'mirror', 'surrounding space is not a different value');
    for (const bad of ['{"value":"1"}', 'true', 'yes', '2', '01', 'inactive', '0.0']) {
      assert.throws(() => resolveMode({ LEGACY_WRITER_ACTIVE: bad }), /must be exactly 0 or 1/, `${bad} was accepted`);
      assert.throws(() => resolveMode({ CLOUD_CREATES_ROWS: bad }), /must be exactly 0 or 1/, `${bad} was accepted`);
      for (const name of ['CLOUD_OWNS_GENRES', 'CLOUD_OWNS_SCHEDULE']) {
        assert.throws(() => flagEnv({ [name]: bad }, name, { dflt: false }), /must be exactly 0 or 1/, `${name}: ${bad} was accepted`);
      }
    }
    assert.equal(flagEnv({ CLOUD_OWNS_GENRES: '1' }, 'CLOUD_OWNS_GENRES', { dflt: false }), true);
    assert.equal(flagEnv({}, 'CLOUD_OWNS_GENRES', { dflt: false }), false, 'unset takes the documented default');
    assert.equal(flagEnv({}, 'CLOUD_OWNS_SCHEDULE', { dflt: false }), false, 'the fill is off unless an operator asks for it');
    /* The fill is deliberately NOT part of the mode derivation: turning it on must not be able to
       change which columns the run believes it owns, only whether it may fill a hole in a row
       nobody has stamped. */
    assert.equal(resolveMode({ CLOUD_OWNS_SCHEDULE: '1' }), 'mirror');
    /* The premise of the whole case: a coerced JSON body reads as NaN, which is falsy, which an
       `if (!value)` parser would report as "the switch is off". */
    assert.ok(!Number('{"value":"1"}'), 'Number() of the JSON body should be NaN so the falsy-off story holds');
    /* And the message has to name the command that caused it, because that is the next thing the
       operator will run. */
    let message = '';
    try { resolveMode({ CLOUD_CREATES_ROWS: '{"value":"1"}' }); } catch (err) { message = err.message; }
    assert.match(message, /gh variable set CLOUD_CREATES_ROWS --body/);
  });

  it('maps AniList genre labels onto the site genre ids and reports the rest', () => {
    const index = genreIndex([
      { id: 'action', label: 'Action' },
      { id: 'sci-fi', label: 'Sci-Fi' },
      { id: 'slice-of-life', label: 'Slice of Life' },
    ]);
    const mapped = mapGenres(['Action', 'Sci-Fi', 'Psychological', 'Action'], index);
    assert.deepEqual(mapped.ids, ['action', 'sci-fi'], 'deduplicated, and only ids that exist');
    assert.deepEqual(mapped.unmapped, ['Psychological'], 'reported, never invented: genre.id is a FK');
    assert.deepEqual(mapGenres(null, index), { ids: [], unmapped: [] });
  });
});

/* AniList answers some failures as HTTP 200 with a populated `errors` array, so the status code
   cannot separate a hiccup from a rejection and the old code treated every one of them as
   permanent. That was right for a malformed document and wrong for the two shapes below: a
   transient message lost a batch for no reason, and a complexity rejection lost 25 titles until
   the rewalk — a gap that looks like missing data rather than like a bug. */
describe('6. GraphQL-level errors: transient retries, complexity bisects, malformed stays fatal', () => {
  const err = (message) => json({ errors: [{ message }] });
  /** A successful aliased response for however many aliases the document actually asked for. */
  const answerAliases = (init) => {
    const document = JSON.parse(init.body).query;
    const aliases = [...document.matchAll(/m(\d+): Media\(id: (\d+)\)/g)];
    return json({ data: Object.fromEntries(aliases.map(([, n, id]) => [`m${n}`, { id: Number(id), titleRo: `t${id}` }])) });
  };

  it('tells a rate hiccup apart from a complexity rejection, and both from a bad query', () => {
    assert.equal(classifyGraphQLError([{ message: 'Too many requests' }]), 'transient');
    assert.equal(classifyGraphQLError([{ message: 'Something went wrong' }]), 'fatal', 'an unrecognised message keeps the old single-send behaviour rather than inventing a retry');
    /* The ordering this whole test exists to pin: "Too many requests" contains "too many", which a
       complexity pattern would also match, and mis-classifying it turns one rejection into 2N
       requests aimed at an API that just asked for fewer. */
    assert.equal(classifyGraphQLError([{ message: 'Query has complexity of 762, which exceeds max complexity of 500' }]), 'complexity');
    assert.equal(classifyGraphQLError([{ message: "Field 'nonsense' doesn't exist on type 'Query'" }]), 'fatal');
    assert.equal(classifyGraphQLError(null), 'fatal');
  });

  it('retries a transient GraphQL error and returns the data on the next attempt', async () => {
    installFetch((n) => (n === 1 ? err('Too many requests') : answerAliases(calls[0].init)));
    const api = createAnilist({ ...FAST, minIntervalMs: 20 });
    const out = await api.mediaByIds([1, 2, 3]);
    assert.deepEqual(out.map((m) => m.id), [1, 2, 3]);
    assert.equal(calls.length, 2, 'one retry, not a storm');
    assert.equal(api.stats.backoffs, 1, 'the retry is accounted like any other backoff');
  });

  it('splits a complexity rejection down rather than losing the batch', async () => {
    /* Five titles, batch of 4: the whole batch is rejected, then 2 + 2 answer, and the fifth is a
       batch of its own. Four requests for five titles, where the old code sent one and returned
       nothing. */
    installFetch((n, url, init) => {
      const aliases = [...String(init.body).matchAll(/m\d+: Media/g)].length;
      return aliases > 2 ? err('Query has complexity of 762, which exceeds max complexity of 500') : answerAliases(init);
    });
    const api = createAnilist({ ...FAST, batchSize: 4 });
    const out = await api.mediaByIds([1, 2, 3, 4, 5]);
    assert.deepEqual(out.map((m) => m.id).sort((a, b) => a - b), [1, 2, 3, 4, 5], 'the batch is recovered, not dropped');
    assert.equal(api.stats.bisects, 1);
    assert.equal(calls.length, 4, `expected 1 rejected + 2 halves + 1 single, got ${calls.length}`);
    /* Each half goes through the same limiter, so the recovery is paced and budgeted. */
    assert.equal(api.stats.requests, 4);
  });

  it('stops bisecting at one title and reports it, instead of recursing forever', async () => {
    installFetch(() => err('Query has complexity of 762, which exceeds max complexity of 500'));
    const api = createAnilist({ ...FAST, batchSize: 4 });
    await assert.rejects(() => api.mediaByIds([1, 2, 3, 4]), QueryTooComplex);
    /* 4 fails, 2 fails, 1 fails and rethrows: three sends and it is out. The throw propagates, so
       the right half of each split is never attempted — deliberate. A single title whose own
       document is rejected is not a problem this run can fix by asking again, and reporting it
       costs the remaining titles their rewalk rather than their silence. */
    assert.equal(calls.length, 3, `bisecting did not terminate: ${calls.length} requests`);
    assert.equal(api.stats.bisects, 2);
  });

  it('still refuses to retry a malformed document, from inside a batch or on its own', async () => {
    installFetch(() => err("Field 'nonsense' doesn't exist on type 'Query'"));
    const api = createAnilist({ ...FAST });
    await assert.rejects(() => api.request('{ nonsense }'), /GraphQL error/);
    await assert.rejects(() => api.mediaByIds([1, 2, 3]), /GraphQL error/);
    assert.equal(calls.length, 2, 'a document that is simply wrong is sent once each, and no more');
    assert.equal(api.stats.backoffs, 0, 'retrying it would spend budget and worsen the learned interval');
  });
});

afterEach(() => { delete globalThis.fetch; });
