// anipm-suite/test-beta.mjs
async function testBeta() {
  const directUrl = 'https://beta.cno.to/hls/151807-solo-leveling/E0001/master.m3u8';
  console.log('Testing Beta Master URL:', directUrl);
  try {
    const res = await fetch(directUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Referer': 'https://ani.pm/',
        'Origin': 'https://ani.pm'
      }
    });

    console.log('Beta Status:', res.status);
    console.log('Beta Headers:', Object.fromEntries(res.headers.entries()));
    const text = await res.text();
    console.log('Beta Text (len:', text.length, '):');
    console.log(text.slice(0, 1000));
  } catch (err) {
    console.error('Beta Error:', err.message);
  }
}

testBeta();
