// anipm-suite/test-settlar-chain.mjs
// Tests the full 3-step Settlar resolution chain

async function resolveSettlarFull(anilistId, ep, lang = 'sub') {
  console.log(`\n======================================================`);
  console.log(`[Settlar Chain] Testing Anilist: ${anilistId}, Episode: ${ep}, Lang: ${lang}`);
  console.log(`======================================================`);

  // Step 1: Fetch embed HTML from ani.pm
  const embedUrl = `https://ani.pm/embed/ani/${anilistId}/${ep}/${lang}`;
  console.log(`[Step 1] Fetching embed: ${embedUrl}`);
  const embedRes = await fetch(embedUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Referer': 'https://ani.pm/',
    }
  });

  if (!embedRes.ok) {
    throw new Error(`Step 1 failed with status ${embedRes.status}`);
  }

  const html = await embedRes.text();
  const configMatch = html.match(/<script[^>]*id=["']anipm-embed-config["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!configMatch) {
    throw new Error('Step 1 failed: anipm-embed-config script not found in HTML');
  }

  const config = JSON.parse(configMatch[1]);
  const nonce = config.nonce || config.n;
  console.log(`[Step 1 Success] Nonce obtained: ${nonce}`);
  console.log(`[Step 1 Success] Player origin: ${config.playerOrigin}`);

  // Step 2: Request partner session token
  const sessionUrl = `https://ani.pm/api/partner/v1/session?n=${encodeURIComponent(nonce)}&id=${anilistId}&ep=${ep}&lang=${lang}&adult=1`;
  console.log(`\n[Step 2] Fetching partner session: ${sessionUrl}`);
  const sessionRes = await fetch(sessionUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/json',
      'Referer': embedUrl,
    }
  });

  console.log(`[Step 2] Status: ${sessionRes.status}`);
  const sessionData = await sessionRes.json();
  console.log('[Step 2 Response]:', sessionData);

  if (!sessionData.token) {
    throw new Error(`Step 2 failed: No token returned in session response`);
  }

  const token = sessionData.token;
  console.log(`[Step 2 Success] Partner Token obtained: ${token.slice(0, 30)}...`);

  // Step 3: Exchange token with Settlar embed session
  const settlarUrl = `https://embed.settlar.io/api/embed/session?t=${encodeURIComponent(token)}`;
  console.log(`\n[Step 3] Fetching Settlar embed session: ${settlarUrl}`);
  const settlarRes = await fetch(settlarUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/json',
      'Referer': 'https://embed.settlar.io/',
      'Origin': 'https://embed.settlar.io',
    }
  });

  console.log(`[Step 3] Status: ${settlarRes.status}`);
  const settlarPayload = await settlarRes.json();
  console.log('\n======================================================');
  console.log('[Step 3 Success] FULL SETTLAR PAYLOAD:');
  console.log('======================================================');
  console.log('Keys:', Object.keys(settlarPayload));
  if (settlarPayload.source) {
    console.log('Source / HLS Master:', settlarPayload.source);
  }
  if (settlarPayload.tracks) {
    console.log('Tracks count:', settlarPayload.tracks.length);
    console.log('Tracks detail:', settlarPayload.tracks);
  }
  if (settlarPayload.subtitles) {
    console.log('Subtitles detail:', settlarPayload.subtitles);
  }
  if (settlarPayload.qualities) {
    console.log('Qualities detail:', settlarPayload.qualities);
  }
  if (sessionData.skip) {
    console.log('Skip Timestamps (Intro/Outro):', sessionData.skip);
  }

  return { sessionData, settlarPayload };
}

async function main() {
  await resolveSettlarFull(151807, 1, 'sub');
}

main().catch(console.error);
