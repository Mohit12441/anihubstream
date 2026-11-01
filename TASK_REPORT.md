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
| **Scratch Scraper Dumps** | `tools/anikoto-slugs-progress.json` | 197.5 KB | **CLEANED:** Temporary progress dump removed from workspace. |
| **Scratch Scraper Dumps** | `tools/anikoto-slugs-review.json` | 9.3 KB | **CLEANED:** Removed from Git and workspace. |
| **Static Data Snapshot** | `tools/anikoto-slugs.json` | 175.3 KB | Slugs already merged into `id-map-seed.sql` and D1 tables. |
| **Static Data Snapshot** | `tools/anime-titles.json` | 184.7 KB | **CLEANED:** Stale title dump removed from workspace. |
| **Test Build Artifacts** | `ops/github-sync-dispatcher/dist-test/` | 8.9 KB | Outdated bundled test output. |
| **One-Off Backfill Script**| `tools/backfill-anikoto-slugs.mjs` | 6.5 KB | One-time backfill script; superseded by `auto-sync-providers.mjs`. |
| **One-Off Backfill Script**| `tools/backfill-anilist-ids.mjs` | 6.0 KB | One-time ID map backfill script. |
| **One-Off Backfill Script**| `tools/backfill-search-text.mjs` | 1.9 KB | One-time search text generator; incorporated into `sync-catalogue.mjs`. |
| **One-Off Backfill Script**| `tools/apply-anikoto-slugs-d1.mjs` | 2.3 KB | One-time SQL generator for AniKoto provider slugs. |
| **Obsolete Importer** | `tools/import-local-dump.mjs` | 2.2 KB | **CLEANED:** Obsolete FTS reference removed. |
| **Abandoned Seed Gen** | `tools/gen-seed.mjs` | 3.5 KB | **CLEANED:** Superseded by `tools/sync-catalogue.mjs`. |
| **Unsupported Schema** | `tools/setup_fts5.sql` | 0.9 KB | **CLEANED:** Unsupported schema file removed. |
| **Scratch Benchmarks** | `tools/benchmark-anikoto.mjs` | 6.6 KB | One-off benchmark script not connected to test harnesses. |
| **Scratch Benchmarks** | `tools/benchmark-hianime.mjs` | 7.2 KB | One-off benchmark script. |
| **Scratch Benchmarks** | `tools/benchmark-search.mjs` | 2.3 KB | One-off benchmark script. |

---

## 7. Phase 2: Local Autonomous Sync Implementation & Verification

**Date:** 2026-11-01  
**Pre-DevFlow Checkpoint Commit Hash:** `caba835`  
**Branch:** `agent-workflow-baseline`  

### What Changed:
1. **Created Unified Local Sync Engine (`tools/local-sync-daemon.mjs`):**
   - Implemented 4-stage pipeline against local SQLite (`.wrangler/state/v3/d1/.../*.sqlite`) via `node:sqlite`:
     - **Stage 1 (Airing Schedules):** Fetches ongoing weekly schedule from AniList GraphQL and updates `airing_at`, `air_day`, `air_time`.
     - **Stage 2 (Provider Mapping & Ratings):** Normalizes 10-point scale ratings and syncs slugs across AniKoto, HiAnime, and AniWatch without remote CF REST dependency.
     - **Stage 3 (Franchise Relations Graph):** Automatically constructs prequel/sequel/side-story edges using `computeFranchiseGraph` and persists them into `franchise_relation`.
     - **Stage 4 (Episode Metadata Enrichment):** Enriches single-episode movies and fetches canonical episode titles/thumbs via batched AniList queries and AniWatch search fallback.
   - Supports single pass mode (`node tools/local-sync-daemon.mjs --once`) and daemon loop mode (`--interval=<minutes>`).
   - Persists execution heartbeats and telemetry to the `sync_meta` table.
2. **Exported Modular Franchise Functions (`tools/auto-sync-franchises.mjs`):**
   - Exported `autoSyncFranchises(db)` and `persistRelations(db, relations)` so daemon scripts can programmatically invoke relation rebuilding without child process spawns.
3. **NPM Script Integration (`package.json`):**
   - Added `"sync:local": "node tools/local-sync-daemon.mjs --once"`.
   - Added `"sync:daemon": "node tools/local-sync-daemon.mjs"`.
