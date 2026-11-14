// anipm-suite/test-rewrite.mjs
const testText = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",URI="audio-eng/index.m3u8"
#EXT-X-MAP:URI="https://glowbulb.top/init.gif"
video-1080p/index.m3u8
https://glowbulb.top/seg1.mp4`;

const targetUrl = 'https://beta.cno.to/hls/195604-black-clover-season-2/E0001/master.m3u8';
const proxyBase = '/api/test-proxy';

const rewritten = testText
  .split('\n')
  .map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith('#')) {
      return line.replace(/URI="([^"]+)"/g, (match, uri) => {
        const abs = new URL(uri, targetUrl).href;
        if (abs.includes('.m3u8')) {
          return `URI="${proxyBase}?u=${encodeURIComponent(abs)}"`;
        }
        return `URI="${abs}"`;
      });
    }
    const abs = new URL(trimmed, targetUrl).href;
    if (abs.includes('.m3u8')) {
      return `${proxyBase}?u=${encodeURIComponent(abs)}`;
    }
    return abs;
  })
  .join('\n');

console.log(rewritten);
