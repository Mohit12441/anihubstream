// anipm-suite/test-play-route.mjs
import { onRequestGet } from '../functions/api/play.js';

async function testPlayRoute() {
  console.log('Testing onRequestGet with provider=anipm...');

  let bridgeFetchCalled = false;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, options) => {
    const urlStr = String(url);
    if (urlStr.includes('8795') || urlStr.includes('bridge')) {
      bridgeFetchCalled = true;
      throw new Error('BRIDGE_WAS_CALLED: Test failed because bridge was called for anipm!');
    }
    return originalFetch(url, options);
  };

  try {
    const req = new Request('https://anihubstream.pages.dev/api/play?id=195604&ep=1&provider=anipm&audio=sub');
    const env = {
      STREAM_BRIDGE_URL: 'http://127.0.0.1:8795',
      ANIHUB: null
    };

    const res = await onRequestGet({
      request: req,
      env,
      waitUntil: () => {}
    });

    console.log('Play Response Status:', res.status);
    const json = await res.json();
    console.log('Server ID:', json.server?.id);
    console.log('Server Status:', json.server?.status);
    console.log('Stream URL:', json.server?.streamUrl);
    console.log('Bridge Called?', bridgeFetchCalled);

    if (json.server?.id === 'anipm:beta' && json.server?.status === 'ready' && !bridgeFetchCalled) {
      console.log('\n>>> SUCCESS: AniPM resolved directly without bridge in 0s!');
    } else {
      console.error('\n>>> FAILED: AniPM failed verification');
      process.exit(1);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
}

testPlayRoute().catch((err) => {
  console.error('Test Error:', err);
  process.exit(1);
});