4. **Dead File Pruning:**
   - Deleted untracked scratch dumps (`anikoto-slugs-progress.json`, `anime-titles.json`).
   - Removed obsolete files from Git (`anikoto-slugs-review.json`, `gen-seed.mjs`, `import-local-dump.mjs`, `setup_fts5.sql`).

### What Was Verified:
1. **Live Local Sync Run (`node tools/local-sync-daemon.mjs --once`):**
   - Updated 83 anime schedules from AniList GraphQL in 21.4s.
   - Provider counts verified: AniKoto=2521, HiAnime=2591, AniWatch=452.
   - Rebuilt franchise relations graph: 1480 links indexed in 128ms.
   - Enriched 61 anime (892 total episodes) with canonical episode titles.
   - Successfully wrote execution snapshot to `sync_meta` table in local D1.
2. **TypeScript & Bundler Gate (`npm run build`):**
   - **PASSED:** 0 TypeScript compile errors. Production Pages bundle emitted in `dist-pages/`.
3. **Zero-Read Edge Shield Gate (`npm run test:cache`):**
   - **PASSED:** 5/5 zero-read caching tests passed in 120ms.
4. **Full Test Suite Gate (`npm test`):**
   - **PASSED: 478 / 478 tests passed** across 113 suites in 140s (`api/*.test.mjs`, `tools/*.test.mjs`, `cloud-sync/*.test.mjs`).

### What Remains Risky:
1. **AniList Rate Limits on Shorter Intervals:**
   - If the daemon is run with `--interval` under 15 minutes, AniList GraphQL may return HTTP 429. Default interval of 30 minutes is recommended.
2. **Shift to GitHub Actions:**
   - Before shifting to GitHub Actions (`.github/workflows/catalog-sync.yml`), the user must configure a remote Git repository (`git remote add origin <url>`) and configure Cloudflare secrets (`CF_ACCOUNT_ID`, `CF_DATABASE_ID`, `CF_API_TOKEN`) in GitHub repository secrets.

---

## 8. Phase 3: Exhaustive Sync Subsystem Testing & Verification

**Date:** 2026-11-01  
**Pre-DevFlow Checkpoint Commit Hash:** `eccd06b`  
**Branch:** `agent-workflow-baseline`  

