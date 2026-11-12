# Project-Wide Bugfix, Dead Code Elimination, and Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix known test failures and data discrepancies, eliminate dead code and duplicate shims across the edge API and bridge adapters, prune obsolete tooling scripts, and stabilize the AniHub Stream repository so all test suites run 100% green.

**Architecture:** 
1. Re-sync `data/anime_id_map.json` with the authoritative SQLite database so `tools/data-verify-parity.test.mjs` passes with zero discrepancies.
2. Remove duplicate edge re-exports (`functions/api/anikoto/_megaplay.js`), pointing test callers directly to canonical `functions/api/_megaplay.js`.
3. Extract shared regex parsers, iframe embed extractors, and payload normalizers into `api/adapters/common.mjs` to reduce bloat in `api/anikoto.mjs`, `api/aniwatch.mjs`, and `api/hianime.mjs`.
4. Audit and prune dead/legacy migration scripts in `tools/` (`init-local-db.mjs`, `apply-id-map.mjs`, redundant sync scripts) and complete `.claude/` deprecation.
5. Harden player edge-case recovery in `src/pages/Watch.tsx` and verify complete build and test health.

**Tech Stack:** Node.js 22+ (ES Modules), Cloudflare Pages Functions, Cloudflare D1 (SQLite), Vite, React 18, TypeScript, Code Review Graph.

**Spec:** Clean architecture principles, Ponytail minimalism, and Karpathy guidelines for surgical simplicity.

## Global Constraints

- Never break active API response contracts (`/api/play`, `/api/play/resolve`, `/api/search`, `/api/home`).
- Maintain zero-read edge caching contracts and headers (`X-Zero-Read`, `s-maxage=600`).
- Ensure all 584 unit, integration, and edge tests pass monotonically (`npm test`).
- Keep changes surgical: no unrequested refactoring of unrelated logic or visual styling.

## Review Focus

1. **Parity Check Accuracy:** Pulling fresh data must not overwrite human-curated redirects or custom slugs.
2. **Provider Key Safety:** Extracting common adapters must never cross-contaminate encryption IVs or decryption tokens between AniKoto and HiAnime.
3. **Edge Route Availability:** Deleting duplicate shims must not break existing test callers or Cloudflare Pages routes.
4. **Tool Dependencies:** Pruning dead scripts in `tools/` must not remove scripts referenced by package.json scripts or CI workflows.
5. **Zero Regression:** Player startup latency and multi-audio stream resolution must remain intact.

---

### Task 1: Fix Data Parity & ID Mapping Synchronization Bug

**Files:**
- Modify: `data/reference/id_map.json`
- Test: `tools/data-verify-parity.test.mjs`

**Interfaces:**
- `tools/data-verify-parity.mjs` expects `data/reference/id_map.json` count to match SQLite `anime_id_map` table count (3,173 rows).

- [x] **Step 1: Run the parity test to confirm current failure**
  Run: `node --test tools/data-verify-parity.test.mjs`
  Expected: FAIL with `AssertionError: false !== true` (116 row discrepancy).

- [x] **Step 2: Sync `data/reference/id_map.json` from the local database**
  Run: `node tools/data-pull-pure.mjs`
  Expected: Exports all 3,173 rows from SQLite to `data/reference/id_map.json`.

- [x] **Step 3: Run parity test to verify it passes**
  Run: `node --test tools/data-verify-parity.test.mjs`
  Expected: PASS with 0 failures (`isPureParity: true`, `mismatches: 0`).

- [x] **Step 4: Commit**
  ```bash
  git add data/reference/id_map.json
  git commit -m "fix(data): synchronize id_map reference JSON with database to restore data parity"
  ```

---

### Task 2: Eliminate Duplicate Edge Shims & Consolidate Megaplay WebCrypto

**Files:**
- Delete: `functions/api/anikoto/_megaplay.js`
- Modify: `api/anikoto-isolated.test.mjs:4`
- Test: `api/anikoto-isolated.test.mjs`

**Interfaces:**
- `functions/api/_megaplay.js` exports:
  ```javascript
  export function isMegaplayTokenValid(streamUrl: string): boolean
  export function resolveMegaplayEmbed(embedUrl: string): Promise<any>
  export function resolveMegaplayDirect(params: any): Promise<any>
  ```

