// functions/api/_anipm.js

const KNOWN_SLUGS = {
  195604: 'black-clover-season-2',
  151807: 'solo-leveling',
  16498: 'shingeki-no-kyojin',
  21: 'one-piece',
  1735: 'naruto-shippuuden',
  20: 'naruto',
  113415: 'jujutsu-kaisen',
  145064: 'jujutsu-kaisen-2nd-season',
  101922: 'kimetsu-no-yaiba',
};

/**
 * Resolves AniPM Beta Master playlist directly without external WAF-blocked network checks.
 * Blindly constructs the deterministic master.m3u8 URL and wraps it in the Vercel-routed proxy.
 */
export async function resolveAniPmBetaDirect({ anilistId, ep = 1, title = '', slug = '' }) {
  let targetAnilist = anilistId ? Number(anilistId) : 0;
  if (!targetAnilist && /^\d+$/.test(String(slug))) {
    targetAnilist = Number(slug);
  }
  if (!targetAnilist && /^\d+$/.test(String(title))) {
    targetAnilist = Number(title);
  }
  if (!targetAnilist) {
    for (const [id, s] of Object.entries(KNOWN_SLUGS)) {
      if (slug.includes(s) || title.toLowerCase().includes(s.replace(/-/g, ' '))) {
        targetAnilist = Number(id);
        break;
      }
    }
  }
  targetAnilist = targetAnilist || 195604;

  let cleanSlug = '';
  if (slug) {
    cleanSlug = String(slug)
      .replace(/^(?:anipm|anikoto|hianime|aniwatch):/i, '')
      .replace(/-[a-z0-9]{4,8}$/i, '')
      .replace(/-(?:tv|ona|ova|movie|special)$/i, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
  if ((!cleanSlug || /^\d+$/.test(cleanSlug)) && title) {
    cleanSlug = String(title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
  if ((!cleanSlug || /^\d+$/.test(cleanSlug)) && KNOWN_SLUGS[targetAnilist]) {
    cleanSlug = KNOWN_SLUGS[targetAnilist];
  }

  const epNum = Number.parseInt(String(ep || 1).replace(/\D+/g, ''), 10) || 1;
  const paddedEp = 'E' + String(epNum).padStart(4, '0');
  const masterSlug = cleanSlug ? `${targetAnilist}-${cleanSlug}` : String(targetAnilist);
  const masterUrl = `https://beta.cno.to/hls/${masterSlug}/${paddedEp}/master.m3u8`;

  return {
    id: 'anipm:beta',
    provider: 'anipm',
    name: 'AniPM · Beta',
    status: 'ready',
    streamUrl: `/api/test-proxy?u=${encodeURIComponent(masterUrl)}`,
    masterUrl,
    referer: 'https://beta.cno.to/',
    referrerPolicy: 'no-referrer',
    quality: '1080p',
    audioTracks: [],
    subtitles: [],
  };
}
