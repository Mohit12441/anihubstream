// anipm-suite/inspect-embed.mjs
async function testEmbed(domain) {
  const url = `${domain}/embed/ani/151807/1/sub`;
  console.log(`\n[embed-test] Fetching: ${url}`);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Referer': `${domain}/`,
      }
    });

    console.log('[embed-test] Status:', res.status);
    const html = await res.text();
    console.log('[embed-test] HTML length:', html.length);
    console.log('[embed-test] HTML snippet:', html.slice(0, 500));

    // Check for config script or iframe
    const configMatch = html.match(/<script[^>]*id=["']anipm-embed-config["'][^>]*>([\s\S]*?)<\/script>/i);
    if (configMatch) {
      console.log('[embed-test] Config script found:', configMatch[1]);
    } else {
      console.log('[embed-test] Config script NOT found in embed HTML');
      // Look for other script tags or iframes
      const scripts = html.match(/<script[\s\S]*?<\/script>/gi) || [];
      console.log(`[embed-test] Total script tags: ${scripts.length}`);
      for (const s of scripts) {
        console.log('Script preview:', s.slice(0, 200));
      }
      const iframes = html.match(/<iframe[\s\S]*?<\/iframe>/gi) || [];
      console.log(`[embed-test] Total iframes: ${iframes.length}`);
      for (const f of iframes) {
        console.log('Iframe preview:', f);
      }
    }
  } catch (err) {
    console.error('[embed-test] Error:', err.message);
  }
}

async function main() {
  await testEmbed('https://ume.to');
  await testEmbed('https://ani.pm');
}

main().catch(console.error);
