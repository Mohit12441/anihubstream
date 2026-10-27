// @ts-check
import { spawn } from 'node:child_process';
import net from 'node:net';
import { initLocalDatabase } from './init-local-db.mjs';

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
  console.log('🚀 Starting AniHub Stream (100% Serverless Cloudflare Architecture)...\n');

  // 0. Ensure Local D1 schema and tables are initialized
  try {
    initLocalDatabase();
  } catch (err) {
    console.error('Database initialization warning:', err);
  }

  // 1. Start Cloudflare Pages local emulator on 8899
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
