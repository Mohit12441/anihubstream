// Everything the rate limiter needs to remember between runs, kept in D1 because a
// cloud run has no filesystem that outlives it. Rate-control relevance: this is where
// R4's learned interval, R7's daily budget and R8's lease live. If any of it were
// in-memory, every cron tick would start fresh at the fastest permitted setting, which
// is exactly the behaviour that gets a shared IP blocked.
//
// Bookkeeping rows go in the repo's existing sync_meta(key, value) table under 'cloud_'
// prefixed keys, so they cannot collide with the 'hourly_sync' and 'discovery' records
// the operator task maintains.

import { d1All, d1First, d1Query } from './d1.mjs';

const TTL_MS = Number(process.env.SYNC_LEASE_TTL_MS ?? 20 * 60 * 1000);
const RENEW_EVERY = Number(process.env.SYNC_LEASE_RENEW_REQUESTS ?? 10);

export const utcDay = (at = new Date()) => at.toISOString().slice(0, 10);

/* ---------------------------------------------------------------- lease (R8) */

/**
 * Takes the lock only if it is absent or expired, in one statement, then verifies the
 * owner we just wrote. Returns false when a live lease is held elsewhere.
 *
 * The check and the write are one statement, but two racing writers can still both see
 * an expired lease; the CI job's concurrency group is what closes that gap in practice,
 * so run one scheduled job per endpoint and do not disable it.
 */
export async function acquireLease(name, owner, { ttlMs = TTL_MS } = {}) {
  const now = Date.now();
  await d1Query(`INSERT INTO sync_lock (name, owner, expires_at) VALUES (?1, ?2, ?3)
    ON CONFLICT(name) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at
    WHERE sync_lock.expires_at < ?4`, [name, owner, now + ttlMs, now]);
  const row = await d1First('SELECT owner FROM sync_lock WHERE name = ?1', [name]);
  return row?.owner === owner;
}

export const releaseLease = (name, owner) =>
  d1Query('DELETE FROM sync_lock WHERE name = ?1 AND owner = ?2', [name, owner]);

/**
 * Renewal is owner-scoped, so a run whose lease was taken by someone else learns it
 * immediately instead of writing over the new holder. Throw on loss: continuing would
 * mean two writers pacing each other, which is the failure R8 exists to prevent.
 */
export async function renewLease(name, owner, { ttlMs = TTL_MS } = {}) {
  const { meta } = await d1Query('UPDATE sync_lock SET expires_at = ?1 WHERE name = ?2 AND owner = ?3', [
    Date.now() + ttlMs, name, owner,
  ]);
  if (!meta.changes) throw new Error(`lease '${name}' was taken from ${owner}`);
}

/** Wraps the every-N-requests renewal in R8. Call after each outbound request. */
export const leaseKeeper = (name, owner) => {
  let since = 0;
  return async () => {
    since++;
    if (since >= RENEW_EVERY) { since = 0; await renewLease(name, owner); }
  };
};

/* ------------------------------------------------------- throttle state (R4) */

export async function getThrottle(key) {
  const row = await d1First('SELECT value FROM sync_meta WHERE key = ?1', [key]);
  if (!row) return null;
  try {
    const v = JSON.parse(row.value);
    return Number.isFinite(v.ms) ? v : null;
  } catch {
    return null;
  }
}

export const setThrottle = (key, state) =>
  d1Query(`INSERT INTO sync_meta (key, value) VALUES (?1, ?2)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, JSON.stringify(state)]);

/* --------------------------------------------------------- cursor state (R9) */

export async function getCursor(key) {
  const row = await d1First('SELECT value FROM sync_meta WHERE key = ?1', [key]);
  if (!row) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return null;
  }
}

export const setCursor = (key, cursor) =>
  d1Query(`INSERT INTO sync_meta (key, value) VALUES (?1, ?2)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, JSON.stringify(cursor)]);

/* ---------------------------------------------------------- daily budget (R7) */

/** Counts a request before it is made, so a crash mid-request still spends the budget. */
export const spend = (endpoint, day = utcDay()) =>
  d1Query(`INSERT INTO api_usage (day, endpoint, requests) VALUES (?1, ?2, 1)
    ON CONFLICT(day, endpoint) DO UPDATE SET requests = requests + 1`, [day, endpoint]);

export async function used(endpoint, day = utcDay()) {
  const row = await d1First('SELECT requests FROM api_usage WHERE day = ?1 AND endpoint = ?2', [day, endpoint]);
  return row?.requests ?? 0;
}

/**
 * Re-reads the D1 total every `checkEvery` spends rather than once per request: the
 * running total we add to is exact for our own writes, and the periodic read folds in
 * whatever other runners recorded. The ceiling is checked before every spend, so the
 * only way to overshoot is a concurrent writer that spends between our read and ours —
 * bounded by `checkEvery`, and the lease in R8 is what makes it zero in practice.
 */
export const budget = (endpoint, limit, { day = utcDay(), checkEvery = 25 } = {}) => {
  let total = null;
  let sinceRead = 0;
  const sync = async () => { total = await used(endpoint, day); sinceRead = 0; };
  return {
    async reserve() {
      if (total === null || sinceRead >= checkEvery) await sync();
      if (total + 1 > limit) return false;
      await spend(endpoint, day);
      total++;
      sinceRead++;
      return true;
    },
    get spent() { return sinceRead; },
    async remaining() {
      if (total === null) await sync();
      return Math.max(0, limit - total);
    },
  };
};

/* ------------------------------------------------------------ run records (R15) */

export const recordRun = (arg1, arg2, arg3) => {
  let runId, endpoint, startedAt, durationMs, exitReason, summary;
  if (typeof arg1 === 'object' && arg1 !== null && !Array.isArray(arg1)) {
    ({ runId, endpoint, startedAt, durationMs, exitReason, summary } = arg1);
  } else {
    runId = String(arg1 || 'run');
    endpoint = runId.split('-')[0] || runId;
    startedAt = typeof arg2 === 'number' ? arg2 : Date.now();
    durationMs = Date.now() - startedAt;
    summary = arg3 || {};
    exitReason = summary?.status || summary?.exit_reason || 'ok';
  }
  return d1Query(`INSERT INTO sync_runs (run_id, endpoint, started_at, duration_ms, exit_reason, summary)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    ON CONFLICT(run_id) DO UPDATE SET duration_ms = excluded.duration_ms, exit_reason = excluded.exit_reason, summary = excluded.summary`, [
    runId || String(Date.now()), endpoint || 'sync', startedAt || Date.now(), durationMs || 0, exitReason || 'ok', JSON.stringify(summary || {}),
  ]);
};

/** The most recent runs, for the health check and for post-mortems. */
export const recentRuns = (endpoint, limit = 10) =>
  d1All('SELECT run_id, started_at, duration_ms, exit_reason, summary FROM sync_runs WHERE endpoint = ?1 ORDER BY started_at DESC LIMIT ?2', [endpoint, limit]);