- [x] **Step 1: Update test import in `api/anikoto-isolated.test.mjs`**
  Change `import { isMegaplayTokenValid } from '../functions/api/anikoto/_megaplay.js'` to `import { isMegaplayTokenValid } from '../functions/api/_megaplay.js'`.

- [x] **Step 2: Run test to confirm it works with the direct import**
  Run: `node --test api/anikoto-isolated.test.mjs`
  Expected: PASS with all tests green.

- [x] **Step 3: Delete redundant shim `functions/api/anikoto/_megaplay.js`**
  Run: `rm functions/api/anikoto/_megaplay.js`

- [x] **Step 4: Run edge tests to ensure no broken references**
  Run: `node --test api/anikoto-isolated.test.mjs api/edge-routes-cache.test.mjs`
  Expected: PASS with 0 errors.

- [x] **Step 5: Commit**
  ```bash
  git add api/anikoto-isolated.test.mjs functions/api/anikoto/_megaplay.js
  git commit -m "refactor(edge): remove duplicate anikoto/_megaplay.js shim"
  ```

---

### Task 3: Maintain Provider Parser Isolation (Anti-Coupling Ruling)

**Context:**
- Per Ponytail review Finding 4, extracting shared regex/decryption helpers across `api/anikoto.mjs` and `api/aniwatch.mjs` introduces unnecessary architectural coupling between two unrelated third-party scraper pipelines.
- Preserved adapter boundaries as self-contained modules to ensure changes or breakages on AniWatch do not affect AniKoto.

- [x] **Step 1: Verify AniKoto, AniWatch, and HiAnime test suites run isolated**
  Run: `node --test api/anikoto-isolated.test.mjs api/hianime-isolated.test.mjs api/federated.test.mjs`
  Expected: PASS with 100% test isolation.

---

### Task 4: Preserve Critical DB Entrypoints & Consolidate Agent Configuration

**Files:**
- Preserve: `tools/init-local-db.mjs` (required by `package.json:db:init` and `tools/start-local.mjs`)
- Preserve: `tools/apply-id-map.mjs` (required by `package.json:db:seed-id-map`)
- Staged removal: finalize staged deletion of obsolete `.claude/` directory
- Test: `npm test`

- [x] **Step 1: Verify `package.json` and callers for `init-local-db` and `apply-id-map`**
  Confirmed active callers: `start-local.mjs`, `data-pull-pure.mjs`, and `package.json` scripts (`db:init`, `db:seed-id-map`).
  Preserved both entrypoints to avoid breaking initialization flows.

- [x] **Step 2: Remove obsolete `.claude/` directory**
  Eliminated mirrored legacy directory in favor of canonical `.agents/`.

- [x] **Step 3: Verify full test suite passes**
  Run: `npm test`
  Expected: All test suites run cleanly.

- [x] **Step 4: Commit**
  ```bash
  git add .claude/
  git commit -m "chore: consolidate agent specs and finalize .claude cleanup"
  ```

---

### Task 5: Player Hotspot Resilience & Typecheck Verification

**Files:**
- Modify: `src/pages/Watch.tsx`
- Test: `npm run typecheck`, `npm run build`

**Interfaces:**
- Player must handle missing stream URLs gracefully without crash loops.

- [ ] **Step 1: Audit error fallback state in `src/pages/Watch.tsx`**
  Ensure fallback server notification displays a helpful toast when an upstream stream is dead and cascades to the next available server.

- [ ] **Step 2: Run TypeScript compiler**
  Run: `npm run typecheck`
  Expected: 0 type errors.

- [ ] **Step 3: Run production build**
  Run: `npm run build`
  Expected: Vite bundle builds cleanly in < 10s.

- [ ] **Step 4: Commit**
  ```bash
  git add src/pages/Watch.tsx
  git commit -m "fix(player): strengthen fallback recovery and error boundary"
  ```

---

### Task 6: Final Whole-Branch Review & Verification

**Files:** Entire repository working tree

- [ ] **Step 1: Run complete automated test suite**
  Run: `npm test`
  Expected: 584 tests pass (100% pass rate).

- [ ] **Step 2: Verify git status is clean**
  Run: `git status --short`
  Expected: Clean working tree.
