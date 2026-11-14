// anipm-suite/test-cno.mjs
/**
 * Scrapes and verifies https://beta.cno.to/ HLS endpoints and CDN structure
 */

async function main() {
  console.log('=== SCRAPING BETA.CNO.TO ===\n');

  // 1. Check title/series metadata endpoint on beta.cno.to
  const seriesUrl = 'https://beta.cno.to/api/anime/series/195604';
  console.log('[1] Fetching series info:', seriesUrl);
  const sRes = await fetch(seriesUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://beta.cno.to/' }
  });
  console.log('Status:', sRes.status);
  const sJson = await sRes.json().catch(() => null);
  if (sJson) {
    console.log('Title:', sJson.title);
    console.log('Total Episodes:', sJson.episodes?.length || sJson.episodeCount);
    console.log('Audio langs:', sJson.audio);
    console.log('Subtitles:', sJson.subs);
  }

  // 2. Fetch Master m3u8
  const masterUrl = 'https://beta.cno.to/hls/195604-black-clover-season-2/E0001/master.m3u8';
  console.log('\n[2] Fetching Master m3u8:', masterUrl);
  const mRes = await fetch(masterUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://beta.cno.to/' }
  });
  console.log('Status:', mRes.status);
  const mText = await mRes.text();
  console.log('Master M3U8 preview:\n', mText.slice(0, 500));

  // 3. Fetch Video Sub-playlist
  const videoM3u8Url = 'https://beta.cno.to/hls/195604-black-clover-season-2/E0001/video-1080p/index.m3u8';
  console.log('\n[3] Fetching 1080p Video Playlist:', videoM3u8Url);
  const vRes = await fetch(videoM3u8Url, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://beta.cno.to/' }
  });
  console.log('Status:', vRes.status);
  const vText = await vRes.text();
  console.log('Video Playlist preview:\n', vText.slice(0, 500));
}

main().catch(console.error);
