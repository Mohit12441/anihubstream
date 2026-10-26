# Zero-Read D1 Edge & Local-First Architecture

## Problem Statement
How Might We eliminate Cloudflare D1 database row read consumption down to zero for 99.9% of user traffic, keeping AniHubStream completely free forever on Cloudflare's free tier while maintaining instant streaming, sub-10ms page loads, and real-time episode synchronization?

## Recommended Direction
Implement a **Tri-Shield Zero-Read Architecture**:
1. **Edge Cache Shield (`caches.default` with Dev Fallback)**: Wrap public endpoints (`/api/home`, `/api/anime/:id`, `/api/genres`, `/api/schedule`, `/api/search/instant`) with normalized cache keys, stripping cookie headers, and using stale-while-revalidate.
2. **In-Flight Single-Flight Collapsing**: Prevent cache stampedes / dogpiling by coalescing concurrent in-flight requests in worker isolate memory into a single D1 execution.
3. **Local-First Client Layer**: Client storage (`IndexedDB`/`localStorage`) serves as primary reader for bookmarks and watch progress, eliminating startup reads from D1.
4. **Lightweight Static Snapshots**: Optional GitHub Action running every 6 hours generates pre-rendered `home.json` deployed as static Pages assets (0 workers, 0 D1 reads).

## Key Assumptions to Validate
- [ ] Universal Cache Adapter works seamlessly both in production Cloudflare (`caches.default`) and local Miniflare dev environment (`in-memory fallback`).
- [ ] Stripping `Cookie` / `Set-Cookie` on public feeds allows Cloudflare CDN to cache responses with zero D1 hits.
- [ ] Single-flight Promise map prevents concurrent D1 queries during cache misses.

## MVP Scope
1. **Universal Edge Cache & Single-Flight Helper in `functions/api/_lib.js`**:
   - `withEdgeCache(request, env, ttlSeconds, computeFn, options)`
   - Normalized URL cache key (whitelists valid params, lowercases values, removes cookie tracking)
   - Dev-mode in-memory cache fallback
   - Single-flight Promise deduplication
   - `X-D1-Read` header for easy verification in DevTools (`0-edge-hit`, `0-inflight-piggyback`, `1-d1-fresh`)
2. **Endpoint Integration**:
   - Wire `withEdgeCache` into `functions/api/home/index.js` (2 hours TTL)
   - Wire `withEdgeCache` into `functions/api/genres.js` (24 hours TTL)
   - Wire `withEdgeCache` into `functions/api/schedule.js` (1 hour TTL)

## Not Doing (and Why)
- **Workers KV**: Free tier 100k read/day cap is easily exhausted under high traffic; `caches.default` has unlimited free reads.
- **Full Database Sharding**: Excessive operational complexity for SQLite.
- **Complex Redis sidecars**: Violates the pure Cloudflare edge + zero-cost boundary.

## Open Questions & Future Enhancements
- Pre-building a static client-side title search index for offline / instant search hints.
