#!/usr/bin/env node
// @ts-check
import { spawn } from 'node:child_process';

console.log('🚀 Starting AniHubStream Local Bridge (:8795)...');
const bridge = spawn('node', ['api/bridge.mjs'], { stdio: 'inherit' });

console.log('🌐 Starting Cloudflare Quick Tunnel...');
const cloudflaredPath = 'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe';
const tunnel = spawn(cloudflaredPath, ['tunnel', '--url', 'http://localhost:8795'], { stdio: ['ignore', 'pipe', 'pipe'] });

let tunnelUrlFound = false;

function scanOutput(data) {
  const text = data.toString();
  const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  if (match && !tunnelUrlFound) {
    tunnelUrlFound = true;
    console.log('\n======================================================');
    console.log('✅ CLOUDFLARE TUNNEL ONLINE!');
    console.log(`📡 URL: ${match[0]}`);
    console.log('👉 Put this in Cloudflare Pages Environment Variables:');
    console.log(`   STREAM_BRIDGE_URL=${match[0]}`);
    console.log('======================================================\n');
  }
}

tunnel.stdout.on('data', scanOutput);
tunnel.stderr.on('data', scanOutput);

process.on('SIGINT', () => {
  try { bridge.kill(); } catch {}
  try { tunnel.kill(); } catch {}
  process.exit(0);
});
