// anipm-suite/test-series.mjs
import fs from 'node:fs';

async function test(path) {
  const url = `https://ume.to/ani-api${path}&k=1`;
  console.log(`\n[series-test] Requesting: ${url}`);
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/json',
      'Referer': 'https://ume.to/',
    }
  });

  console.log('[series-test] Status:', res.status);
  const text = await res.text();
  console.log('[series-test] Body:', text.slice(0, 500));
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function main() {
  await test('/anime/series/solo-leveling-ilh08?routes=e4');
  await test('/anime/ani/151807?routes=e4');
  await test('/partner/v1/series/151807?adult=1');
}

main().catch(console.error);
