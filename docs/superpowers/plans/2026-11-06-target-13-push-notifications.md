# Airing Schedule Push Notifications (Web Push via VAPID) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement full Web Push notification architecture (RFC 8291 / RFC 8292 VAPID) for browser airing alerts when bookmarked ongoing anime air new episodes, even when the browser tab is closed.

**Architecture:** 
- Hybrid Edge + Service Worker Push: Cloudflare Pages Functions (`functions/api/notifications/`) handle VAPID public key export and D1 subscription storage with Zero-Read Edge caching standards.
- Service Worker (`public/sw.js`) listens for push events to display rich notifications with click-to-watch routing.
- Backend dispatch engine (`tools/notify-airing.mjs`) scans scheduled broadcasts, queries matching D1 subscriptions, encrypts payloads via Web Push ECDSA P-256 + aes128gcm, and prunes expired endpoints.
- Client notification library (`src/lib/notifications.ts`) and `AiringCountdown.tsx` seamlessly negotiate push permissions and register browser push subscriptions with the server.

**Tech Stack:** 
- Cloudflare Pages Functions, Cloudflare D1 (SQLite), Web Push API, Service Worker PushManager, WebCrypto (NIST P-256, HMAC-SHA256, AES-GCM-128), React 18, TypeScript.

**Spec:** Target 13 in `TASK_REPORT.md` (Sections 31–37) & EAF Standards in `AGENTS.md`.

## Global Constraints
- D1 queries MUST use `env.ANIHUB.prepare(...).bind(...)` with parameterized inputs.
- Never commit private VAPID credentials to version control; derive or inject via `.dev.vars` and environment variables.
- Zero-Read D1 Caching Law (Rule 11): public read endpoints must use `withEdgeCache` with stripped cookies.
- All existing tests (`npm test`, `npm run test:cache`, `npm run build`, `npx tsc --noEmit`) must remain green.

## Review Focus
1. Browser revokes push permission while subscription remains in D1 -> Dispatch engine receives HTTP 410/404 Gone and safely deletes stale endpoint.
2. User toggles reminder while offline or in Safari/Firefox without Web Push active -> Graceful fallback to client-side localStorage notifications without breaking UI.
3. VAPID public key Uint8Array padding/decoding edge cases in browser -> Robust `urlBase64ToUint8Array` helper with padding normalization.
4. Duplicate subscriptions or multiple devices for one user -> Subscription table indexed on unique `endpoint` with JSON array of `anime_ids`.
5. Edge function rate limits or subrequest quota exhaustion -> Batch dispatch with rate throttling and concurrency control.

---

### Task 1: D1 Database Schema Migration for Push Subscriptions

**Files:**
- Modify: `schema.sql:205-225`
- Test: `tools/push-notifications.test.mjs`

- [x] Write failing test in `tools/push-notifications.test.mjs` testing `push_subscriptions` table creation and indexing.
- [x] Add `push_subscriptions` table definition to `schema.sql`:
  - `id TEXT PRIMARY KEY`
  - `endpoint TEXT NOT NULL UNIQUE`
  - `p256dh TEXT NOT NULL`
  - `auth TEXT NOT NULL`
  - `anime_ids TEXT NOT NULL DEFAULT '[]'`
  - `created_at TEXT DEFAULT (datetime('now'))`
  - `updated_at TEXT DEFAULT (datetime('now'))`
  - Index `idx_push_endpoint` on `push_subscriptions(endpoint)`.
- [x] Execute migration on local Miniflare D1 database using DatabaseSync.
- [x] Verify test passes.

### Task 2: VAPID Key Utilities & Edge Key Export Route

**Files:**
- Create: `functions/api/notifications/vapid-public-key.js`
- Create: `functions/api/_vapid.js`
- Modify: `.dev.vars`
- Test: `tools/push-notifications.test.mjs`

- [x] Write failing test in `tools/push-notifications.test.mjs` verifying VAPID key generation and `/api/notifications/vapid-public-key` response contract `{ ok: true, data: { publicKey: string } }`.
- [x] Create `functions/api/_vapid.js` containing WebCrypto VAPID utilities (P-256 key generation, JWT header/payload derivation, and signature verification).
- [x] Create `functions/api/notifications/vapid-public-key.js` exporting the public key using `withEdgeCache`.
- [x] Add test VAPID key pair to `.dev.vars` for local Miniflare emulation.
- [x] Verify test passes.

