async function verifyLive() {
  const urls = [
    'https://anihubstream.pages.dev/',
    'https://anihubstream.pages.dev/anime/demon-slayer',
    'https://anihubstream.pages.dev/search?q=naruto',
    'https://anihubstream.pages.dev/watchlist',
    'https://anihubstream.pages.dev/genres?name=Action'
  ];

  for (const u of urls) {
    const res = await fetch(u);
    const html = await res.text();
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    const canonMatch = html.match(/rel=["']canonical["'][^>]+href=["']([^"']+)["']/i) ||
                       html.match(/href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);
    const title = titleMatch ? titleMatch[1] : 'none';
    const canonical = canonMatch ? canonMatch[1] : 'none';
    const pathName = u.replace('https://anihubstream.pages.dev', '') || '/';
    console.log(pathName.padEnd(25), '=> Title:', title);
    console.log(' '.repeat(25), '=> Canonical:', canonical);
  }
}
verifyLive();
