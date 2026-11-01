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

---

## 13. Phase 3: Autonomous Catalog Expansion Engine & Targeted Batch Ingestion

**Date:** 2026-11-01  
**Pre-DevFlow Checkpoint Commit Hash:** `ab52f6b`  
**Completion Commit Hash:** `bed13ae`  
**Branch:** `agent-workflow-baseline`  

### What Changed:
1. **Stage-Targeted Execution in [`tools/local-sync-daemon.mjs`](file:///C:/anihubstream-local/tools/local-sync-daemon.mjs):**
   - Added support for `--stage=<name>` and `--growth-only` flags.
   - Decoupled catalog expansion from lengthy episode title searches (which take ~50s), allowing rapid catalog ingestion cycles in ~20s.
   - Enhanced `runSyncCycle({ stage })` to execute only targeted pipeline stages while preserving database connection pooling and heartbeat logging to `sync_meta`.
2. **NPM Script Integration:**
   - Added `"sync:growth": "node tools/local-sync-daemon.mjs --once --growth-only"` to [`package.json`](file:///C:/anihubstream-local/package.json).
3. **Live Backlog Batch Ingestion:**
   - Executed live targeted expansion (`node tools/local-sync-daemon.mjs --once --growth-only --expand=3`).
   - Ingested 3 new backlog series with full metadata, artwork, and episode schemas:
     - *Naruto Shippuden the Movie* (`naruto-shippuden-the-movie-8hj8`): 1 episode, MAL `2472`, AniList `2472`, Kitsu `2245`.
     - *Infinite Dendrogram* (`infinite-dendrogram`): 13 episodes, MAL `38909`, AniList `107420`, Kitsu `42131`.
     - *The Legend of the Legendary Heroes* (`the-legend-of-the-legendary-heroes-gavf`): 24 episodes, MAL `8086`, AniList `8086`, Kitsu `5191`.
   - Populated companion records into `anime_id_map` for all 3 titles.
   - **Local D1 SQLite anime count increased from `2,789` to `2,792`** (38 new episodes stored).
4. **Deterministic Unit Tests Added:**
   - Updated [`tools/local-sync-daemon.test.mjs`](file:///C:/anihubstream-local/tools/local-sync-daemon.test.mjs) with a test verifying that `runSyncCycle` respects stage filters and cleanly skips non-targeted stages (7/7 tests passing).

### What Was Verified:
- `node --test tools/local-sync-daemon.test.mjs`: **PASSED** (7/7 tests in 14ms).
- `node --test api/*.test.mjs tools/*.test.mjs`: **PASSED** (**318 / 318 tests across 85 suites** in 6.49s).
- `npm run test:cache`: **PASSED** (5/5 Zero-Read shield tests in 102ms).
- `npm run build`: **PASSED** (0 TypeScript errors, bundle emitted in 7.76s).

### What Remains Risky:
1. **Third-Party API Rate Limits on Large Batches:**
   - Ingesting more than 30 titles consecutively in a single command may trigger AniList GraphQL rate limits. Expansion batches between 3 and 10 titles per cycle are recommended.

---

## 14. Phase 4: Zero-Read Edge Optimization & Free-Tier Verification

**Date:** 2026-11-01  
**Pre-DevFlow Checkpoint Commit Hash:** `bed13ae`  
**Completion Commit Hash:** `050cd14`  
**Branch:** `agent-workflow-baseline`  

### What Changed:
1. **Full-Spectrum Edge Cache Audit:**
   - Audited every public endpoint in `functions/api/` against Rule 11 (Zero-Read D1 Edge Caching Law).
   - Identified and resolved missing `withEdgeCache` wrappers in 9 endpoints that previously queried D1 or upstream APIs on every incoming request:
     - [`functions/api/search.js`](file:///C:/anihubstream-local/functions/api/search.js) (wrapped with 1800s TTL, `allowedParams: ['q']`).
     - [`functions/api/aniskip.js`](file:///C:/anihubstream-local/functions/api/aniskip.js) (wrapped with 86400s TTL, `allowedParams: ['malId', 'ep', 'duration', 'episodeLength', 'relationRules']`).
     - [`functions/api/play.js`](file:///C:/anihubstream-local/functions/api/play.js) (wrapped with 300s TTL, `allowedParams: ['id', 'animeId', 'title', 'malId', 'ep', 'audio', 'provider', 'server']`).
     - [`functions/api/play/resolve.js`](file:///C:/anihubstream-local/functions/api/play/resolve.js) (wrapped with 600s TTL, `allowedParams: ['title', 'id', 'slug', 'mal', 'ep', 'audio', 'provider', 'server']`).
     - [`functions/api/anikoto/home.js`](file:///C:/anihubstream-local/functions/api/anikoto/home.js) (wrapped with 7200s TTL, `allowedParams: []`).
     - [`functions/api/anikoto/search.js`](file:///C:/anihubstream-local/functions/api/anikoto/search.js) (wrapped with 1800s TTL, `allowedParams: ['q']`).
     - [`functions/api/anikoto/[id].js`](file:///C:/anihubstream-local/functions/api/anikoto/[id].js) (wrapped with 86400s TTL, `allowedParams: []`).
     - [`functions/api/hianime/home.js`](file:///C:/anihubstream-local/functions/api/hianime/home.js) (wrapped with 7200s TTL, `allowedParams: []`).
     - [`functions/api/hianime/search.js`](file:///C:/anihubstream-local/functions/api/hianime/search.js) (wrapped with 1800s TTL, `allowedParams: ['q', 'page', 'limit']`).
     - [`functions/api/hianime/[id].js`](file:///C:/anihubstream-local/functions/api/hianime/[id].js) (wrapped with 86400s TTL, `allowedParams: []`).
2. **Query Parameter Normalization & Cache Key Hardening:**
   - Updated `functions/api/_lib.js`:
     - Added `cleanParams.sort()` to guarantee canonical URL query sorting regardless of caller parameter order.
     - Exported `clearEdgeMemoryCache()` to allow clean test teardown and prevent memory bleed between test runs.
   - Enforced empty `allowedParams: []` on static/canonical endpoints ([`functions/api/anime/[id].js`](file:///C:/anihubstream-local/functions/api/anime/[id].js), [`functions/api/genres.js`](file:///C:/anihubstream-local/functions/api/genres.js), [`functions/api/stats/index.js`](file:///C:/anihubstream-local/functions/api/stats/index.js)) so random query strings (e.g. `?tracker=xyz`) never cause cache-busting or extra D1 row reads.
3. **Cookie Stripping & Global CDN Headers:**
   - Ensured all cached endpoints explicitly strip `Set-Cookie` headers and emit `Vary: Accept-Encoding` with `stale-while-revalidate=300`.
4. **Test Suite Expansion:**
   - Upgraded [`tools/zero-read.test.mjs`](file:///C:/anihubstream-local/tools/zero-read.test.mjs) into an 7-point verification suite covering fresh fetching, in-memory cache hits, emergency cache bypass (`bypass=1` and `x-bypass-cache: 1`), thundering herd single-flight coalescing, `Set-Cookie` removal, parameter canonicalization, and empty `allowedParams` stripping.
   - Created [`api/edge-routes-cache.test.mjs`](file:///C:/anihubstream-local/api/edge-routes-cache.test.mjs) verifying zero-read D1 caching on live API route modules (`search`, `genres`, `stats`, `schedule`, `anikoto/home`, `anikoto/search`).

### What Was Verified:
- `npm run test:cache`: **PASSED** (8/8 assertions in 102ms).
- `node --test api/edge-routes-cache.test.mjs`: **PASSED** (6/6 tests in 1.1s).
- `node --test api/*.test.mjs tools/*.test.mjs`: **PASSED** (**327 / 327 tests across 86 suites** in 7.29s).
- `npm run build`: **PASSED** (0 TypeScript errors, bundle emitted in 17.80s).

### What Remains Risky:
1. **Dynamic Stream Expiration:**
   - `/api/play` and `/api/play/resolve` cache stream links for 5-10 minutes. If a streaming host rotates temporary CDN tokens in under 5 minutes, clients may need to request with `bypass=1` to force fresh token generation. Current upstream token lifetimes exceed 20 minutes, safely covering this window.

---

## 15. Phase 5: Cloud Synchronization & GitHub Actions Dispatcher

**Date:** 2026-11-01  
**Pre-DevFlow Checkpoint Commit Hash:** `050cd14`  
**Branch:** `agent-workflow-baseline`  

### What Changed:
1. **Universal ID Map Cloud Integration:**
   - Extended [`tools/sync-fribb-id-map.mjs`](file:///C:/anihubstream-local/tools/sync-fribb-id-map.mjs) to support `--remote` mode via `populateRemoteIdMap`.
   - Batches remote D1 upserts in chunks of 8 (80 parameters <= 90 max parameter limit) via `d1Query`.
   - Added pre-flight check in `tools/sync-fribb-id-map.test.mjs` verifying graceful failure when Cloudflare credentials are missing.
2. **GitHub Actions Workflow Orchestrator:**
   - Updated [`.github/workflows/catalog-sync.yml`](file:///C:/anihubstream-local/.github/workflows/catalog-sync.yml):
     - Added Phase 0 (`fribb-sync` / `fribb`) to synchronize 39,000+ cross-referenced IDs into remote D1.
     - Added `pre-flight credentials audit` step running `cloud-sync/doctor-secrets.mjs` to proactively identify missing or malformed secrets before executing downstream stages.
     - Added `fribb` to manual dispatch options and `fribb-sync` to repository dispatch triggers.
3. **Comprehensive Setup Documentation:**
   - Created [`docs/cloud-sync-setup.md`](file:///C:/anihubstream-local/docs/cloud-sync-setup.md) detailing:
     - Remote git repository setup instructions (`git remote add origin ...`).
     - Required GitHub repository secrets (`CF_ACCOUNT_ID`, `CF_DATABASE_ID`, `CF_API_TOKEN`).
     - Dual-mode workflow usage (Local Miniflare vs Cloudflare D1 REST).
     - Manual dispatch and automated scheduling (02:00 and 14:00 UTC).

### What Was Verified:
- `node --test tools/sync-fribb-id-map.test.mjs`: **PASSED** (8/8 tests in 231ms).
- `node --test cloud-sync/config.test.mjs`: **PASSED** (9/9 tests in 238ms).
- `node --test cloud-sync/*.test.mjs`: **PASSED** (185/185 tests in 135s).
- `node --test api/*.test.mjs tools/*.test.mjs`: **PASSED** (**328 / 328 tests across 86 suites** in 6.27s).
- `npm run test:cache`: **PASSED** (8/8 assertions in 102ms).
- `npm run build`: **PASSED** (0 TypeScript errors, bundle emitted in 17.80s).

---

## 16. Phase 6: Frontend Streaming UX & Player Polish

**Date:** 2026-11-01  
**Pre-DevFlow Checkpoint Commit Hash:** `b898f13`  
**Branch:** `agent-workflow-baseline`  

### What Changed:
1. **Long-Running Anime Episode Pagination / Batch Selector:**
   - In [`src/components/EpisodeSidebar.tsx`](file:///C:/anihubstream-local/src/components/EpisodeSidebar.tsx), added chunking of episodes into batches of 50 (e.g. `Episodes 1 - 50`, `Episodes 51 - 100`) for series with > 50 episodes (like *One Piece*, *Bleach*, *Naruto*, *Detective Conan*).
   - Automatically synchronizes selected batch to whichever range contains the actively playing episode (`current`).
   - Seamlessly bypasses batching when searching via episode search filter so users can find any episode across the entire series instantly.
2. **Player Controls & Polish Verification:**
   - Expanded [`tools/player-polish.test.mjs`](file:///C:/anihubstream-local/tools/player-polish.test.mjs) with test coverage verifying `EpisodeSidebar` batch selection, range computation, and accessibility attributes.
   - Retained and verified all player features including AniSkip intro/outro skipping, theater mode, autoplay next, and playback rate preferences.

### What Was Verified:
- `npm run test:cache`: **PASSED** (8/8 assertions in 89ms).
- `node --test tools/player-polish.test.mjs`: **PASSED** (4/4 tests).
- `node --test api/*.test.mjs tools/*.test.mjs`: **PASSED** (**329 / 329 tests across 86 suites** in 6.1s).
- `npm run build`: **PASSED** (0 TypeScript compile errors, production bundle built in 6.46s).

---

## 17. Elimination of Dummy / Unreleased Episodes in Upcoming and Ongoing Anime

**Date:** 2026-11-01  
**Pre-DevFlow Checkpoint Commit Hash:** `245e83f`  
**Branch:** `agent-workflow-baseline`  

### Root Cause Analysis:
1. **API Episode Filtering Gap:** `functions/api/anime/[id].js` only performed episode filtering when `card.status === 'Ongoing' || card.status === 'Airing'`. `Upcoming` and `NOT_YET_RELEASED` anime bypassed the filter entirely, serving any placeholder episodes stored in the database. Furthermore, for ongoing anime, if upstream metadata had placeholder airdates in the past (e.g. *Aoashi Season 2* with dummy 2024 dates for episodes 5-12), they leaked past the `airdate <= today` check despite `sched_episode = 5` explicitly marking them as unreleased.
2. **Frontend Synthetic Episode Fabrication in `Watch.tsx`:** `Watch.tsx` evaluated `Math.max(anime.episodeTotal || 0, ...)` to generate synthetic episode cards up to the total count (e.g. 10 or 24) when the episode list was shorter. This bypassed the "Episodes Coming Soon" empty state and rendered clickable broken episode buttons for upcoming and ongoing anime.
3. **Frontend Routing & CTA Leak in `AnimeDetail.tsx` & `AnimeCard.tsx`:** `AnimeCard.tsx` routed all clicks to `/watch/:id/1` even when the anime had zero released episodes. `AnimeDetail.tsx` initiated stream fetching on mount (`getPlay({ id, ep: 1 })`) and rendered a "Watch Episode 1" CTA for unreleased anime.
4. **Sync Script Generation of Phantom Episode Shells:** `tools/sync-ongoing-schedules.mjs` ran an `INSERT OR IGNORE INTO episode` loop generating empty shells up to `latestAiredEp`. When `nextEpNum` was 1, it treated it as `latestAiredEp = 1`, fabricating dummy `Episode 1` shells for unreleased anime. In ongoing series like *Shin Chan* (ep 1360), it generated 1,327 empty shells with no stream, thumbnail, or airdate. `cloud-sync/sync-episodes.mjs` also lacked an exclusion for `Upcoming` anime.

### What Changed:
1. **Edge API Route (`functions/api/anime/[id].js`):**
   - Added `isUpcoming` detection (`status === 'Upcoming' || status === 'NOT_YET_RELEASED'`).
   - For upcoming titles, strictly returns `episodes: []` and sets `episodeCount: 0`.
   - For ongoing titles, filters out any episode where `ep.n >= card.sched_episode` (unreleased future episodes) or `ep.airdate > today`, and purges unpopulated placeholder shells (`!ep.airdate && !ep.external_id && !ep.synopsis && ep.title === 'Episode ' + ep.n`).
   - Overrides `episodeCount: episodes.length` in the response contract.
2. **Frontend Player (`src/pages/Watch.tsx`):**
   - Returns empty list if `isUpcoming`, allowing the native "Episodes Coming Soon" banner to render.
   - Refactored `effectiveEpisodes` to never pad unreleased future episodes up to `episodeTotal`. Only expands shells if a specific episode was explicitly requested via URL/query param, or if the series is finished and lacks individual episode records.
3. **Frontend Detail Page (`src/pages/AnimeDetail.tsx`):**
   - Guarded `getPlay({ id, ep: 1 })` to skip stream queries when anime is `Upcoming` or `NOT_YET_RELEASED`.
   - Replaced "Watch Episode 1" CTA with "Upcoming · View Release Schedule" (linking to `/schedule`) when upcoming or when no episodes have aired yet.
   - Replaced empty fallback episode grid with an informative "No Episodes Released Yet" message.
4. **AnimeCard Component (`src/components/AnimeCard.tsx`):**
   - Changed target navigation URL for `Upcoming` anime to detail page `/anime/${anime.id}` instead of broken `/watch/${anime.id}/1`.
5. **Data Models (`src/data/model.ts`):**
   - Updated `AnimeStatus` type to `'Ongoing' | 'Finished' | 'Upcoming' | 'NOT_YET_RELEASED'`.
6. **Schedule & Episode Sync Tools:**
   - In [`tools/sync-ongoing-schedules.mjs`](file:///C:/anihubstream-local/tools/sync-ongoing-schedules.mjs), removed the harmful auto-generation of empty episode shells.
   - In [`cloud-sync/sync-episodes.mjs`](file:///C:/anihubstream-local/cloud-sync/sync-episodes.mjs), excluded `Upcoming` / `NOT_YET_RELEASED` anime from episode generation queries and capped ongoing generation to `sched_episode - 1`.
   - Added [`tools/clean-dummy-episodes.mjs`](file:///C:/anihubstream-local/tools/clean-dummy-episodes.mjs) which purged 3,393 phantom dummy episodes and 10 upcoming placeholder records from the local SQLite D1 database.

### What Was Verified:
- `node tools/audit-sync-status.mjs`:
  - Total episodes: 37,767.
  - Phantom unreleased dummy episodes in ongoing anime: **0 (PERFECT ZERO)**.
- Live API validation (`http://127.0.0.1:8899/api/anime/:id?bypass=1`):
  - `cyberpunk-edgerunners-ii` (Upcoming): `episodeCount: 0`, `episodes: []`.
  - `aoashi-season-2` (Ongoing, next ep 5): exactly 4 aired episodes returned, episodes 5-12 filtered out.
  - `crayon-shin-chan` (Ongoing): all 1,327 dummy placeholder shells removed.
- `npm run test:cache`: **PASSED** (8/8 tests in 174ms).
- `node --test api/*.test.mjs tools/*.test.mjs`: **PASSED** (**329/329 tests across 86 suites**).
- `node --test cloud-sync/*.test.mjs`: **PASSED** (**185/185 tests across 32 suites**).
- `npm run build`: **PASSED** (0 TypeScript errors, bundle emitted in 27.59s).

---

## 18. Home Page Trending Section & Hero Slideshow Live Verification

**Date:** 2026-11-01  
**Pre-DevFlow Checkpoint Commit Hash:** `f295202`  
**Branch:** `agent-workflow-baseline`  

### What Was Investigated:
1. **Live `/api/home` API Contract:**
   - Evaluated whether trending items were properly populated, ordered, and formatted.
   - Identified that `q('WHERE a.trend_rank IS NOT NULL', 'a.trend_rank ASC')` risked returning an incomplete or empty list if the catalogue had fewer than 20 indexed trending ranks.
   - Upgraded query to `q('', 'a.trend_rank IS NULL, a.trend_rank ASC, a.rating DESC')` to guarantee 20 items in top trending order with seamless fallback to highest rated titles.
2. **HeroSlideshow Component (`src/components/HeroSlideshow.tsx`):**
   - Investigated hero slide action buttons when a trending anime is `Upcoming` or has 0 released episodes (e.g. *Cyberpunk: Edgerunners 2* at #2).
   - "Watch Now" previously navigated directly to `/watch/:id/1` even when the title had 0 released episodes.
   - Added contextual CTA routing: when `hasNoEpisodes` (`isUpcoming` or ongoing with 0 episodes), the primary action renders `"View Details"` linking to `/anime/:id` and secondary action renders `"Release Schedule"` linking to `/schedule`.
   - Added `UPCOMING` status badge (`.hero-slideshow__status-badge--upcoming`) alongside existing `ONGOING` badge.
   - Replaced misleading episode counts for upcoming titles (e.g. "Full Season" or "10 Episodes") with `"Coming Soon"`.
3. **Home Trending Carousel (`src/pages/Home.tsx`):**
   - Fixed `rank` prop in the trending carousel to respect `a.trendRank ?? i + 1`, ensuring that shuffle/rotation maintains each anime's authentic trending rank number badge.
4. **Episode Sync Priority (`cloud-sync/sync-episodes.mjs`):**
   - Prioritized trending ongoing anime in the episode generation queue (`ORDER BY ... trend_rank ASC, rating DESC`) so that high-demand trending shows have their episodes synced first.

### What Was Verified:
- Live endpoint `http://127.0.0.1:8899/api/home`:
  - Returns 20 trending items sorted monotonically by `trendRank` (1 through 20).
  - Multi-provider stream shelf properly populated for `anikoto`, `hianime`, and `aniwatch`.
  - Zero-read edge caching and cache-control headers verified.
- New test suite [`tools/trending-home.test.mjs`](file:///C:/anihubstream-local/tools/trending-home.test.mjs): **6/6 tests PASSED**.
- `npm run test:cache`: **8/8 tests PASSED**.
- `node --test api/*.test.mjs tools/*.test.mjs`: **335/335 tests PASSED**.
- `npm run build`: **PASSED** (0 TypeScript errors).

---

## 19. Automatic Daily Sync Pipeline Audit & Real-time Trending Sync Integration

**Date:** 2026-11-01  
**Pre-DevFlow Checkpoint Commit Hash:** `2f00a76`  
**Branch:** `agent-workflow-baseline`  

### Root Cause Analysis of Sync Automation:
1. **Missing Trending Ranks Sync in Local Pipeline:**
   - While [`tools/local-sync-daemon.mjs`](file:///C:/anihubstream-local/tools/local-sync-daemon.mjs) automated schedules, providers, franchises, episodes, and backlog growth, it completely lacked a stage to sync `trend_rank`.
   - `tools/hourly-refresh.mjs` was crashing on startup due to a hardcoded path assumption for global `wrangler` in `%APPDATA%`, preventing trending rank refreshes.
   - As a result, the home page's trending anime order was frozen and out of date compared to live AniList metrics.
2. **Local Environment Autonomous Lifecycle:**
   - [`tools/start-local.mjs`](file:///C:/anihubstream-local/tools/start-local.mjs) initialized the database, started the stream bridge, and started the Cloudflare Pages dev server, but did not automatically supervise the background sync daemon.

### What Changed:
1. **Dedicated Trending Sync Engine ([`tools/sync-trending.mjs`](file:///C:/anihubstream-local/tools/sync-trending.mjs)):**
   - Created `syncTrendingRanks` to query AniList GraphQL for the live top 50 trending anime.
   - Maps AniList IDs via `anime_id_map` and `anime.source_ids`.
   - Updates `trend_rank` in D1 SQLite and clears `trend_rank = NULL` for titles that dropped off.
   - Verified live execution: 49 active ranked titles synchronized in <1s.
2. **Integration into Local Autonomous Sync Daemon ([`tools/local-sync-daemon.mjs`](file:///C:/anihubstream-local/tools/local-sync-daemon.mjs)):**
   - Added Stage 1: `syncTrendingStage` as the first step of the sync cycle.
   - Supported standalone targeting via `--stage=trending` and npm script `npm run sync:trending`.
3. **Automatic Startup Orchestration ([`tools/start-local.mjs`](file:///C:/anihubstream-local/tools/start-local.mjs)):**
   - Configured `start-local.mjs` to automatically spawn `tools/local-sync-daemon.mjs` in the background with a 30-minute recurring interval and clean SIGINT/SIGTERM lifecycle management.
4. **Portability Fix in `tools/hourly-refresh.mjs`:**
   - Resolved the missing wrangler binary crash by gracefully falling back to `npx wrangler`.

### What Was Verified:
- `node tools/sync-trending.mjs`: **PASSED** (49 active ranked, 44 updated, 12 cleared in 923ms).
- `node tools/local-sync-daemon.mjs --once --stage=trending`: **PASSED**.
- `node --test tools/local-sync-daemon.test.mjs`: **7/7 tests PASSED**.
- `npm run test:cache`: **8/8 tests PASSED**.
- `node --test api/*.test.mjs tools/*.test.mjs`: **335/335 tests PASSED**.
- `npm run build`: **PASSED** (0 TypeScript errors).

---

## 20. Elimination of Dummy Episode Generation in Provider APIs & Universal Stream Health Probing

**Date:** 2026-11-01  
**Pre-DevFlow Checkpoint Commit Hash:** `26fe096`  
**Completion Commit Hash:** `2f392b9`  
**Branch:** `agent-workflow-baseline`  

### Root Cause Analysis:
1. **Schema Mismatch in `functions/api/anikoto/[id].js`:**
   - Line 58 previously attempted to query `thumbnail_url` from the `episode` table. The canonical schema column is `thumb`.
   - The unhandled column error was silently caught by `.catch(() => ({ results: [] }))`, causing every valid catalogue anime (such as *Frieren: Beyond Journey’s End*) to report 0 episode rows.
   - The subsequent fallback logic unconditionally generated synthetic dummy episodes (`Episode 1`, `Episode 2`, etc.) without real titles, runtimes, or thumbnails.
   - For unreleased titles with declared `episode_total` (e.g. 12 episodes), it synthesized 12 dummy episodes for anime that had not even aired.
2. **Unconditional Dummy Episode 1 in `functions/api/hianime/[id].js`:**
   - When upstream HiAnime returned 0 episodes or was queried for an unreleased/upcoming title, line 86 unconditionally populated `[{ id: 'hianime:...#1', n: 1, title: 'Episode 1', ... }]`.
3. **Missing Early Return in `functions/api/play.js`:**
   - Navigating to `/api/play` for an upcoming title attempted to query the bridge and external upstream providers, wasting 25 seconds of worker latency before timing out or failing.
4. **Ordering Glitch in `src/pages/Watch.tsx`:**
   - The `isMovie` check evaluated before `isUpcoming`, causing upcoming unreleased movies to synthesize a 1-episode shell rather than rendering the native "Episodes Coming Soon" banner.
   - Newly ongoing series with 0 released episodes were expanded into dummy shells when accessed with query params.

### What Changed:
1. **Edge API Route ([`functions/api/anikoto/[id].js`](file:///C:/anihubstream-local/functions/api/anikoto/[id].js)):**
   - Corrected SQL query to select canonical column `thumb`.
   - Populated `thumbnail: e.thumb || fallbackArt` and real episode titles and runtimes.
   - Added `isUpcoming` check so synthetic episodes are NEVER generated for unreleased anime.
2. **Edge API Route ([`functions/api/hianime/[id].js`](file:///C:/anihubstream-local/functions/api/hianime/[id].js)):**
   - Added `isUpcoming` detection (`anime.Status` checking and 0 total sub/dub episodes).
   - Suppressed fallback Episode 1 generation for upcoming anime, ensuring `episodes: []`.
3. **Playback Edge Route ([`functions/api/play.js`](file:///C:/anihubstream-local/functions/api/play.js)):**
   - Selected `a.status` in D1 queries.
   - Added instant 4ms short-circuit returning `{ servers: [], status: 'unreleased', error: 'This anime has not yet been released.' }` when status is `Upcoming` or `NOT_YET_RELEASED`.
4. **Watch Page ([`src/pages/Watch.tsx`](file:///C:/anihubstream-local/src/pages/Watch.tsx)):**
   - Re-ordered checks: `isUpcoming` and `(anime.status === 'Ongoing' && existingCount === 0)` now evaluate before `isMovie`.
   - Guaranteed that upcoming anime and newly announced ongoing titles with 0 released episodes cleanly render the native "Episodes Coming Soon" banner.
5. **Stream Health Diagnostics ([`tools/probe-trending-streams.mjs`](file:///C:/anihubstream-local/tools/probe-trending-streams.mjs)):**
   - Added standalone probe script and `"test:streams"` script to [`package.json`](file:///C:/anihubstream-local/package.json) to probe and verify live HLS playback across all top trending titles.

### What Was Verified:
- Live endpoint `http://127.0.0.1:8899/api/anikoto/sousou-no-frieren?bypass=1`:
  - Episode 1: `title: "The Journey's End"`, `duration: 1440`, `thumbnail: "https://media.kitsu.app/episode/353471/thumbnail/medium-4218a1887e2d33e701be955a9d0315bc.jpeg"`. (Dummy fallback eliminated).
- Live endpoint `http://127.0.0.1:8899/api/anikoto/cyberpunk-edgerunners-ii?bypass=1` (Upcoming):
  - Returns `episodes: []` (length 0). (Synthetic episodes eliminated).
- Live endpoint `http://127.0.0.1:8899/api/play?id=cyberpunk-edgerunners-ii&ep=1&bypass=1`:
  - Instant response in 4ms with `status: 'unreleased'` and `servers: []`.
- `npm run test:streams`:
  - **100% playable streams** for all released top 20 trending anime (*Black Clover S2*, *Aoashi S2*, *One Piece*, *Bleach*, *Steel Ball Run*, *Romelia War Chronicle*, *Bleach TYBW*, *Naruto Shippuden*).
  - All unreleased / 0-episode titles cleanly skipped.
- `npm run test:cache`: **PASSED** (8/8 Zero-Read assertions).
- `npm test`: **PASSED** (**520 / 520 tests across 118 suites** with 0 failures).
- `npm run build`: **PASSED** (0 TypeScript errors, production bundle built cleanly).

### What Remains Risky:
1. **Third-Party Upstream Video Host Stability:**
   - While all released titles currently resolve working HLS streams via AniKoto, external hosts periodically cycle domains. The new `"npm run test:streams"` script provides instant validation to detect upstream disruptions early.

---

## 21. Autonomous Stream Health Monitoring Daemon Stage & Episode Artwork Migration

**Date:** 2026-11-01  
**Pre-DevFlow Checkpoint Commit Hash:** `5825936`  
**Completion Commit Hash:** `943f698`  
**Branch:** `agent-workflow-baseline`  

### What Changed:
1. **D1 SQLite Episode Artwork Fallback Migration ([`tools/migrate-episode-thumbs.mjs`](file:///C:/anihubstream-local/tools/migrate-episode-thumbs.mjs)):**
   - Discovered that 12,639 legacy episodes in the local SQLite database had missing or empty `thumb` attributes.
   - Built an atomic SQL migration executing:
     `UPDATE episode SET thumb = (SELECT coalesce(nullif(a.key_art, ''), nullif(a.art, ''), '') FROM anime a WHERE a.id = episode.anime_id) WHERE (thumb IS NULL OR thumb = '')`.
   - Successfully backfilled **12,639 episode thumbnails** in a single pass, bringing remaining missing thumbnails to **0 (PERFECT ZERO)**.
   - Added `"db:migrate-thumbs": "node tools/migrate-episode-thumbs.mjs"` to [`package.json`](file:///C:/anihubstream-local/package.json).
   - Created unit test [`tools/migrate-episode-thumbs.test.mjs`](file:///C:/anihubstream-local/tools/migrate-episode-thumbs.test.mjs) (1/1 tests passing).
2. **Episode Ingestion Pipeline Fallback Hardening ([`tools/auto-sync-episodes.mjs`](file:///C:/anihubstream-local/tools/auto-sync-episodes.mjs)):**
   - Enhanced `updateEpisodeStmt` in `auto-sync-episodes.mjs` to automatically fall back to `a.key_art || a.art` when AniList or Kitsu publishes empty thumbnails for older catalog episodes.
3. **Autonomous Stream Health Daemon Stage ([`tools/local-sync-daemon.mjs`](file:///C:/anihubstream-local/tools/local-sync-daemon.mjs)):**
   - Added Stage 7: `syncHealthStage` into the local sync daemon cycle.
   - Supervised by `tools/start-local.mjs` and runnable on demand via `node tools/local-sync-daemon.mjs --once --stage=health`.
   - Records live stream health status, uptime, and server availability directly into D1 table `sync_meta` under key `'stream_health'`.
   - Enhanced [`tools/probe-trending-streams.mjs`](file:///C:/anihubstream-local/tools/probe-trending-streams.mjs) to export programmatic `probeTrendingStreams({ limit, baseUrl, silent })` returning structured metrics.
   - Updated [`tools/local-sync-daemon.test.mjs`](file:///C:/anihubstream-local/tools/local-sync-daemon.test.mjs) to verify `metrics.health` stage handling (7/7 tests passing).

### What Was Verified:
- `node tools/migrate-episode-thumbs.mjs`:
  - Before: **12,639 missing thumb**
  - Updated: **12,639 rows**
  - Remaining: **0 (PERFECT ZERO)**.
- `node tools/local-sync-daemon.mjs --once --stage=health`:
  - Executed cleanly in 280ms: **4 streamable, 6 unreleased skipped, 0 failed**.
- `npm run test:streams`:
  - **100% playable HLS streams** across all released ongoing/finished top-trending series.
- `npm run test:cache`: **8/8 tests PASSED**.
- `node --test tools/local-sync-daemon.test.mjs`: **7/7 tests PASSED**.
- `node --test tools/migrate-episode-thumbs.test.mjs`: **1/1 test PASSED**.
- `npm run build`: **PASSED** (0 TypeScript errors, bundle emitted in 6.82s).

---

## 22. Instant Search (Meilisearch) Real-Time Synchronization & Autonomous Daemon Integration

**Date:** 2026-11-01  
**Pre-DevFlow Checkpoint Commit Hash:** `b347290`  
**Completion Commit Hash:** `b763dde`  
**Branch:** `agent-workflow-baseline`  

### What Changed:
1. **Live D1 SQLite Ingestion in [`tools/meilisearch/sync-meilisearch.mjs`](file:///C:/anihubstream-local/tools/meilisearch/sync-meilisearch.mjs):**
   - Previously, Meilisearch synchronization only read static files (`seed.sql` and `catalogue-sources.json`), missing dynamically ingested titles and real-time AniList trending rank updates in D1 SQLite.
   - Built `getAnimeDocumentsFromDb(db, ids)` to query the live Miniflare D1 database directly.
   - Preserves complete document schemas including `trend_rank`, `rating`, `year`, `synopsis`, and `synonyms`.
   - Added support for targeted delta sync (`ids: ['...']`) for new titles and updated ranks.
2. **Resilient Health Probing & Offline Fallback:**
   - Added `isMeilisearchHealthy(host, timeoutMs)` probing `${host}/health` in <5ms with a 1.2s timeout.
   - When Meilisearch is offline or unprovisioned, `syncAnimeToMeilisearch` gracefully skips and reports `active search fallback: D1 SQLite FTS5/LIKE` without throwing or stalling the pipeline.
3. **Autonomous Daemon Stage Integration ([`tools/local-sync-daemon.mjs`](file:///C:/anihubstream-local/tools/local-sync-daemon.mjs)):**
   - Added Stage 8: `syncSearchStage` into the autonomous local sync daemon.
   - Stores current search engine status into D1 table `sync_meta` under key `'search_engine'` (`engine: 'meilisearch' | 'd1_fallback'`).
   - Supports targeted execution via `--stage=search`.
4. **Deterministic Unit Tests Added ([`tools/meilisearch/sync-meilisearch.test.mjs`](file:///C:/anihubstream-local/tools/meilisearch/sync-meilisearch.test.mjs)):**
   - Verified SQLite document extraction with full type preservation (`rating`, `trend_rank`, `synonyms`).
   - Verified targeted delta extraction by ID array.
   - Verified graceful offline health check and clean fallback status reporting (4/4 tests passing).
   - Added `tools/meilisearch/*.test.mjs` to `package.json` `"test"` script.

### What Was Verified:
- `node tools/meilisearch/sync-meilisearch.mjs`:
  - Gracefully detects offline host: `[Meilisearch] Host http://127.0.0.1:7700 offline. Active search fallback: D1 SQLite FTS5/LIKE. (meilisearch_offline)`.
- `node tools/local-sync-daemon.mjs --once --stage=search`:
  - Stage 8 executed in **48ms**: records engine status to `sync_meta` and cleanly falls back to D1 FTS5/LIKE.
- Live edge search check `http://127.0.0.1:8899/api/search/instant?q=frieren&bypass=1`:
  - Returns 3 instant hits seamlessly via `d1_fallback` with zero downtime.
- `node --test tools/meilisearch/sync-meilisearch.test.mjs`: **4/4 tests PASSED**.
- `node --test api/*.test.mjs tools/*.test.mjs tools/meilisearch/*.test.mjs`: **340/340 tests PASSED**.
- `npm run test:cache`: **8/8 tests PASSED**.
- `npm run test:streams`: **100% playable HLS streams verified**.
- `npm run build`: **PASSED** (0 TypeScript errors, bundle emitted in 6.64s).

---

## 23. Dynamic Provider Latency Heatmap & Auto-Failover Priority

**Date:** 2026-11-01  
**Pre-DevFlow Checkpoint Commit Hash:** `7b7c5a2`  
**Completion Commit Hash:** `15c7cdb`  
**Branch:** `agent-workflow-baseline`  

### What Changed:
1. **Per-Provider Latency & Health Probing in [`tools/probe-trending-streams.mjs`](file:///C:/anihubstream-local/tools/probe-trending-streams.mjs):**
   - Added real-time round-trip latency measurement (`elapsed`) for every provider probe (`anikoto`, `hianime`, `aniwatch`).
   - Computes rolling aggregate stats (`providerStats`: `{ anikoto, hianime, aniwatch }` with `status: 'healthy' | 'degraded'`, `latencyMs`, `successCount`, `totalCount`).
   - Persists aggregate provider latency stats into D1 SQLite `sync_meta` under key `'stream_health'` during Stage 7 of the autonomous sync daemon.
2. **Dynamic Provider Priority & Failover in [`functions/api/play.js`](file:///C:/anihubstream-local/functions/api/play.js):**
   - Retrieves `stream_health` metrics from `sync_meta` table in Miniflare D1.
   - Looks up multi-provider availability across `anime_id_map` (`anikoto_slug`, `hianime_slug`, `aniwatch_slug`) and `anime_provider_mapping`.
   - When no provider is explicitly requested or when `provider='auto'`, dynamically ranks and selects the fastest healthy provider using live latency data.
   - Returns rich `providerHealth` and `availableProviders` in all API responses (`200 OK`) while preserving strict Rule 11 (Zero-Read D1 Edge Caching Law) compatibility.
   - Accurately computes `scopedProviderUnavailable` based on slug existence for the target provider, allowing seamless client-side server failover.
3. **Frontend Live Heatmap & Badges ([`src/components/player/ServerSwitcher.tsx`](file:///C:/anihubstream-local/src/components/player/ServerSwitcher.tsx) & [`src/pages/Watch.tsx`](file:///C:/anihubstream-local/src/pages/Watch.tsx)):**
   - Added typed `providerHealth` and `availableProviders` to `PlayResponse` in [`src/data/api.ts`](file:///C:/anihubstream-local/src/data/api.ts).
   - Render live latency badges (e.g. `85ms`, `140ms`, `210ms`) color-coded dynamically (Green < 120ms, Amber < 250ms, Red for degraded/slow) on stream provider switchers.
   - Highlights degraded status (`Slow`) and dims unavailable providers for the selected anime title.
   - Dynamically selects the fastest healthy server when no explicit provider URL parameter is provided.
4. **Deterministic Unit Test Suite ([`tools/stream-provider-priority.test.mjs`](file:///C:/anihubstream-local/tools/stream-provider-priority.test.mjs)):**
   - 5/5 unit tests verifying dynamic prioritization by latency, degraded provider penalty, explicit user override, slug unavailability failover flag, and default fallback metrics.

### What Was Verified:
- `node --test tools/stream-provider-priority.test.mjs`: **5/5 tests PASSED**.
- `npm run test:cache`: **8/8 tests PASSED** (Zero-Read Edge Shield verified).
- `curl.exe -m 8 -i -s "http://127.0.0.1:8899/api/play?id=solo-leveling&ep=1"`:
  - First hit: `X-D1-Read: 1-d1-fresh`, returns `scopedProvider: "anikoto"`, `providerHealth`, and `availableProviders`.
  - Repeat hit: `CF-Cache-Status: HIT`, `x-d1-read: 0-edge-cache-hit` (**0 D1 reads verified**).
- `npm run build`: **PASSED** (0 TypeScript errors, Vite pages build bundled in 6.72s).

---

## 24. Recommended Next Targets & Architecture Roadmap

1. **Target 2: Offline PWA & Service Worker Stream Segment Caching**
   - Implement client-side service worker cache for HLS `.m3u8` and media segment chunks to provide instant resume and offline buffering on mobile devices.
2. **Target 3: Franchise Chronology Visual Timeline View**
   - Enhance [`src/pages/AnimeDetail.tsx`](file:///C:/anihubstream-local/src/pages/AnimeDetail.tsx) to render a visual release order / timeline tree using the existing 1,480 franchise edges in `anime_franchise_relation`.
3. **Target 4: Intelligent Auto-Skip & AniSkip Fallback Optimizer**
   - Add local learning/heuristics to detect recap/intro timestamps for anime without AniSkip v2 entries by analyzing black frames or audio silence signatures.
















