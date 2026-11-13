// anipm-suite/inspect-settlar-embed.mjs
async function main() {
  // Step 1: get embed config
  const res1 = await fetch('https://ani.pm/embed/ani/151807/1/sub', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  const html1 = await res1.text();
  const nonce = html1.match(/anipm-embed-config["'][^>]*>([\s\S]*?)<\/script>/i)[1];
  const n = JSON.parse(nonce).nonce;

  // Step 2: get partner session
  const res2 = await fetch(`https://ani.pm/api/partner/v1/session?n=${n}&id=151807&ep=1&lang=sub&adult=1`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://ani.pm/embed/ani/151807/1/sub'
    }
  });
  const data2 = await res2.json();
  console.log('Step 2 data:', data2);

  // Fetch the embedUrl from Step 2
  console.log('\nFetching embedUrl:', data2.embedUrl);
  const res3 = await fetch(data2.embedUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://ani.pm/',
    }
  });
  console.log('embedUrl status:', res3.status);
  const html3 = await res3.text();
  console.log('embedUrl HTML preview (len:', html3.length, '):');
  console.log(html3.slice(0, 800));

  // Check what scripts/APIs embed.settlar.io uses
  const scripts = html3.match(/<script[\s\S]*?<\/script>/gi) || [];
  console.log('\nSettlar embed scripts found:', scripts.length);
  for (const s of scripts) {
    console.log('Script tag:', s.slice(0, 300));
  }
}

main().catch(console.error);
