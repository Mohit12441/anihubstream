/* The one broadcast-season rule the catalogue speaks.

   Winter is January–March here, which is *not* AniList's convention (its `Season` enum puts Spring
   in March–May). The site's rule wins because the site is what reads the column back:
   `src/data/model.ts:13` declares `SEASON_START_MONTH = { Winter: 0, Spring: 3, Summer: 6,
   Fall: 9 }`, `currentSeasonKey()` derives the quarter the schedule page opens on from
   `getUTCMonth()`, and `functions/api/schedule.js:9` matches `sched_season` with an exact `=` — so
   a row labelled with AniList's quarters silently vanishes from the season on screen, and only for
   the four months the two conventions disagree about — AniList puts Spring in March, Summer in June,
   Fall in September and Winter in December, where this rule says Winter, Spring, Summer, Fall. The
   other eight months agree under both, so a wrong quarter is quiet: it hides one month in each
   quarter's first position rather than breaking anything.

   Three writers stamp that column (tools/hourly-refresh.mjs, tools/sync-catalogue.mjs,
   cloud-sync/sync-anilist.mjs) and the frontend computes a fourth copy, so the JS side calls this
   module while `src/data/model.ts` is pinned to it by a test that runs both derivations over the
   boundary instants (cloud-sync/config.test.mjs). Agreement is structural rather than asserted
   against source text: a refactor that preserves the behaviour cannot break it, and changing the
   rule in one place but not the other fails the moment it is made. */

/** The season word for a `getUTCMonth()` value: 0-2 Winter, 3-5 Spring, 6-8 Summer, 9-11 Fall. */
export const seasonOf = (month) => (month < 3 ? 'Winter' : month < 6 ? 'Spring' : month < 9 ? 'Summer' : 'Fall');

/** '<Season> <YYYY>' for a broadcast instant, given as a `Date` or as unix milliseconds.
    UTC throughout, because that is what the columns are compared against everywhere else. */
export const seasonKey = (when) => {
  const d = when instanceof Date ? when : new Date(when);
  return `${seasonOf(d.getUTCMonth())} ${d.getUTCFullYear()}`;
};
