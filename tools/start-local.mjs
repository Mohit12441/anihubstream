// @ts-check
import { spawn, execSync } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { initLocalDatabase } from './init-local-db.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');

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
    if (!fs.existsSync(path.join(ROOT, 'dist-pages', 'index.html'))) {
      console.log('⚡ dist-pages not found. Building pages first...');
      const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      execSync(`${npmCmd} run build:pages`, { cwd: ROOT, stdio: 'inherit' });
    }
  } catch (err) {
    console.error('Database initialization warning:', err);
  }

  // 1. Ensure Stream Bridge is running on port 8795
  const bridgeRunning = await isPortOpen(8795);
  let bridgeProc = null;
  if (!bridgeRunning) {
    console.log('⚡ Starting Stream Bridge on http://127.0.0.1:8795...');
    bridgeProc = spawn(process.execPath, ['api/bridge.mjs'], {
      stdio: 'inherit',
      windowsHide: false,
    });
  } else {
    console.log('⚡ Stream Bridge is already active on port 8795.');
  }

  // 2. Start Cloudflare Pages local emulator on 8899
  console.log('⚡ Starting Cloudflare Pages edge emulator on http://localhost:8899...');
  const isWindows = process.platform === 'win32';
  const wranglerCmd = isWindows ? 'npx.cmd' : 'npx';
  const pagesProc = spawn(wranglerCmd, ['wrangler', 'pages', 'dev', 'dist-pages', '--port', '8899'], {
    stdio: 'inherit',
    windowsHide: false,
    shell: isWindows,
  });

  // 3. Start Local Sync Daemon in background — OPT-IN ONLY
  // Set START_DAEMON=1 in the shell before launching to enable.
  // Default is off so that DB audits, cleanup, and verify runs aren't
  // mutated by background writes mid-check.
  let syncProc = null;
  if (process.env.START_DAEMON === '1') {
    console.log('⚡ Starting Local Autonomous Sync Daemon in background...');
    syncProc = spawn(process.execPath, ['tools/local-sync-daemon.mjs', '--delay=5', '--interval=30'], {
      stdio: 'inherit',
      windowsHide: false,
    });
  } else {
    console.log('💡 Sync daemon skipped (set START_DAEMON=1 to enable background sync)');
  }

  const cleanup = () => {
    if (bridgeProc) bridgeProc.kill();
    if (syncProc) syncProc.kill();
    pagesProc.kill();
    process.exit(0);
  };

  pagesProc.on('exit', (code) => {
    if (bridgeProc) bridgeProc.kill();
    if (syncProc) syncProc.kill();
    console.log(`Pages process exited with code ${code}`);
    process.exit(code ?? 0);
  });

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
