// @ts-check
import { spawn } from 'node:child_process';
import net from 'node:net';

function isPortOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1000);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

async function main() {
  console.log('🚀 Starting AniHub Stream in 100% Local PC Mode (No Cloudflare D1 Limits)...\n');

  // 1. Ensure Bridge on 8795 is running
  const bridgeRunning = await isPortOpen(8795);
  if (!bridgeRunning) {
    console.log('⚡ Starting local stream bridge on http://127.0.0.1:8795...');
    const bridgeProc = spawn(process.execPath, ['api/bridge.mjs'], {
      stdio: 'inherit',
      windowsHide: false,
    });
    bridgeProc.on('error', (err) => console.error('Bridge error:', err));
    await new Promise((r) => setTimeout(r, 1200));
  } else {
    console.log('✓ Local stream bridge is already active on http://127.0.0.1:8795');
  }

  // 2. Start Cloudflare Pages local emulator on 8899
  console.log('⚡ Starting Cloudflare Pages edge emulator on http://localhost:8899...');
  const isWindows = process.platform === 'win32';
  const wranglerCmd = isWindows ? 'npx.cmd' : 'npx';
  const pagesProc = spawn(wranglerCmd, ['wrangler', 'pages', 'dev', 'dist-pages', '--port', '8899'], {
    stdio: 'inherit',
    windowsHide: false,
  });

  pagesProc.on('exit', (code) => {
    console.log(`Pages process exited with code ${code}`);
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
