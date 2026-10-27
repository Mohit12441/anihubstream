import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from './discover-titles.mjs';
import { slugify as cloudSlugify } from '../cloud-sync/sync-anilist.mjs';

describe('TASK 7 (P1) — Robust Slug Generator', () => {
  it('strips apostrophes without turning them into "-s"', () => {
    assert.equal(slugify("Knight's & Magic"), 'knights-magic');
    assert.equal(slugify("I'm the Villainess, So I'm Taming the Final Boss"), 'im-the-villainess-so-im-taming-the-final-boss');
    assert.equal(slugify("A Returner's Magic Should Be Special"), 'a-returners-magic-should-be-special');
    assert.equal(slugify("My Status as an Assassin Obviously Exceeds the Hero's"), 'my-status-as-an-assassin-obviously-exceeds-the-heros');
    assert.equal(slugify("Frieren: Beyond Journey's End"), 'frieren-beyond-journeys-end');
  });

  it('collapses consecutive repeated tokens and hyphens', () => {
    assert.equal(
      slugify('The 100 Girlfriends Who Really, Really, Really, Really, REALLY Love You'),
      'the-100-girlfriends-who-really-love-you',
    );
    assert.equal(slugify('Attack---on---Titan'), 'attack-on-titan');
  });

  it('never truncates mid-word and avoids dangling prepositions', () => {
    const title = 'The Laid-off Cheat-Granting Mage Enjoys a Second Lease on Life';
    const slug = slugify(title);
    assert.equal(slug, 'the-laid-off-cheat-granting-mage-enjoys-a-second-lease-on-life');
    assert.ok(!slug.endsWith('-on'), 'Must not truncate at "on" leaving an incomplete sentence');

    // Super long title exceeding 80 chars
    const superLong = 'This Is An Extremely Long Anime Title That Keeps Going On And On Without Ending For No Good Reason At All';
    const truncated = slugify(superLong, { maxLength: 50 });
    assert.ok(truncated.length <= 50, `Length ${truncated.length} should be <= 50`);
    assert.ok(!truncated.includes('-on-'), 'Should not leave broken tokens');
    // Ensure it ends at a complete word, not mid-word
    assert.ok(!truncated.endsWith('-'), 'Must not end in a hyphen');
    assert.ok(!/-(?:on|in|at|to|for|of|with|a|an|the)$/.test(truncated), 'Must not end in a dangling preposition');
  });

  it('appends a short hash only on real collision, not raw 6-digit IDs', () => {
    const existing = new Set(['solo-leveling']);

    // No collision -> clean slug without hash
    const noCollision = slugify('Solo Leveling Season 2', { existingIds: existing });
    assert.equal(noCollision, 'solo-leveling-season-2');

    // Real collision -> appends short 4-char hash
    const collision = slugify('Solo Leveling', { existingIds: existing, collisionId: 151807 });
    assert.match(collision, /^solo-leveling-[a-z0-9]{4}$/);
    assert.ok(!collision.includes('151807'), 'Must not append raw 6-digit numeric ID');
  });

  it('ensures discover-titles and cloud-sync slugify functions remain identical', () => {
    const testCases = [
      "Knight's & Magic",
      "The 100 Girlfriends Who Really, Really, Really, Really, REALLY Love You",
      "The Laid-off Cheat-Granting Mage Enjoys a Second Lease on Life",
      "My Status as an Assassin Obviously Exceeds the Hero's",
    ];

    for (const tc of testCases) {
      assert.equal(slugify(tc), cloudSlugify(tc), `Divergence found for: ${tc}`);
    }
  });
});
