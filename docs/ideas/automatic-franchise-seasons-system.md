# Automatic Franchise & Seasons System

## Problem Statement
How Might We automatically discover, link, and maintain bidirectional franchise season graphs across our entire catalog without manual curation, so any anime viewed on the Watch page instantly has all its seasons, sequels, and canon movies ready to stream?

---

## Recommended Direction: Hybrid Graph Engine (JIT Edge Resolver + D1 Relation Table & Backfill Worker)

The recommended direction is a **two-tier Hybrid Franchise Engine**:
1. **Tier 1: Fast Edge JIT & Memory Cache (`functions/api/_lib.js`)**:
   - Resolves seasons dynamically on any request using `resolveFranchiseSeasons(db, card)`: checks direct relations, reverse `alt_seasons`, and hierarchical slug prefixes.
   - Fallback synthesis allows newly requested titles or alternate seasons to immediately stream without waiting for an offline backfill.
2. **Tier 2: Normalized D1 Relation Graph (`anime_franchise_relation`) + Background Sync Worker**:
   - Creates a dedicated normalized table in Cloudflare D1:
     ```sql
     CREATE TABLE IF NOT EXISTS anime_franchise_relation (
       anime_id TEXT NOT NULL,
       related_id TEXT NOT NULL,
       relation_type TEXT NOT NULL, -- 'sequel', 'prequel', 'movie', 'main'
       chronology_order INTEGER DEFAULT 0,
       created_at TEXT DEFAULT (datetime('now')),
       PRIMARY KEY (anime_id, related_id)
     );
     CREATE INDEX IF NOT EXISTS idx_afr_anime ON anime_franchise_relation(anime_id);
     CREATE INDEX IF NOT EXISTS idx_afr_related ON anime_franchise_relation(related_id);
     ```
   - An automated sync utility (`tools/auto-sync-franchises.mjs`) crawls AniList/MAL relations (`PREQUEL`, `SEQUEL`, `PARENT`, `ALTERNATIVE`) and topological title clusters.
   - Automatically populates and updates `anime_franchise_relation` across all 10,000+ anime in D1.
   - When present in D1, `/api/anime/:id` executes a single indexed `O(1)` query (`SELECT ... FROM anime_franchise_relation WHERE anime_id = ?`) instead of fuzzy string matching, dropping latency to < 5ms.

---

## Key Assumptions to Validate
- [ ] **Assumption 1: AniList GraphQL and MAL relations correctly identify mainline sequels vs irrelevant spin-offs.**
  - *Validation*: Test sync against complex multi-arc franchises (e.g. *Monogatari*, *Fate*, *Gundam*, *Attack on Titan*, *Demon Slayer*).
- [ ] **Assumption 2: Slug clustering (`id LIKE 'base-%'`) maintains 99%+ accuracy without polluting unrelated titles.**
  - *Validation*: Audit database for collisions (e.g. ensuring `naruto` doesn't conflict with short-named unrelated titles).
- [ ] **Assumption 3: D1 storage and query performance for `anime_franchise_relation`.**
  - *Validation*: Benchmark query latency on local Miniflare D1 SQLite with 50,000 relations. Target: < 5ms per lookup.

---

## MVP Scope (Thin Vertical Slice)

### In-Scope (Phase 1):
1. **D1 Schema Extension**:
   - Add `anime_franchise_relation` table definition to `schema.sql` with indices on `anime_id` and `related_id`.
2. **Automated Offline Sync Tool (`tools/auto-sync-franchises.mjs`)**:
   - Traverses existing D1 anime records.
   - Extracts AniList relations from `tools/catalogue-sources.json` and title/slug heuristics.
   - Upserts bidirectional links (`sequel`, `prequel`, `movie`) with chronological ordering.
3. **Edge Query Optimization (`functions/api/_lib.js`)**:
   - Check `anime_franchise_relation` first. If populated, return relations in exact chronological order.
   - If not yet backfilled, fall back transparently to existing `resolveFranchiseSeasons()` JIT matching.
4. **Automated Cron / CLI Task**:
   - Integrate `auto-sync-franchises.mjs` into `npm run supervise` and hourly sync cycle.

### Out-of-Scope (Not Doing in MVP):
- **Complex Non-Canon Spinoffs**: Excluding recap specials, music videos (MV), chibi shorts, and promotional PVs from the main Watch sidebar to prevent cluttering the user interface.
- **Client-Side Tree Graph Visualizer**: Avoiding complex multi-branch flowchart UIs; keeping the frontend interface as a clean, responsive `<select>` dropdown.
- **Manual Admin Web Portal**: No manual CMS form needed; the entire discovery, linking, and backfill process is 100% automated.

---

## Not Doing (and Why)
- **Pure Manual Mapping Tables**: Storing thousands of manual JSON mappings would create high maintenance debt and quickly rot as new seasons air.
- **Pure Dynamic JIT Only**: Relying solely on runtime fuzzy queries would incur repetitive SQLite string scanning and regex overhead on high-traffic edge requests.
- **Preserving Episode Index Across Seasons**: If an episode index (e.g. Ep 12) is preserved when jumping to a 10-episode Season 2, it causes out-of-bounds playback errors. Auto-redirecting to Episode 1 guarantees instant, reliable playback.

---

## Open Questions & Next Steps
1. **Should Canon Movies be labeled distinctly in the dropdown?**
   - *Example*: `"Jujutsu Kaisen 0 (Movie · 2021)"` vs `"JUJUTSU KAISEN Season 2 (2023)"`.
2. **Execution Timing**:
   - Ready to generate the D1 migration and implement `tools/auto-sync-franchises.mjs` immediately?
