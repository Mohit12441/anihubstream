// functions/api/_anipm.js

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * Resolves AniPM Beta Master playlist for an AniList ID and episode number
 */
export async function resolveAniPmBetaDirect({ anilistId, ep = 1 }) {
  if (!anilistId) return null;

  const headers = {
    'User-Agent': CHROME_UA,
    'Referer': 'https://beta.cno.to/',
  };

  try {
    const sRes = await fetch(`https://beta.cno.to/api/anime/series/${anilistId}`, {
      headers,
      signal: AbortSignal.timeout(3000),
    });

    if (!sRes.ok) return null;
    const data = await sRes.json().catch(() => null);
    if (!data?.slug) return null;

    const paddedEp = 'E' + String(ep || 1).padStart(4, '0');
    const rawSlug = data.slug;
    const cleanSlug = rawSlug.replace(/-[a-z0-9]{5,8}$/i, '').replace(/-(?:tv|ona|ova|movie|special)$/i, '');

    const candidates = [
      `https://beta.cno.to/hls/${anilistId}-${cleanSlug}/${paddedEp}/master.m3u8`,
      `https://beta.cno.to/hls/${anilistId}-${rawSlug}/${paddedEp}/master.m3u8`,
    ];

    let masterUrl = candidates[0];
    if (cleanSlug !== rawSlug) {
      try {
        const check = await fetch(candidates[0], { method: 'HEAD', headers, signal: AbortSignal.timeout(1200) });
        if (!check.ok) {
          masterUrl = candidates[1];
        }
      } catch {}
    }

    return {
      streamUrl: `/api/test-proxy?u=${encodeURIComponent(masterUrl)}`,
      masterUrl,
      referer: 'https://beta.cno.to/',
      referrerPolicy: 'no-referrer',
      provider: 'anipm',
      quality: '1080p',
      audioTracks: [],
      subtitles: [],
    };
  } catch {
    return null;
  }
}
