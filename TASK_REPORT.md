# DevFlow Project Audit & Remediation Report: AniHubStream

**Date:** 2026-10-31  
**Pre-DevFlow Checkpoint Commit Hash:** `54d0b51`  
**Baseline Commit Hash:** `63fe6ab2626e2a225ee4b0c74828f7312aa219fb` (`63fe6ab`)  
**Branch:** `agent-workflow-baseline`  
**Standard:** Enterprise Agent Framework (EAF) & DevFlow Autonomous Protocol  

---

## 1. Executive Summary

A comprehensive architectural inspection and surgical remediation were executed on **AniHubStream** under the DevFlow protocol. All identified high-priority bugs, Zero-Read D1 cache law violations, and portability defects were repaired and verified deterministically:

1. **Zero-Read D1 Edge Protection Restored:** Both `/api/anime` and `/api/stats` endpoints now utilize the `withEdgeCache` wrapper from `functions/api/_lib.js`, eliminating uncached full-table scans.
2. **Stream Bridge Implemented:** Created `api/bridge.mjs` to fulfill the documented bridge contract on port 8795 with `/health` and `/resolve` endpoints wired to provider adapters.
3. **Supervisor Portability Fixed:** `tools/supervise-origin.mjs` now resolves dynamic user home directories via `node:os` instead of hardcoded paths.
4. **GET Idempotency Restored:** Removed speculative database schema writes (`INSERT INTO anime_id_map`, `UPDATE anime`) inside `GET /api/play/resolve`, retaining ephemeral `stream_cache` storage.
5. **Architectural Separation of Concerns:** Added typed `getPlay` client in `src/data/api.ts` and eliminated direct `fetch` calls in `src/pages/Watch.tsx` and `src/pages/AnimeDetail.tsx`.

---

## 2. What Changed

