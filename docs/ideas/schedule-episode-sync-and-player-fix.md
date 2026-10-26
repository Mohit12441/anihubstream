# Schedule Episode Sync & Player Clamping Remediation

## Problem Statement
How Might We ensure that when an anime airs Episode 61 (or any new episode), clicking the schedule card seamlessly plays Episode 61 without clamping back to Episode 1, while the database sync engine continuously updates and upgrades ongoing episodes without hitting artificial caps?

## Recommended Direction
Implement a **Dual-Layer Episode Synchronization Architecture**:
1. **Frontend Virtual Shell Expansion (`src/pages/Watch.tsx`)**:
   - If the user navigates to `/watch/:id/:ep` (e.g. ep 61), and the stored database episodes array only has fewer episodes (e.g. 1 or 12), dynamically synthesize virtual episode shells up to `Math.min(Math.max(parsedEp, anime.episodeTotal, anime.episodeCount, episodes.length), 2000)`.
   - Prevent the player from clamping down to episode 1.
2. **Schedule Sync Database Upgrade (`tools/sync-ongoing-schedules.mjs`)**:
   - Extract `m.nextAiringEpisode.episode` from AniList GraphQL.
   - Update `episode_count = Math.max(COALESCE(episode_count, 0), nextEp - 1)` so the database knows which episodes are already released.
3. **Uncapped Episode Generator (`cloud-sync/sync-episodes.mjs`)**:
   - Remove the artificial 50-episode cap (`Math.min(..., 50)` -> support up to 2000).
   - Fix the ongoing anime filter to generate episodes for shows whose `episode_total` is `NULL` (TBA) by checking `COALESCE(a.episode_count, a.episode_total, 12)`.

## Key Assumptions to Validate
- [ ] Navigating to `/watch/:id/61` loads episode 61 into the player and does not redirect to `/watch/:id/1`.
- [ ] `sync-ongoing-schedules.mjs` updates `episode_count` in D1 alongside broadcast times.
- [ ] `sync-episodes.mjs` generates episodes beyond episode 50.

## MVP Scope
- Patch `src/pages/Watch.tsx` to prevent clamping and expand episode list to requested episode.
- Patch `tools/sync-ongoing-schedules.mjs` to ingest AniList episode numbers.
- Patch `cloud-sync/sync-episodes.mjs` to uncap episode generation.
- Add test in `tools/episode-schedule.test.mjs` to verify schedule-to-watch link integrity.

## Not Doing (and Why)
- Not querying 2000 external API thumbnail images in a single request (thumbnails for virtual shells gracefully use anime poster art).