### Task 3: Subscription Management Edge Endpoints

**Files:**
- Create: `functions/api/notifications/subscribe.js`
- Create: `functions/api/notifications/unsubscribe.js`
- Test: `tools/push-notifications.test.mjs`

- [x] Write failing test in `tools/push-notifications.test.mjs` testing POST `/api/notifications/subscribe` (upserting endpoint and adding anime ID) and POST `/api/notifications/unsubscribe`.
- [x] Implement `functions/api/notifications/subscribe.js`:
  - Validates `endpoint`, `keys.p256dh`, `keys.auth`, and `animeId`.
  - Upserts into `push_subscriptions` using `env.ANIHUB.prepare(...)`.
  - Merges `animeId` into the `anime_ids` JSON array without duplicates.
- [x] Implement `functions/api/notifications/unsubscribe.js`:
  - Removes `animeId` from `anime_ids`, or deletes the row if no anime IDs remain or `all: true`.
- [x] Verify test passes.

### Task 4: Service Worker Push Event & Notification Click Routing

**Files:**
- Modify: `public/sw.js:260-283`
- Test: `tools/push-notifications.test.mjs`

- [x] Write failing test in `tools/push-notifications.test.mjs` verifying `public/sw.js` has `'push'` event listener, payload extraction, and correct `'notificationclick'` navigation logic.
- [x] Modify `public/sw.js` to add `self.addEventListener('push', (event) => ...)`:
  - Extracts payload JSON `{ title, body, icon, badge, data: { url, animeId, episode } }`.
  - Calls `event.waitUntil(self.registration.showNotification(title, options))`.
- [x] Update `notificationclick` listener to support deep-linking directly to `/watch/${animeId}/${episode}` and focusing existing window tabs.
- [x] Verify test passes.

### Task 5: Airing Notification Dispatcher Tool

**Files:**
- Create: `tools/notify-airing.mjs`
- Test: `tools/push-notifications.test.mjs`

- [x] Write failing test in `tools/push-notifications.test.mjs` testing scheduled anime detection and subscription notification dispatch with pruning on 410/404.
- [x] Create `tools/notify-airing.mjs`:
  - Queries upcoming schedule from D1 within window (e.g. within 15 minutes).
  - Finds all matching push subscriptions.
  - Generates RFC 8291 encrypted Web Push payloads and sends via standard `fetch`.
  - Automatically deletes invalid/expired (410 Gone / 404 Not Found) subscriptions from D1.
- [x] Add npm script `"notify:airing": "node tools/notify-airing.mjs"` to `package.json`.
- [x] Verify test passes.

### Task 6: Frontend Client Integration & UI Airing Reminders

**Files:**
- Modify: `src/lib/notifications.ts`
- Modify: `src/components/AiringCountdown.tsx`
- Test: `tools/push-notifications.test.mjs`

- [x] Add `subscribePushManager()` and `unsubscribePushManager()` in `src/lib/notifications.ts`:
  - Fetches VAPID public key from `/api/notifications/vapid-public-key`.
  - Calls `registration.pushManager.subscribe(...)`.
  - Posts subscription to `/api/notifications/subscribe`.
- [x] Wire remote push subscription into `toggleSubscription()` in `src/lib/notifications.ts`.
- [x] Update `AiringCountdown.tsx` to handle loading/subscribing states and show feedback.
- [x] Run `npx tsc --noEmit` to verify type safety.

### Task 7: Full Verification & Quality Gate Audit

**Files:**
- All modified and created files
- Test: `tools/push-notifications.test.mjs`, `npm run test:cache`, `npm run build`

- [x] Run `npm run test:cache` (Zero-Read D1 caching test).
- [x] Run `node --test tools/push-notifications.test.mjs`.
- [x] Run `npx tsc --noEmit` and `npm run build`.
- [x] Check local health endpoint `http://127.0.0.1:8899/api/health`.
