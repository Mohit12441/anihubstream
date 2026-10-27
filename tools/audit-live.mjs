async function testLive() {
  const tests = [
    { name: 'Health check', url: 'https://anihubstream.pages.dev/api/health' },
    { name: 'Instant search', url: 'https://anihubstream.pages.dev/api/search/instant?q=naruto' },
    { name: 'Federated search (naruto)', url: 'https://anihubstream.pages.dev/api/search?q=naruto' },
    { name: 'Federated search (demon slayer)', url: 'https://anihubstream.pages.dev/api/search?q=demon+slayer' },
    { name: 'Metadata (naruto)', url: 'https://anihubstream.pages.dev/api/metadata/naruto' },
    { name: 'Metadata (demon-slayer)', url: 'https://anihubstream.pages.dev/api/metadata/demon-slayer' },
    { name: 'Play API default ep 1', url: 'https://anihubstream.pages.dev/api/play?id=demon-slayer&ep=1' },
    { name: 'Play API with provider=anikoto', url: 'https://anihubstream.pages.dev/api/play?id=demon-slayer&ep=1&provider=anikoto' },
    { name: 'AniSkip API', url: 'https://anihubstream.pages.dev/api/aniskip?malId=38000&ep=1' },
    { name: 'Home HTML', url: 'https://anihubstream.pages.dev/' },
    { name: 'Search page HTML', url: 'https://anihubstream.pages.dev/search?q=naruto' },
    { name: 'Watch page HTML', url: 'https://anihubstream.pages.dev/watch/demon-slayer/1?provider=anikoto' }
  ];

  for (const t of tests) {
    try {
      const res = await fetch(t.url);
      const contentType = res.headers.get('content-type') || '';
      let snippet = '';
      let bodyData = null;
      if (contentType.includes('application/json')) {
        bodyData = await res.json();
        snippet = JSON.stringify(bodyData).slice(0, 160);
      } else {
        const text = await res.text();
        snippet = text.slice(0, 160).replace(/\s+/g, ' ');
      }
      console.log(`[HTTP ${res.status}] ${t.name}: ${snippet}`);
      
      // Detailed inspection for search and play
      if (t.name.startsWith('Federated search')) {
        console.log(`   -> Total providers: ${Object.keys(bodyData?.providers || {}).length}, Providers: ${Object.keys(bodyData?.providers || {}).join(', ')}, Total items: ${bodyData?.count || 0}`);
        for (const [k, v] of Object.entries(bodyData?.providers || {})) {
          console.log(`      • ${k}: ${v.length} items (First: "${v[0]?.title}" [slug: ${v[0]?.slug}])`);
        }
      }
      if (t.name.startsWith('Play API')) {
        console.log(`   -> Active Server: ${bodyData?.activeServerId || 'none'}, Available Servers: ${(bodyData?.servers || []).map(s => s.name + ' (' + s.id + ')').join(', ')}`);
        console.log(`   -> Stream details: type=${bodyData?.stream?.type}, url=${bodyData?.stream?.url?.slice(0, 80)}`);
      }
    } catch (err) {
      console.log(`[FAIL] ${t.name}: ${err.message}`);
    }
  }
}

testLive();
