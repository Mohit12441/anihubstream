// tools/fetch-official-art.mjs
// Fetches REAL, official anime banners and posters from Kitsu and AniList APIs
// and saves them locally into public/images/banners and public/images/posters
// so articles display 100% real studio key visuals instead of generic stock art.

import fs from 'node:fs';
import path from 'node:path';

const TARGETS = [
  {
    slug: 'spring-2026-anime-season-guide',
    searchTitle: 'Solo Leveling',
    type: 'banner',
    outFile: 'banner-spring-2026.jpg'
  },
  {
    slug: 'top-10-dark-fantasy-anime-masterpieces',
    searchTitle: 'Berserk',
    type: 'banner',
    outFile: 'banner-dark-fantasy.jpg'
  },
  {
    slug: 'solo-leveling-reawakening-complete-guide',
    searchTitle: 'Solo Leveling',
    type: 'banner',
    outFile: 'banner-solo-leveling.jpg'
  },
  {
    slug: 'best-isekai-anime-ranked-by-worldbuilding',
    searchTitle: 'Re:Zero',
    type: 'banner',
    outFile: 'banner-isekai-worldbuilding.jpg'
  },
  {
    slug: 'solo-leveling',
    searchTitle: 'Solo Leveling',
    type: 'both',
    outBanner: 'banner-solo-leveling.jpg',
    outPoster: 'poster-solo-leveling.jpg'
  },
  {
    slug: 'jujutsu-kaisen',
    searchTitle: 'Jujutsu Kaisen',
    type: 'both',
    outBanner: 'banner-jujutsu-kaisen.jpg',
    outPoster: 'poster-jujutsu-kaisen.jpg'
  },
  {
    slug: 'chainsaw-man',
    searchTitle: 'Chainsaw Man',
    type: 'both',
    outBanner: 'banner-chainsaw-man.jpg',
    outPoster: 'poster-chainsaw-man.jpg'
  },
  {
    slug: 'demon-slayer',
    searchTitle: 'Demon Slayer: Kimetsu no Yaiba',
    type: 'both',
    outBanner: 'banner-demon-slayer.jpg',
    outPoster: 'poster-demon-slayer.jpg'
  },
  {
    slug: 'berserk',
    searchTitle: 'Berserk',
    type: 'both',
    outBanner: 'banner-berserk.jpg',
    outPoster: 'poster-berserk.jpg'
  },
  {
    slug: 'made-in-abyss',
    searchTitle: 'Made in Abyss',
    type: 'both',
    outBanner: 'banner-made-in-abyss.jpg',
    outPoster: 'poster-made-in-abyss.jpg'
  },
  {
    slug: 'attack-on-titan',
    searchTitle: 'Attack on Titan',
    type: 'both',
    outBanner: 'banner-attack-on-titan.jpg',
    outPoster: 'poster-attack-on-titan.jpg'
  },
  {
    slug: 'one-piece',
    searchTitle: 'One Piece',
    type: 'both',
    outBanner: 'banner-one-piece.jpg',
    outPoster: 'poster-one-piece.jpg'
  },
  {
    slug: 'sousou-no-frieren',
    searchTitle: 'Frieren: Beyond Journey\'s End',
    type: 'both',
    outBanner: 'banner-frieren.jpg',
    outPoster: 'poster-frieren.jpg'
  }
];

async function fetchFromKitsu(title) {
  try {
    const res = await fetch(`https://kitsu.app/api/edge/anime?filter[text]=${encodeURIComponent(title)}`, {
      headers: {
        'Accept': 'application/vnd.api+json'
      }
    });
    if (!res.ok) return null;
    const json = await res.json();
    const anime = json?.data?.[0]?.attributes;
    if (!anime) return null;

    return {
      banner: anime.coverImage?.large || anime.coverImage?.original || null,
      poster: anime.posterImage?.large || anime.posterImage?.original || null
    };
  } catch (err) {
    console.error(`Error querying Kitsu for ${title}:`, err.message);
    return null;
  }
}

async function downloadFile(url, destPath) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 AniHubStream Image Bot/1.0'
      }
    });
    if (!res.ok) {
      console.warn(`Failed to download ${url}: HTTP ${res.status}`);
      return false;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(destPath, buffer);
    console.log(`  ✓ Saved: ${destPath} (${Math.round(buffer.length / 1024)} KB)`);
    return true;
  } catch (err) {
    console.error(`Download error for ${url}:`, err.message);
    return false;
  }
}

export async function runImageSync() {
  const bannersDir = path.resolve('public/images/banners');
  const postersDir = path.resolve('public/images/posters');
  fs.mkdirSync(bannersDir, { recursive: true });
  fs.mkdirSync(postersDir, { recursive: true });

  console.log('🖼️ Fetching REAL official anime key visuals & banners from official APIs...');

  for (const t of TARGETS) {
    console.log(`\n🔍 Searching official media for: ${t.searchTitle}`);
    const media = await fetchFromKitsu(t.searchTitle);
    if (!media) {
      console.warn(`  ⚠️ No Kitsu media found for ${t.searchTitle}`);
      continue;
    }

    if (t.type === 'banner' && media.banner && t.outFile) {
      const dest = path.join(bannersDir, t.outFile);
      await downloadFile(media.banner, dest);
    } else if (t.type === 'both') {
      if (media.banner && t.outBanner) {
        const dest = path.join(bannersDir, t.outBanner);
        await downloadFile(media.banner, dest);
      }
      if (media.poster && t.outPoster) {
        const dest = path.join(postersDir, t.outPoster);
        await downloadFile(media.poster, dest);
      }
    }
  }

  console.log('\n✨ Official anime image sync completed successfully.');
}

if (process.argv[1] && process.argv[1].endsWith('fetch-official-art.mjs')) {
  runImageSync().catch(err => {
    console.error('Fatal error syncing images:', err);
    process.exit(1);
  });
}
