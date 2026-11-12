# Codebase Cleanup and Deduplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deduplicate redundant streaming logic across providers, extract shared edge API wrappers, consolidate HLS download piping, and eliminate mirrored agent directories to reduce technical debt and maintenance overhead.

**Architecture:** 
1. Create `api/adapters/common.mjs` to encapsulate shared iframe regex extraction, MegaCloud/RapidCloud cipher helpers, and stream response normalizers for upstream providers (`anikoto`, `aniwatch`, `hianime`).
2. Add `createProviderRouteHandler` in `functions/api/_lib.js` to eliminate boilerplate query parameter parsing, 400 validation, and error reporting across provider edge endpoints.
3. Consolidate HLS playlist rendition and segment parsing across `functions/api/download.js` and `functions/api/download-pipe.js`.
4. Remove the redundant `.claude/` directory and configure `.agents/` as the single canonical directory.

**Tech Stack:** Node.js 22+ (ES Modules), Cloudflare Pages Functions, Cloudflare D1 (SQLite), Vite, React 18, `jscpd`.

**Spec:** [plan.md](file:///C:/anihubstream-backup/github/.planning/codebase-cleanup-and-deduplication/plan.md) and [critique.md](file:///C:/anihubstream-backup/github/.planning/codebase-cleanup-and-deduplication/critique.md).

## Global Constraints

- Do not alter external provider response contracts (JSON schema for `/api/resolve`, `/api/play`, `/api/search`).
- Preserve all provider-specific encryption keys and token generation algorithms (`MegaPlay WebCrypto`, `Zoko`).
- Keep all existing unit tests passing at every step (`npm test`).
- Ensure Windows compatibility (avoid raw symbolic links that require administrative privileges).

## Review Focus

1. Provider decryption failures: Parameterized cipher keys must not be cross-contaminated between Anikoto and HiAnime.
2. Missing or malformed query parameters in provider endpoints: Bad requests must still return HTTP 400 with matching error payload schema.
3. Download pipe streaming: Content-Disposition headers and byte-stream chunking must remain functional.
4. Windows path issues: Junction or direct deletion must not corrupt git working tree.
5. Regressions in Zero-Read Edge caching: Cache headers and cache key generation must remain unchanged.

---

### Task 1: Provider Stream Extraction & Decryption Utilities Extraction

**Files:**
- Create: `api/adapters/common.mjs`
- Modify: `api/anikoto.mjs:495-585`, `api/aniwatch.mjs:383-473`, `api/hianime.mjs:146-227`
- Test: `api/adapters/common.test.mjs`, `api/anikoto-isolated.test.mjs`, `api/hianime-isolated.test.mjs`

**Interfaces:**
- Produces:
  ```javascript
  export function extractEmbedUrl(html: string, pattern: RegExp): string | null
  export function parseSourceList(sources: Array<{ file: string, type?: string }>, tracks?: Array<any>): StreamSourcesResult
  export function normalizeStreamPayload(provider: string, data: any): StandardPlaybackPayload
  ```
- Consumes: Node built-in `crypto` and `URL`.

- [ ] **Step 1: Write the failing unit tests for common adapter helpers**

Create `api/adapters/common.test.mjs` testing `extractEmbedUrl`, `parseSourceList`, and `normalizeStreamPayload` with fixture payloads from Anikoto and HiAnime.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test api/adapters/common.test.mjs`
Expected: FAIL with "Cannot find module './common.mjs'"

- [ ] **Step 3: Implement `api/adapters/common.mjs`**

Implement the pure parsing and normalization helpers extracted from `api/anikoto.mjs` and `api/aniwatch.mjs`.

- [ ] **Step 4: Refactor `api/anikoto.mjs` and `api/aniwatch.mjs` to consume `common.mjs`**

Replace duplicate extraction and normalization blocks with imports from `./adapters/common.mjs`.

- [ ] **Step 5: Run tests to verify all pass**

Run: `node --test api/adapters/common.test.mjs api/anikoto-isolated.test.mjs api/hianime-isolated.test.mjs api/federated.test.mjs`
Expected: PASS with 0 failures.

- [ ] **Step 6: Commit**

```bash
git add api/adapters/common.mjs api/adapters/common.test.mjs api/anikoto.mjs api/aniwatch.mjs api/hianime.mjs
git commit -m "refactor: extract shared provider stream parsing utilities"
```

---

### Task 2: Provider Edge API Handlers Consolidation

**Files:**
- Modify: `functions/api/_lib.js`
- Modify: `functions/api/anikoto/play.js`, `functions/api/anikoto/[id].js`, `functions/api/anikoto/search.js`
- Modify: `functions/api/hianime/play.js`, `functions/api/hianime/[id].js`, `functions/api/hianime/search.js`
- Test: `api/edge-routes-cache.test.mjs`, `api/anikoto-isolated.test.mjs`

**Interfaces:**
- Produces:
  ```javascript
  export function createProviderRouteHandler(options: {
    providerName: string,
    requiredParams?: string[],
    handle: (context: { request: Request, env: any, params: Record<string, string>, url: URL }) => Promise<Response>
  }): (context: EventContext) => Promise<Response>
  ```
- Consumes: `HttpError`, `errorResponse`, `json`, `ok` from `functions/api/_lib.js`.

- [ ] **Step 1: Write a unit test for `createProviderRouteHandler`**

Add tests in `api/edge-routes-cache.test.mjs` verifying:
- Missing required query parameters return HTTP 400.
- Caught errors are formatted using `errorResponse`.
- Successful handler results return expected JSON headers.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test api/edge-routes-cache.test.mjs`
Expected: FAIL with "`createProviderRouteHandler` is not a function".

- [ ] **Step 3: Implement `createProviderRouteHandler` in `functions/api/_lib.js`**

Add the higher-order wrapper managing parameter validation, error interception, and CORS headers.

- [ ] **Step 4: Refactor provider endpoints in `functions/api/anikoto/` and `functions/api/hianime/`**

Migrate `play.js`, `[id].js`, and `search.js` to use `createProviderRouteHandler`, deleting duplicate try/catch and parameter checking blocks.

- [ ] **Step 5: Run tests to verify all pass**

Run: `npm test`
Expected: PASS (all 581 tests pass).

- [ ] **Step 6: Commit**

```bash
git add functions/api/_lib.js functions/api/anikoto/ functions/api/hianime/ api/edge-routes-cache.test.mjs
git commit -m "refactor: consolidate provider edge route handlers"
```

---

### Task 3: Download and HLS Streaming Consolidation Cleanup

**Files:**
- Modify: `functions/api/_lib.js:660-725`
- Modify: `functions/api/download.js`
- Modify: `functions/api/download-pipe.js`
- Test: `api/download.test.mjs`

**Interfaces:**
- Consumes: `parseMasterVariants`, `parseMediaSegments` in `functions/api/_lib.js`.
- Produces: Consistent download stream response streams and metadata payloads.

- [ ] **Step 1: Verify existing test suite for download routes**

Run: `node --test api/download.test.mjs`
Expected: PASS.

- [ ] **Step 2: Streamline `functions/api/download-pipe.js` to reuse core streamer logic**

Delegate shared stream fetching, decryption, and abort handling to the shared utilities in `_lib.js`.

- [ ] **Step 3: Run test to verify compatibility**

Run: `node --test api/download.test.mjs`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add functions/api/_lib.js functions/api/download.js functions/api/download-pipe.js
git commit -m "refactor: eliminate duplicate HLS download logic"
```

---

### Task 4: Agent Configuration Directory Consolidation

**Files:**
- Delete or replace: `.claude/`
- Preserve: `.agents/`

**Interfaces:**
- Ensure any CLI tool expecting `.claude/` resolves to `.agents/` via an NTFS directory junction on Windows.

- [ ] **Step 1: Check contents parity between `.agents/` and `.claude/`**

Run: `Get-ChildItem -Recurse .claude | Measure-Object; Get-ChildItem -Recurse .agents | Measure-Object`

- [ ] **Step 2: Remove redundant `.claude/` directory and create junction**

Execute in PowerShell:
```powershell
Remove-Item -Recurse -Force .claude
New-Item -ItemType Junction -Path .claude -Target .agents
```

- [ ] **Step 3: Verify with `jscpd` duplicate detector**

Run: `npx jscpd -r console -i "**/node_modules/**,**/dist/**,**/dist-pages/**,**/build/**,**/.git/**,**/.planning/**,**/data/**,**/.wrangler/**" .`
Expected: Duplication drops below 3% repository-wide.

- [ ] **Step 4: Commit**

```bash
git add .agents .gitignore
git commit -m "chore: consolidate agent specs and eliminate duplicate directory"
```
