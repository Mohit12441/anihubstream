const endpoints = [
  'https://anihubstream.com/api/health',
  'https://anihubstream.com/api/home',
  'https://anihubstream.com/api/schedule',
  'https://anihubstream.com/api/genres',
  'https://anihubstream.com/api/news',
  'https://anihubstream.com/news-feed.json',
  'https://anihubstream.com/api/search?q=solo'
];

async function check() {
  for (const url of endpoints) {
    const t0 = Date.now();
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'HealthCheck/1.0' } });
      const ms = Date.now() - t0;
      console.log(`[HTTP ${res.status}] ${ms}ms -> ${url}`);
    } catch (err) {
      console.error(`[FAIL] ${url}: ${err.message}`);
    }
  }
}
check();