### What Changed:
1. **Contract Harmonization Between Schedules and Daemon:**
   - Modified [`tools/sync-ongoing-schedules.mjs`](file:///C:/anihubstream-local/tools/sync-ongoing-schedules.mjs) to cleanly export `syncOngoingSchedules({ isRemote, quiet })`, returning structured execution metrics (`updated`, `cleared`, `unchanged`, `totalTitles`, `durationMs`).
   - Wired [`tools/local-sync-daemon.mjs`](file:///C:/anihubstream-local/tools/local-sync-daemon.mjs) Stage 1 directly to `syncOngoingSchedules`, ensuring `sched_day` (1=Mon ... 7=Sun), `sched_day_label`, `sched_date`, `sched_season`, and `sched_episode` adhere strictly to Edge API contracts (`functions/api/schedule.js`).
2. **Deterministic Regression Test Suite Added:**
   - Created [`tools/local-sync-daemon.test.mjs`](file:///C:/anihubstream-local/tools/local-sync-daemon.test.mjs) covering:
     - Miniflare D1 SQLite database path auto-discovery (`findSqlitePath`).
     - Async cycle executor contract (`runSyncCycle`).
     - In-memory franchise graph edge persistence into `anime_franchise_relation`.
     - 10-point rating scale normalization logic.
     - `sync_meta` heartbeat JSON serialization and storage.

### What Was Verified:
1. **Live External Upstream API Diagnostics:**
   - Probed all 6 external community & provider endpoints live:
     - **AniList GraphQL:** Status 200 (Sample: *Cowboy Bebop* in 658ms).
     - **Kitsu API:** Status 200 (Sample: *Sousou no Frieren* in 614ms).
     - **AniSkip API:** Status 200 (Marker found: `true` in 1000ms).
     - **HiAnime Scraper:** Functional (4 search hits in 775ms).
     - **AniWatch Scraper:** Functional (2 search hits in 1110ms).
     - **AniKoto Scraper:** Functional (8 search hits in 422ms).
2. **Local Autonomous Sync Run (`node tools/local-sync-daemon.mjs --once`):**
   - **Stage 1 (Schedules):** 283 ongoing anime verified; 0 stale slots, 283 unchanged (0 unnecessary D1 writes) in 9.6s.
   - **Stage 2 (Providers & Ratings):** Verified 2,521 AniKoto, 2,591 HiAnime, and 452 AniWatch active mappings.
   - **Stage 3 (Franchises):** 1,480 franchise relation links indexed in 128ms.
   - **Stage 4 (Episodes):** Enriched 62 anime (874 total episodes) in 54s.
   - **Full cycle runtime:** 64.4s, exiting cleanly with status 0 and telemetry stored in `sync_meta`.
3. **Database Consistency Verification:**
   - Total Anime: 2,787
   - Active Schedule Entries: 88
   - Franchise Relations: 1,480
   - Total Episodes: 41,166 (30,315 canonical named episodes)
4. **Deterministic Quality Gates:**
   - `npm run build`: **PASSED** (0 TypeScript errors, Vite bundle built in 7.12s).
   - `npm run test:cache`: **PASSED** (5/5 Zero-Read shield tests in 91ms).
   - `node --test tools/*.test.mjs`: **PASSED** (95/95 tests in 2.67s).
   - `node --test api/*.test.mjs`: **PASSED** (203/203 tests in 3.05s).
   - `node --test cloud-sync/sync-*.test.mjs`: **PASSED** (23/23 tests).

### What Remains Risky:
1. **Cloudflare REST Synchronization (`cloud-sync/`):**
   - The scripts in `cloud-sync/` (`sync-anilist.mjs`, `sync-hianime.mjs`, `sync-kitsu.mjs`) communicate strictly with the remote Cloudflare D1 REST API and will fail when run locally without `CF_API_TOKEN`. For all local development and offline catalog operations, `tools/local-sync-daemon.mjs` (`npm run sync:local`) must be used instead.

---

## 9. Phase 4: Catalog Growth Root Cause Analysis & Local Ingestion Engine

**Date:** 2026-11-01  
**Pre-DevFlow Checkpoint Commit Hash:** `544a336`  
**Branch:** `agent-workflow-baseline`  

### Root Cause Analysis: Why Catalog Size Stayed Static
Investigation revealed 5 precise blockers that prevented the anime catalog from increasing:
1. **Broken Global Wrangler Assumption:**
   - Both [`tools/discover-titles.mjs`](file:///C:/anihubstream-local/tools/discover-titles.mjs) and [`tools/import-backlog.mjs`](file:///C:/anihubstream-local/tools/import-backlog.mjs) hardcoded `WRANGLER_JS = resolve(process.env.APPDATA, 'npm', 'node_modules', 'wrangler', 'bin', 'wrangler.js')`. This path does not exist in standard dev setups, immediately crashing execution with `MODULE_NOT_FOUND`.
2. **Hardcoded Remote Cloudflare Flag (`--remote`):**
   - Ingestion tools exclusively executed `wrangler d1 execute anihub --remote`. Without Cloudflare production API tokens (`CF_API_TOKEN`), executions aborted with `missing environment: CF_API_TOKEN`. No fallback to local Miniflare SQLite existed.
3. **Missing Catalog Expansion Stage in Sync Daemon:**
   - [`tools/local-sync-daemon.mjs`](file:///C:/anihubstream-local/tools/local-sync-daemon.mjs) maintained 4 stages for *existing* database records (schedules, provider mappings, franchise graph, episode metadata) but lacked any stage to discover or import new anime backlog entries.
4. **808 Unimported Backlog Titles:**
   - `tools/catalogue-sources.json` contained 3,595 catalog definitions, while the local Miniflare SQLite database contained only 2,787 entries. 808 anime were defined in sources but never seeded into the active database.
5. **Missing Upstream IDs in Raw Source Entries:**
   - A subset of backlog entries in `catalogue-sources.json` had only MAL IDs without Kitsu/AniList IDs, causing unhandled HTTP 400 rejections from `sync-catalogue.mjs`.

### What Changed:
1. **Dual Local / Remote Execution in Discovery Tools:**
   - Modified [`tools/discover-titles.mjs`](file:///C:/anihubstream-local/tools/discover-titles.mjs):
     - Added `findSqlitePath()` auto-discovery.
     - Replaced fragile global `WRANGLER_JS` require with resilient child process spawning (`npx.cmd wrangler` / `npx wrangler`).
     - Added local SQLite query engine in `d1Json()` using `node:sqlite` when running without `--remote`.
     - In local mode, `discover()` directly executes generated `seed.sql` batches against Miniflare D1 SQLite and writes telemetry to `sync_meta`.
2. **Local Miniflare Ingestion Support in Import Backlog:**
   - Modified [`tools/import-backlog.mjs`](file:///C:/anihubstream-local/tools/import-backlog.mjs) to import `findSqlitePath`, support `--local` execution flag, and write imported titles directly into Miniflare SQLite.
3. **Stage 5: Catalog Growth Added to Sync Daemon:**
   - Enhanced [`tools/local-sync-daemon.mjs`](file:///C:/anihubstream-local/tools/local-sync-daemon.mjs) with `syncGrowthStage(db, { limit })`:
     - Compares unimported source IDs in `catalogue-sources.json` against `anime.id` in SQLite.
     - Filters for entries with verified Kitsu and AniList IDs (`s.kitsu && s.anilist`).
     - Calls `sync-catalogue.mjs` to fetch full canonical metadata, poster URLs, and episode lists.
     - Executes generated SQL batches atomically against local SQLite.
     - Added `--expand=<n>` CLI argument (default: 3 titles per run).
4. **Deterministic Unit Test Added:**
   - Updated [`tools/local-sync-daemon.test.mjs`](file:///C:/anihubstream-local/tools/local-sync-daemon.test.mjs) with a test verifying detection and filtering of unimported backlog titles against SQLite.

### What Was Verified:
1. **Live Local Ingestion & Catalog Growth:**
   - Executed `node tools/local-sync-daemon.mjs --once --expand=2`.
   - Ingested new backlog anime: *Why Does Nobody Remember Me in This World?* (`why-does-nobody-remember-me-in-this-world-yekf`).
   - Verified local D1 SQLite anime count increased from **2,787 to 2,788**.
2. **Deterministic Quality Gates:**
   - `npm run build`: **PASSED** (0 TypeScript errors, bundle emitted in 6.48s).
   - `npm run test:cache`: **PASSED** (5/5 Zero-Read shield tests in 98ms).
   - `node --test tools/*.test.mjs`: **PASSED** (96/96 tests in 2.94s).
   - `node --test api/*.test.mjs`: **PASSED** (203/203 tests in 4.65s).

### What Remains Risky:
1. **Third-Party Upstream Rate Limiting on Rapid Growth:**
   - Rapidly ingesting large batches of backlog titles (>50 titles per run) will trigger rate limits on Kitsu (HTTP 429) or AniList GraphQL. The default limit of 3 titles per cycle in the daemon is tuned to stay well within public rate limits.

---

## 10. Phase 5: Universal ID Mapping Ingestion (`Fribb/anime-lists`) & Backlog Unblocking

**Date:** 2026-11-01  
**Pre-DevFlow Checkpoint Commit Hash:** `119c4d8`  
**Branch:** `agent-workflow-baseline`  

### What Changed:
1. **Universal Cross-Reference Ingestion Tool (`tools/sync-fribb-id-map.mjs`):**
   - Implemented streaming and offline caching for `Fribb/anime-lists` (`anime-list-mini.json`, 39,597 cross-referenced anime).
   - Indexed MyAnimeList (30,909 entries), AniList (20,892 entries), Kitsu (22,389 entries), and AniDB (15,200+ entries) in memory.
   - Built [`resolveFribbIds`](file:///C:/anihubstream-local/tools/sync-fribb-id-map.mjs#L140-L175) to resolve any missing ID from companion provider spaces.
   - Built [`enrichCatalogueSources`](file:///C:/anihubstream-local/tools/sync-fribb-id-map.mjs#L180-L235) to backfill missing IDs in `catalogue-sources.json`.
   - Built [`populateLocalIdMap`](file:///C:/anihubstream-local/tools/sync-fribb-id-map.mjs#L240-L320) to populate `anime_id_map` for all active anime in local Miniflare D1 SQLite while respecting foreign key constraints.
2. **Backlog Catalog Sources Enriched:**
   - Out of 3,595 titles in `catalogue-sources.json`, **3,159 missing IDs were automatically enriched**.
   - Backlog ingestion readiness: **807 out of 807 unimported titles** now have verified AniList and Kitsu IDs (0 missing companion IDs).
3. **Database Population:**
   - Populated **2,788 active anime records into `anime_id_map`** in local Miniflare D1 SQLite with 100% ID coverage.
4. **Sync Daemon Auto-Mapping Extension:**
   - Modified [`tools/local-sync-daemon.mjs`](file:///C:/anihubstream-local/tools/local-sync-daemon.mjs) Stage 5 to automatically insert `anime_id_map` records when newly ingested titles are written into `anime`.
5. **NPM Script Integration:**
   - Added `"sync:fribb": "node tools/sync-fribb-id-map.mjs"` to `package.json`.
6. **Deterministic Test Suite:**
   - Created [`tools/sync-fribb-id-map.test.mjs`](file:///C:/anihubstream-local/tools/sync-fribb-id-map.test.mjs) verifying index creation, cross-provider resolution, and SQLite transactions (5/5 tests passing).

### What Was Verified:
1. **Live Resolution & Catalog Growth:**
   - Successfully ingested *Kakegurui – Compulsive Gambler* (`kakegurui-compulsive-gambler`), which previously failed with HTTP 400 due to missing Kitsu/AniList IDs.
   - Enriched IDs: MAL `34933`, AniList `98314`, Kitsu `13252`.
   - Local D1 SQLite anime count increased from **2,788 to 2,789**.
   - Verified both `anime` and `anime_id_map` rows exist in local SQLite.
2. **Deterministic Quality Gates:**
   - `npm run build`: **PASSED** (0 TypeScript errors, bundle emitted in 6.50s).
   - `npm run test:cache`: **PASSED** (5/5 Zero-Read shield tests in 91ms).
   - `node --test tools/*.test.mjs`: **PASSED** (101/101 tests across 27 suites in 4.02s).
   - `node --test tools/sync-fribb-id-map.test.mjs`: **PASSED** (5/5 tests in 4.1ms).

### What Remains Risky:
1. **Offline Cache Staleness:**
   - `tools/.cache/anime-list-mini.json` is cached locally to prevent network overhead. Running `npm run sync:fribb` with `--refresh` periodically ensures newly airing seasonal anime ID mappings stay updated.

---

## 11. Phase 1 Deep Audit, Stress Testing & Edge Hardening

**Date:** 2026-11-01  
**Pre-DevFlow Checkpoint Commit Hash:** `e367ddb`  
**Branch:** `agent-workflow-baseline`  

### Deep Audit Findings & Edge Cases Traced:
1. **Misplaced AniList IDs in `mal` Fields:**
   - Identified that several raw catalog source entries (e.g. *Punirunes Puni 4* `mal: 216860`, *Battle Spirits* `mal: 187990`, *One Room* `mal: 205068`) had AniList IDs stored inside the `mal` field. Because MAL IDs have never exceeded ~66,000, any ID > 70,000 in `mal` failed lookup.
   - **Remedy:** Added heuristic recovery in [`resolveFribbIds`](file:///C:/anihubstream-local/tools/sync-fribb-id-map.mjs#L140-L165): if `mal > 70000` and not found in `byMal`, it automatically evaluates against `byAnilist` and recovers the true MAL, AniList, and Kitsu IDs.
2. **Analysis of Remaining Unmatched Titles:**
   - Traced the remaining titles in `catalogue-sources.json` that lack Kitsu or MAL IDs:
     - Non-Japanese anime (e.g. *Blue Eye Samurai*, *Dreamland*): Netflix/French animations not listed on MyAnimeList.
     - 18+ ONAs and adult series (e.g. *Overflow*, *Tiny Evil*, *Chuhai Lips*): unindexed or merged under parent IDs on Kitsu.
     - Brand new unreleased 2026/2027 announcements (e.g. *Mao Mao Season 3*, *Dawang Raoming 3*): lack Kitsu pages.
3. **Database Integrity & Foreign Key Audit:**
   - Verified 100% database consistency:
     - `anime` count: **2,789**
     - `anime_id_map` count: **2,789**
     - Orphan rows: **0**
     - Index plans (`id_map_by_mal`, `id_map_by_anilist`): **Active and fully utilized**.
     - `source_ids` JSON validation: **0 corrupted rows**.
4. **Edge API Zero-Read Cache Gap Repaired:**
   - Found that [`functions/api/id-map.js`](file:///C:/anihubstream-local/functions/api/id-map.js) was querying D1 directly without caching.
   - Wrapped `onRequestGet` in `withEdgeCache(...)` with allowed parameters (`['animeId', 'malId', 'anilistId', 'kitsuId']`) and 86,400s (24h) TTL, protecting ID map lookups under Rule 11.
   - Added unit test suite [`api/id-map.test.mjs`](file:///C:/anihubstream-local/api/id-map.test.mjs) verifying contract, cache headers, bypass flag, and 400/404 handling (5/5 tests passing).

### What Was Verified:
- `npm run test:cache`: **PASSED** (5/5 Zero-Read shield tests in 84ms).
- `node --test api/*.test.mjs tools/*.test.mjs`: **PASSED** (**311 / 311 tests across 84 suites** in 5.18s).
- `npm run build`: **PASSED** (0 TypeScript errors, bundle emitted in 6.26s).

---

## 12. Phase 2: Stream Bridge Hardening & Decryptor Multi-Provider Fallback

**Date:** 2026-11-01  
**Pre-DevFlow Checkpoint Commit Hash:** `84e0f24`  
**Branch:** `agent-workflow-baseline`  

### What Changed:
1. **Multi-Provider Priority Cascade in [`api/bridge.mjs`](file:///C:/anihubstream-local/api/bridge.mjs):**
   - Replaced single-provider attempt with full multi-provider fallback cascade.
   - When the primary requested provider fails or lacks stream sources, the bridge now iterates through all registered adapters from [`api/adapters/registry.mjs`](file:///C:/anihubstream-local/api/adapters/registry.mjs) in descending priority order (`aniwatch` &rarr; `anikoto` &rarr; `hianime` &rarr; `watchanimeworld` &rarr; `animewave` &rarr; `animekai`).
2. **Direct Slug Resolution Support:**
   - Added support for `slug` and `providerSlug` query parameters in `/resolve`, enabling direct details resolution without relying on fuzzy title searching.
3. **Session Cache Management & Programmatic Lifecycle:**
   - Added `/cache` and `/cache/clear` endpoints for inspection and deterministic cache invalidation.
   - Exported `startBridge(port, host)`, `stopBridge()`, `clearSessionCache()`, and `getSessionCacheSize()`.
   - Prevented auto-listen port collision when importing `bridge.mjs` as an ES module in test harnesses.
4. **Local Dev Environment Integration:**
   - Enabled `STREAM_BRIDGE_URL=http://127.0.0.1:8795` in `.dev.vars` to connect [`functions/api/play/resolve.js`](file:///C:/anihubstream-local/functions/api/play/resolve.js) directly to the local stream bridge.
   - Updated [`tools/start-local.mjs`](file:///C:/anihubstream-local/tools/start-local.mjs) to automatically check and spawn the bridge microservice on port 8795 alongside Pages on 8899.
   - Added `"bridge": "node api/bridge.mjs"` to [`package.json`](file:///C:/anihubstream-local/package.json).
5. **Deterministic Unit Test Suite Added:**
   - Created [`api/bridge.test.mjs`](file:///C:/anihubstream-local/api/bridge.test.mjs) testing `/health`, `/cache`, `/resolve` with fallback cascade, slug routing, in-memory session reuse (`reused: true`), and CORS OPTIONS preflights (6/6 tests passing).

### What Was Verified:
- `node --test api/bridge.test.mjs`: **PASSED** (6/6 tests in 86ms).
- `node --test api/*.test.mjs tools/*.test.mjs`: **PASSED** (**317 / 317 tests across 85 suites** in 9.94s).
- `npm run test:cache`: **PASSED** (5/5 Zero-Read shield tests in 100ms).
- `npm run build`: **PASSED** (0 TypeScript errors, bundle emitted in 7.22s).

### What Remains Risky:
1. **Upstream Streaming Host Domain Changes:**
   - External video hosts (`megaplay.buzz`, `vidwish.to`, `zokoanime.video`) occasionally rotate domains. The multi-provider fallback cascade protects playback by falling back to alternative providers in real time, but host domain lists in `api/hianime.mjs` and `api/anikoto.mjs` must be audited if an entire host network migrates.






