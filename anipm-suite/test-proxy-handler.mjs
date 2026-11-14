// anipm-suite/test-proxy-handler.mjs
import { onRequest } from '../functions/api/test-proxy.js';

async function testProxyHandler() {
  console.log('Testing onRequest on /api/test-proxy...');

  // 1. Ping without params
  const req1 = new Request('https://anihubstream.pages.dev/api/test-proxy');
  const res1 = await onRequest({ request: req1 });
  console.log('1. Ping Status:', res1.status);
  const json1 = await res1.json();
  console.log('   Body:', json1);

  // 2. Fetch master.m3u8
  const masterUrl = 'https://beta.cno.to/hls/195604-black-clover-season-2/E0001/master.m3u8';
  const req2 = new Request('https://anihubstream.pages.dev/api/test-proxy?u=' + encodeURIComponent(masterUrl));
  const res2 = await onRequest({ request: req2 });
  console.log('\n2. Proxy Master Status:', res2.status);
  console.log('   Content-Type:', res2.headers.get('content-type'));
  console.log('   CORS Origin:', res2.headers.get('access-control-allow-origin'));
  const text2 = await res2.text();
  console.log('   Preview:\n' + text2.slice(0, 300));

  // 3. OPTIONS preflight
  const req3 = new Request('https://anihubstream.pages.dev/api/test-proxy', { method: 'OPTIONS' });
  const res3 = await onRequest({ request: req3 });
  console.log('\n3. OPTIONS Preflight Status:', res3.status);
  console.log('   CORS Methods:', res3.headers.get('access-control-allow-methods'));

  if (res1.status === 200 && res2.status === 200 && res3.status === 204) {
    console.log('\n>>> SUCCESS: /api/test-proxy handler passed all verification checks!');
  } else {
    console.error('\n>>> FAILED');
    process.exit(1);
  }
}

testProxyHandler().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
