# Search UI & Backend Architecture Optimization

## Problem Statement
How might we engineer an ultra-fast, multi-provider anime search engine that consolidates backend lookups into a single sub-15ms edge pass, while offering an instant, debounced responsive UI with dual-mode views (Unified Grid vs Provider Rows) and faceted filtering?

## Recommended Direction
1. **Single-Pass Edge Backend (`functions/api/search.js`)**:
   - Replace 4 sequential D1 queries with a single unified query aggregating provider mappings via `GROUP_CONCAT(pm.provider_id || ':' || pm.provider_slug)`.
   - Provide full metadata per title (`rating`, `year`, `episodes`, `genres`, `format`, `status`, `providers`) in one round-trip.
   - Retain `groupedProviders` in the payload for full backwards compatibility.
2. **Modern Dual-View Search UI (`src/pages/Search.tsx`)**:
   - 250ms debounced search-as-you-type with stale request cancellation (`AbortController`).
   - Layout mode toggle: **Unified Grid View** (deduplicated cards with 1-click provider launcher pills) vs **Grouped Shelves View** (classic horizontal provider carousels).
   - Faceted Filter bar: Provider filter (`All`, `AniKoto`, `HiAnime`, `AniWatch`), Status (`All`, `Ongoing`, `Finished`), and Sort (`Trending`, `Top Rated`, `Newest`).

## Key Assumptions to Validate
- [ ] D1 single-pass join query runs in <15ms on local Miniflare.
- [ ] Typing at 250ms debounce with request abortion causes zero flicker, jitter, or race conditions.
- [ ] Direct provider launch pills from search cards route properly into `/watch/:id/1?provider=:prov`.

## MVP Scope
- `functions/api/search.js`: Consolidated single-pass D1 query + provider aggregation.
- `src/pages/Search.tsx`: Dual-mode UI, debounced search, faceted filter bar, responsive grid.
- `tools/benchmark-search.mjs`: Automated latency benchmark.
- `api/search-optimized.test.mjs`: Unit tests for the search contract.

## Not Doing (and Why)
- **Heavy Client-Side Lucene/FlexSearch Engine**: Search should remain edge-native and D1-backed to avoid sending megabytes of index files to mobile clients.
- **Complex Full-Text Spellcheck Dictionary**: Exact substring and normalized `search_text` matching in SQLite provides high hit rates without bundle bloat.
