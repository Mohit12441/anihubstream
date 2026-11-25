import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bannerDir = path.resolve(__dirname, '../public/images/banners');

if (!fs.existsSync(bannerDir)) {
  fs.mkdirSync(bannerDir, { recursive: true });
}

const bannerMap = {
  // Official flagship banners from AniList CDN
  'banner-spring-2026.jpg': 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/176496-5oY4k2NRqlYs.jpg', // Solo Leveling S2
  'banner-solo-leveling.jpg': 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/151807-37yfQA3ym8PA.jpg', // Solo Leveling
  'banner-dark-fantasy.jpg': 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/33-g7HwYRVm0ZkN.jpg', // Berserk
  'banner-berserk.jpg': 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/33-g7HwYRVm0ZkN.jpg',
  'banner-demon-slayer.jpg': 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/101922-33MtJGsUSxga.jpg', // Demon Slayer
  'banner-jujutsu-kaisen.jpg': 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/113415-jQBSkxWAAk83.jpg', // Jujutsu Kaisen
  'banner-one-piece.jpg': 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/21-wf37VakJmZqs.jpg', // One Piece
  'banner-isekai-worldbuilding.jpg': 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/108465-RgsRpTMhP9Sv.jpg', // Mushoku Tensei
  'banner-attack-on-titan.jpg': 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/16498-8jpFCOcDmneX.jpg', // Attack on Titan
  'banner-chainsaw-man.jpg': 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/127230-o8IRwCGVr9KW.jpg', // Chainsaw Man
  'banner-frieren.jpg': 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/154587-ivXNJ23SM1xB.jpg', // Frieren
  'banner-made-in-abyss.jpg': 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/97986-C55UnbJKB7ZF.jpg' // Made in Abyss
};

async function download(name, url) {
  const dest = path.join(bannerDir, name);
  console.log(`Downloading ${name} from ${url}...`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.statusText}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buffer);
  console.log(` Saved ${name} (${buffer.length} bytes)`);
}

async function main() {
  for (const [name, url] of Object.entries(bannerMap)) {
    try {
      await download(name, url);
    } catch (e) {
      console.error(` Error downloading ${name}:`, e.message);
    }
  }
  console.log('All official anime banners updated successfully.');
}

main();
