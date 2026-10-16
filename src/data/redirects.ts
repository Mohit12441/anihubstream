/**
 * Canonical redirect mapping for deduplicated anime slugs.
 * Maps any retired / losing slug to its canonical stable slug.
 */
export const SLUG_REDIRECTS: Record<string, string> = {
  'demon-slayer-kimetsu-no-yaiba': 'demon-slayer',
  'frieren-beyond-journey-s-end': 'sousou-no-frieren',
  'tokyo-revengers-war-of-the-three-titans-arc': 'tokyo-revengers-zokuhen',
  'blue-box-season-2': 'ao-no-hako-2',
  'the-apothecary-diaries-season-3': 'kusuriya-no-hitorigoto-3rd-season',
  'cyberpunk-edgerunners-2': 'cyberpunk-edgerunners-ii',
  'the-laid-off-cheat-granting-mage-enjoys-a-second-lease-on': 'the-laid-off-cheat-granting-mage-enjoys-a-second-lease-on-life',
};
