// anipm-suite/inspect-partner-series.mjs
async function main() {
  const url = 'https://ume.to/ani-api/partner/v1/series/151807?adult=1&k=1';
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/json',
      'Referer': 'https://ume.to/',
    }
  });

  const json = await res.json();
  console.log('--- PARTNER SERIES RESPONSE ---');
  console.log('Top keys:', Object.keys(json));
  if (json.data) {
    console.log('Data keys:', Object.keys(json.data));
    console.log('Episodes info:', json.data.episodes);
    if (json.data.episodeList) {
      console.log('EpisodeList length:', json.data.episodeList.length);
      console.log('First 2 episodes:', JSON.stringify(json.data.episodeList.slice(0, 2), null, 2));
    }
  }
}

main().catch(console.error);
