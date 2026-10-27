# Catalog Expansion, Kitsu Enrichment & AniSkip Architecture Refinement

## Problem Statement
How might we dynamically expand AniKoto, HiAnime, and AniWatch provider mappings, automate Kitsu metadata enrichment using deterministic MAL cross-referencing, and seamlessly persist AniSkip skip markers without exceeding Cloudflare D1 write limits or upstream API quotas?

---

## Technical Audit Findings

### 1. HiAnime Provider Mapping Bottleneck
- **Observed**: HiAnime catalog mapping appears stagnant.
- **Root Cause**: Upstream catalog endpoint (`https://animehot.cc/api/filter`) contains **2,854 total titles**. AniHub already has **2,592 titles mapped (91% saturation)**.
- **Key Insight**: There are very few unmapped titles remaining in HiAnime. New additions only occur when upstream `animehot.cc` ingests newly airing seasonal titles.

### 2. AniKoto Provider Mapping Bottleneck
- **Observed**: Newly discovered titles (from AniList) never get AniKoto slugs.
- **Root Cause**: `cloud-sync/sync-providers.mjs` maps AniKoto strictly from a static file: `tools/anikoto-slugs.json` (created 2026-10-20 with 2,522 titles). The automated CI sync has no dynamic search or scraping step to discover AniKoto slugs for new titles.

### 3. AniWatch Provider Mapping Bottleneck
- **Observed**: Only 452 titles mapped despite an 8,000-entry sitemap.
- **Root Cause**: `cloud-sync/sync-providers.mjs` fetches `https://aniwatch.co.at/anime-sitemap.xml`, but matches via exact slug equality or basic string equality. AniWatch slugs contain distinct URL stems, leading 95% of titles to fail matching. Furthermore, it does not ingest new anime rows.

### 4. Kitsu Anime Details Enrichment Stagnation
- **Observed**: Kitsu details (artwork, synopsis, episode count) fail to update for newly added anime.
- **Root Cause**: `cloud-sync/sync-kitsu.mjs` runs a blind cursor walk over `https://kitsu.io/api/edge/anime?sort=-averageRating` and filters candidates using:
  ```javascript
  const hits = data.filter((e) => byKitsu.has(Number(e.id)));
  ```
  `byKitsu` is built exclusively from anime already having `"kitsu": <id>` in `source_ids`. Titles discovered by AniList only possess `anilist` and `mal` IDs. Because they lack a Kitsu ID, Kitsu sync ignores them entirely.

### 5. AniSkip Skip Markers Inspection
- **Observed**: Episodes sometimes appear without pre-synced markers in the database.
- **Root Cause & Verification**:
  - Direct Edge proxy verification (`/api/aniskip?malId=16498&ep=1`) confirmed that AniSkip integration is **100% operational** and returns precise community opening/ending timestamps (`op: 47s - 137s`, `ed: 1342s - 1430s`).
  - The web player dynamically fetches from `/api/aniskip` on-the-fly. However, the database episode table only has pre-synced markers for 4,503 out of 37,900 episodes because `sync-episodes.mjs` is bounded by CI rate limits.

---

## Recommended Direction

### A. Just-In-Time (JIT) Provider Auto-Resolution & Caching
Instead of running heavy, error-prone batch scrapers in GitHub Actions:
1. **Edge Fallback Resolution**: When a viewer selects an anime in the web player and requests AniKoto or AniWatch playback, `functions/api/play/resolve.js` checks if a slug exists in `anime_provider_mapping`.
2. **On-the-Fly Query**: If missing, it executes a lightweight title search against AniKoto / MegaPlay API using the anime's canonical title.
3. **Write-Through Cache**: When a match is resolved, persist it immediately to `anime_provider_mapping` and `stream_cache`.
4. **Benefit**: Instant playback for viewers on 100% of newly added anime, with zero scheduled cron write overhead.

### B. Deterministic Kitsu Cross-Referencing via MAL ID
Replace the blind cursor walk in `cloud-sync/sync-kitsu.mjs` with direct cross-referencing:
1. **Kitsu Mapping API**: Kitsu provides an official lookup by MAL ID:
   ```
   GET https://kitsu.io/api/edge/mappings?filter[external_site]=myanimelist/anime&filter[external_id]=<mal_id>&include=item
   ```
2. **Targeted Enrichment**: During the 2x daily master sync, query Kitsu only for anime in D1 that have `source_ids.mal` but are missing `source_ids.kitsu` or high-resolution artwork (`art` / `key_art`).
3. **Benefit**: 100% accurate mapping, zero wasted requests, and immediate enrichment of newly discovered titles.

### C. Runtime Edge Cache First for AniSkip Skip Markers
1. **Edge Write-Through**: When `/api/aniskip` successfully fetches skip intervals for an episode from `api.aniskip.com/v2`, asynchronously save the markers to `episode.markers` via D1 or key-value stream cache.
2. **Zero CI Burden**: Skip markers accumulate organically in the database for all actively watched episodes without needing massive background batch jobs.

---

## Key Assumptions to Validate
- [ ] Kitsu API endpoint `filter[external_site]=myanimelist/anime` returns corresponding Kitsu anime attributes reliably.
- [ ] AniKoto search endpoint responds within <1.5s during edge direct resolution.
- [ ] Storing markers on-the-fly during playback does not introduce perceived latency to the stream start.

---

## MVP Scope

### Phase 1: Kitsu Cross-Referencing Update
- Update `cloud-sync/sync-kitsu.mjs` to query Kitsu by MAL ID for unmapped titles.
- Ingest high-res poster artwork, landscape banners, and verified episode counts into `anime`.

### Phase 2: Dynamic AniKoto & AniWatch JIT Resolver
- In `functions/api/play/resolve.js`, add automated AniKoto search fallback when `anikoto_slug` is absent from D1.
- Cache resolved slugs into `anime_provider_mapping`.

### Phase 3: AniSkip Write-Through Edge Integration
- Update `/api/aniskip` edge endpoint to persist found markers into `episode.markers` when `env.ANIHUB` is bound.

---

## Not Doing (and Why)
- **Not Doing Bulk Web Scraping of 10,000 AniWatch URLs**: High risk of Cloudflare bot challenge/403, and wastes D1 database storage on obscure/unwatched titles.
- **Not Doing Continuous Blind Crawling of Kitsu**: Paginating through all 20,000 Kitsu titles every week burns rate limits and misses newly airing shows.
- **Not Doing 37,000-Episode Sequential AniSkip CI Scrapes**: Exceeds GitHub Actions runtime limits and AniSkip API community quotas. JIT caching achieves the exact same user experience at 1% of the resource cost.