### 1. Edge Layer Caching (`functions/api/anime/index.js` & `functions/api/stats/index.js`)
- **File:** [`functions/api/anime/index.js`](file:///C:/anihubstream-local/functions/api/anime/index.js)
  - Wrapped `onRequestGet` in `withEdgeCache(...)` with allowed query parameter sorting (`q`, `genre`, `season`, `status`, `kind`, `sort`, `page`, `limit`, `provider`) and 300s TTL.
- **File:** [`functions/api/stats/index.js`](file:///C:/anihubstream-local/functions/api/stats/index.js)
  - Wrapped `onRequestGet` in `withEdgeCache(...)` with 600s TTL, protecting catalog counters from thundering herds.

### 2. Stream Bridge Microservice (`api/bridge.mjs`)
- **File:** [`api/bridge.mjs`](file:///C:/anihubstream-local/api/bridge.mjs)
  - Implemented standalone Node.js HTTP server on port 8795 (`ANIKOTO_BRIDGE_PORT`).
  - Added `/health` reporting uptime and MAL gate metrics (`hits`, `misses`, `hitRatio`).
  - Added `/resolve` handler delegating to `anikoto.resolveByMal` and provider adapters in `api/adapters/registry.mjs` with session caching and proof container headers.

### 3. Tool Portability (`tools/supervise-origin.mjs`)
- **File:** [`tools/supervise-origin.mjs`](file:///C:/anihubstream-local/tools/supervise-origin.mjs)
  - Replaced hardcoded `C:\Users\My\...` paths with `os.homedir()` lookups for cross-platform and multi-user environments.

### 4. Database Schema Mutation Boundary (`functions/api/play/resolve.js`)
- **File:** [`functions/api/play/resolve.js`](file:///C:/anihubstream-local/functions/api/play/resolve.js)
  - Removed speculative `INSERT INTO anime_id_map` and `UPDATE anime` queries on unauthenticated public GET requests, adhering to HTTP GET idempotency and Rule 1. Maintained ephemeral TTL caching in `stream_cache`.

### 5. Frontend API Layer Modernization (`src/data/api.ts`, `Watch.tsx`, `AnimeDetail.tsx`)
- **File:** [`src/data/api.ts`](file:///C:/anihubstream-local/src/data/api.ts)
  - Added typed `PlayQuery`, `PlayResponse`, and `getPlay(query)` function.
- **File:** [`src/pages/Watch.tsx`](file:///C:/anihubstream-local/src/pages/Watch.tsx)
  - Refactored server list query to use `getPlay({ id, ep, audio, title, provider, malId })`.
- **File:** [`src/pages/AnimeDetail.tsx`](file:///C:/anihubstream-local/src/pages/AnimeDetail.tsx)
  - Refactored server preview query to use `getPlay({ id, ep: 1 })`.

### 6. Test Harness Adaptation (`cloud-sync/pattern-limit.test.mjs`)
- **File:** [`cloud-sync/pattern-limit.test.mjs`](file:///C:/anihubstream-local/cloud-sync/pattern-limit.test.mjs)
  - Explicitly specified `x-bypass-cache: 1` header in unit test to test low-level SQLite LIKE pattern boundaries without colliding with edge memory caches.

---

## 3. What Was Verified

All deterministic validation gates were executed and confirmed passing:

| Gate | Command | Result | Verification Notes |
|---|---|---|---|
| **TypeScript & Build** | `npm run build` | **PASSED** | 0 TypeScript errors; bundle built in 6.01s (`dist-pages/`) |
| **Zero-Read Edge Shield** | `npm run test:cache` | **PASSED** | 5/5 tests passed in 89ms (`functions/api/_lib.js`) |
| **API Subsystem Suite** | `node --test api/*.test.mjs` | **PASSED** | 203/203 tests passed across 56 suites in 3.74s |
| **Tools Subsystem Suite** | `node --test tools/*.test.mjs` | **PASSED** | 90/90 tests passed across 25 suites in 2.29s |
| **Cloud-Sync Suite** | `node --test cloud-sync/*.test.mjs` | **PASSED** | 185/185 tests passed across 32 suites in 135.2s |
| **Full Repository Test Suite** | `npm test` | **PASSED** | **478 / 478 tests passed across 113 suites** |

---

## 4. What Remains Risky

1. **Cloudflare Free-Tier Subrequest Limits in Downloader:**
   - Full video stream downloads (`functions/api/download-pipe.js`) iterate over segments inside Edge Workers. Large 1080p episodes with >50 segments will encounter subrequest limits unless handled through client-side service workers or the dedicated stream bridge.
2. **Third-Party Upstream Extraction Changes:**
   - Streaming extractors (`hianime.mjs`, `anikoto.mjs`, `aniwatch.mjs`) rely on external DOM and token patterns. If upstream providers modify their obfuscation, automated provider fallbacks will trigger until scrapers are updated.

---

## 5. Root Cause Analysis: Automatic Catalog Update Failures

An architectural investigation was conducted to determine why AniList, Kitsu, AniSkip, HiAnime, AniKoto, and AniWatch synchronizations fail to run automatically:

### 1. Inactive Background Schedulers
1. **GitHub Actions Workflow Inactive (`.github/workflows/catalog-sync.yml`):**
   - The master 9-phase sync pipeline is defined in `catalog-sync.yml` on cron `0 2,14 * * *`.
   - **Root Cause:** The repository has no configured Git remote (`git remote -v` is empty). It was never pushed to a remote GitHub repository. Consequently, GitHub Actions cron events never trigger.
2. **Missing Windows Scheduled Task:**
   - `tools/hourly-refresh.mjs` was intended to be run every 30 minutes via Windows Task Scheduler (`AniHubHourlyRefresh`).
   - Querying `schtasks /query /tn "AniHubHourlyRefresh"` reveals that the task was never registered on the operating system.
3. **Cloudflare Worker Cron Trigger Disabled:**
   - `sync-worker/wrangler.toml` explicitly removed its cron trigger because AniList's API blocks Cloudflare datacenter IP addresses with HTTP 403 (`You have been manually blocked`).

### 2. Dual Incompatible Sync Architectures
1. **Cloudflare REST Architecture (`cloud-sync/`):**
   - Requires remote Cloudflare REST credentials (`CF_ACCOUNT_ID`, `CF_DATABASE_ID`, `CF_API_TOKEN`).
   - `.env` lacks `CF_API_TOKEN`, and `package.json` scripts do not pass `--env-file=.env`. Running `npm run sync:anilist` immediately throws `missing environment: CF_API_TOKEN`.
   - These scripts cannot write directly to the local Miniflare D1 database (`.wrangler/state/v3/d1/...`).
2. **Local Direct SQLite Architecture (`tools/`):**
   - Tools like `auto-sync-episodes.mjs`, `auto-sync-franchises.mjs`, and `sync-ongoing-schedules.mjs` connect directly to local Miniflare SQLite using `node:sqlite`.
   - They function cleanly when executed manually via CLI, but have no background daemon or loop to run them automatically.

### 3. Broken Tooling Dependencies
- In `tools/hourly-refresh.mjs` line 50, `WRANGLER_JS` defaults to `join(process.env.APPDATA, 'npm', 'node_modules', 'wrangler', 'bin', 'wrangler.js')`, which does not exist on this machine, causing invocation failures.

---

## 6. Dead Code & Obsolete Artifacts Inventory

The audit identified significant dead code, obsolete scratch files, and legacy one-off scripts:

| Category | File / Path | Size | Reason for Dead/Obsolete Status |
|---|---|---|---|
| **Abandoned Worker** | `sync-worker/` | — | Cron trigger removed due to AniList 403 block; now a redundant skeleton. |
| **Scratch Scraper Dumps** | `tools/anikoto-slugs-progress.json` | 197.5 KB | Temporary progress dump from one-off 2026-10-20 scraper run. |
| **Scratch Scraper Dumps** | `tools/anikoto-slugs-review.json` | 9.3 KB | Temporary review file from 2026-10-20 scraper run. |
| **Static Data Snapshot** | `tools/anikoto-slugs.json` | 175.3 KB | Slugs already merged into `id-map-seed.sql` and D1 tables. |
| **Static Data Snapshot** | `tools/anime-titles.json` | 184.7 KB | Stale title dump from 2026-10-20. |
| **Test Build Artifacts** | `ops/github-sync-dispatcher/dist-test/` | 8.9 KB | Outdated bundled test output. |
| **One-Off Backfill Script**| `tools/backfill-anikoto-slugs.mjs` | 6.5 KB | One-time backfill script; superseded by `auto-sync-providers.mjs`. |
| **One-Off Backfill Script**| `tools/backfill-anilist-ids.mjs` | 6.0 KB | One-time ID map backfill script. |
| **One-Off Backfill Script**| `tools/backfill-search-text.mjs` | 1.9 KB | One-time search text generator; incorporated into `sync-catalogue.mjs`. |
| **One-Off Backfill Script**| `tools/apply-anikoto-slugs-d1.mjs` | 2.3 KB | One-time SQL generator for AniKoto provider slugs. |
| **Obsolete Importer** | `tools/import-local-dump.mjs` | 2.2 KB | References non-existent `anime_fts` virtual table. |
| **Abandoned Seed Gen** | `tools/gen-seed.mjs` | 3.5 KB | Superseded by `tools/sync-catalogue.mjs`. |
| **Unsupported Schema** | `tools/setup_fts5.sql` | 0.9 KB | FTS5 virtual table unsupported/disabled in standard D1 deployments. |
| **Scratch Benchmarks** | `tools/benchmark-anikoto.mjs` | 6.6 KB | One-off benchmark script not connected to test harnesses. |
| **Scratch Benchmarks** | `tools/benchmark-hianime.mjs` | 7.2 KB | One-off benchmark script. |
| **Scratch Benchmarks** | `tools/benchmark-search.mjs` | 2.3 KB | One-off benchmark script. |

