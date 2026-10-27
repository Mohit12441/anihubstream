# Scheduled Anime Auto-Sync & Episode Backfill Plan

## Problem Statement
How Might We automatically audit and backfill all 89 scheduled anime so that every title has an accurate `sched_episode` and complete episode shells (1..N) populated in D1, while establishing a zero-maintenance daily automated cron that keeps ongoing broadcasts in sync forever?

## Recommended Direction
1. **Live Batch Auto-Sync Runner (`tools/sync-ongoing-schedules.mjs`)**:
   - Execute AniList batch GraphQL query across all 89 scheduled anime in 2 requests (45 IDs per batch).
   - Ingest `nextAiringEpisode.episode` into `sched_episode`.
   - Use `INSERT OR IGNORE` to safely backfill missing episode shells `1 .. latestAired` without overwriting existing enriched episode data.
2. **Automated Cron Schedule**:
   - Register `npm run sync:schedule` into `.github/workflows/catalog-sync.yml` so it runs automatically every 12 hours (at 02:00 and 14:00 UTC).
   - Can also be manually run anytime with `npm run sync:schedule`.

## Key Assumptions to Validate
- [ ] All 89 scheduled anime have valid AniList IDs (Validated: 100% matched).
- [ ] 2 GraphQL batch requests execute without hitting rate limits (45 IDs/request).
- [ ] `INSERT OR IGNORE` preserves existing rich metadata (thumbnails, titles) while filling the 60 empty titles.

## MVP Scope
- Update and run `tools/sync-ongoing-schedules.mjs` against the local D1 database.
- Verify that `ep_count` is no longer 0 for the 60 previously empty titles.
- Verify that `sched_episode` is populated across all scheduled titles.
- Confirm integration into `.github/workflows/catalog-sync.yml`.

## Not Doing (and Why)
- Not running individual unbatched API calls (would burn 90 requests/min rate limit).
- Not wiping existing episodes with `DELETE` (preserves existing watch positions, bookmarks, and skip markers).
