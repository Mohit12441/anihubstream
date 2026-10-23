// @ts-check
/**
 * cloud-sync/prune-maintenance.mjs
 *
 * Automated D1 Database Retention, Telemetry Log Pruning & Search Vector Self-Healing.
 * 
 * Tasks:
 * 1. Prunes `sync_runs` telemetry older than RETENTION_DAYS (default 30 days).
 * 2. Prunes `api_usage` rate counters older than RETENTION_DAYS.
 * 3. Purges expired distributed locks (`sync_lock`).
 * 4. Self-heals any missing or empty `anime.search_text` vectors so all anime remain searchable.
 * 5. Can run standalone, via GitHub Actions catalog-sync, or via Ops dispatch.
 */

import { randomUUID } from 'node:crypto';
import { d1All, d1First, d1Query } from './d1.mjs';
import { foldSearch } from '../functions/api/_lib.js';

const RUN_ID = randomUUID();

const intEnv = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive integer, got ${raw}`);
  return n;
};

export const PRUNE_RETENTION_DAYS = intEnv('PRUNE_RETENTION_DAYS', 30);

/**
 * 1. Prune sync_runs older than retention period
 */
export async function pruneSyncRuns(retentionDays = PRUNE_RETENTION_DAYS) {
  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  console.log(`[prune-maintenance] Pruning sync_runs older than ${retentionDays} days (cutoff: ${new Date(cutoffMs).toISOString()})...`);
  try {
    const res = await d1Query('DELETE FROM sync_runs WHERE started_at < ?1', [cutoffMs]);
    const deleted = res?.meta?.changes || 0;
    console.log(`[prune-maintenance] ✅ Pruned ${deleted} old sync_runs rows.`);
    return deleted;
  } catch (err) {
    console.warn('[prune-maintenance] Note on pruning sync_runs:', err.message);
    return 0;
  }
}

/**
 * 2. Prune api_usage older than retention period
 */
export async function pruneApiUsage(retentionDays = PRUNE_RETENTION_DAYS) {
  const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  console.log(`[prune-maintenance] Pruning api_usage older than ${retentionDays} days (before ${cutoffDate})...`);
  try {
    const res = await d1Query('DELETE FROM api_usage WHERE day < ?1', [cutoffDate]);
    const deleted = res?.meta?.changes || 0;
    console.log(`[prune-maintenance] ✅ Pruned ${deleted} old api_usage rows.`);
    return deleted;
  } catch (err) {
    console.warn('[prune-maintenance] Note on pruning api_usage:', err.message);
    return 0;
  }
}

/**
 * 3. Purge expired distributed leases in sync_lock
 */
export async function purgeExpiredLocks() {
  const now = Date.now();
  console.log('[prune-maintenance] Purging expired distributed leases in sync_lock...');
  try {
    const res = await d1Query('DELETE FROM sync_lock WHERE expires_at < ?1', [now]);
    const deleted = res?.meta?.changes || 0;
    console.log(`[prune-maintenance] ✅ Purged ${deleted} expired locks.`);
    return deleted;
  } catch (err) {
    console.warn('[prune-maintenance] Note on purging sync_lock:', err.message);
    return 0;
  }
}

/**
 * 4. Self-heal missing or empty search_text in anime table
 */
export async function selfHealSearchVectors() {
  console.log('[prune-maintenance] Checking for unindexed anime missing search_text...');
  let healed = 0;
  try {
    const missingRows = await d1All(`
      SELECT id, title, native, kind, status
      FROM anime
      WHERE search_text IS NULL OR search_text = ''
      LIMIT 100
    `);

    if (missingRows.length === 0) {
      console.log('[prune-maintenance] ✓ All anime have valid search_text vectors.');
      return 0;
    }

    console.log(`[prune-maintenance] Found ${missingRows.length} anime missing search_text. Self-healing...`);
    for (const r of missingRows) {
      const folded = foldSearch([r.title, r.native, r.kind, r.status].filter(Boolean).join(' '));
      await d1Query('UPDATE anime SET search_text = ?1 WHERE id = ?2', [folded, r.id]);
      healed++;
    }

    console.log(`[prune-maintenance] ✅ Successfully self-healed ${healed} search_text vectors.`);
  } catch (err) {
    console.warn('[prune-maintenance] Note on search_text self-healing:', err.message);
  }
  return healed;
}

/**
 * Run full maintenance pass
 */
export async function runMaintenancePass({ retentionDays = PRUNE_RETENTION_DAYS } = {}) {
  console.log(`[prune-maintenance] 🧹 Starting Automated D1 Maintenance Pass ${RUN_ID}...`);
  const summary = {
    prunedRuns: 0,
    prunedUsage: 0,
    purgedLocks: 0,
    healedVectors: 0,
  };

  summary.prunedRuns = await pruneSyncRuns(retentionDays);
  summary.prunedUsage = await pruneApiUsage(retentionDays);
  summary.purgedLocks = await purgeExpiredLocks();
  summary.healedVectors = await selfHealSearchVectors();

  console.log('[prune-maintenance] 🎉 Maintenance Pass Complete:', summary);
  return { status: 'success', summary };
}

// CLI execution
if (process.argv[1] && process.argv[1].endsWith('prune-maintenance.mjs')) {
  runMaintenancePass()
    .then((res) => {
      console.log('Result:', res);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
