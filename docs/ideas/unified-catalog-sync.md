# Master Multi-Provider Catalog Synchronization

## Problem Statement
How might we orchestrate a unified, rate-controlled, and automated catalog synchronization pipeline that keeps all 5 providers (AniList, Kitsu, HiAnime, AniKoto, AniWatch), ongoing broadcast schedules, and franchise relation graphs continuously updated while strictly adhering to Cloudflare D1's 100,000 daily row write limit?

## Recommended Direction
We have implemented and deployed the master orchestrated catalog workflow (`.github/workflows/catalog-sync.yml`) that replaces hyper-aggressive individual polling loops with a structured 6-phase pipeline running 2x daily (02:00 and 14:00 UTC):
1. **Phase 1: Trending Discovery & AniList**: Scans AniList trending for newly debuted titles and updates Japanese/English titles, scores, genres, and synopsis.
2. **Phase 2: Kitsu Media Enrichment**: Enriches the catalog with official high-resolution posters, banners, and verified canonical episode counts.
3. **Phase 3: HiAnime Slugs & Streams**: Synchronizes HiAnime slugs, sub/dub episode counts, and MAL-to-HiAnime mappings.
4. **Phase 4: AniKoto & AniWatch Mapping**: Maps multi-audio AniKoto stream embeds and AniWatch fallback slugs into `anime_provider_mapping` and `anime_id_map`. Normalizes catalog ratings to a uniform 10-point scale.
5. **Phase 5: Franchise Relations Graph**: Recomputes bidirectional prequels, sequels, side-stories, movies, and chronological ordering in `anime_franchise_relation`.
6. **Phase 6: Ongoing Broadcast Schedules**: Queries AniList for live airing dates, upcoming episode numbers, and cleans stale slots for completed anime.

## Key Assumptions to Validate
- [x] Cloudflare D1 Free Tier allows 100,000 row writes per 24-hour UTC window (`d1.platform.limits`).
- [x] Running 2x daily consumes ~5,000–9,000 writes/day, retaining an 91%+ quota buffer.
- [x] Each phase is insulated with `continue-on-error: true` so an upstream third-party API timeout never breaks downstream provider mappings.

## MVP Scope
- Master workflow: `.github/workflows/catalog-sync.yml`
- Multi-provider synchronizer: `cloud-sync/sync-providers.mjs`
- Automated test suites: `cloud-sync/sync-providers.test.mjs`, `cloud-sync/config.test.mjs`, `ops/github-sync-dispatcher/test/dispatcher.test.mjs`
- Cloudflare worker dispatcher integration: `ops/github-sync-dispatcher/src/index.mjs`

## Not Doing (and Why)
- **Not running every 10–30 minutes**: High-frequency syncs waste 90% of the daily D1 write quota on lease locks and metadata logging.
- **Not running browser scraper tools in GitHub Actions**: We strictly use lightweight REST and GraphQL endpoints (`d1.mjs`, AniList GraphQL, Kitsu API, HiAnime API, AniWatch sitemap).
- **Not hardcoding secrets**: All D1 and Cloudflare tokens are sourced dynamically from GitHub Secrets (`CF_ACCOUNT_ID`, `CF_DATABASE_ID`, `CF_API_TOKEN`).
