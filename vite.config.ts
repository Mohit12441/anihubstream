import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const DEPLOY_BASE = '/wp-content/uploads/anihub/';

/* `--mode pages` builds for a root-domain static host; the default build
   targets the WordPress uploads dir. Either way JS/CSS follow `base` and art
   is fetched root-absolute from /art, so the same bundle works from both.
   A mode rather than ANIHUB_TARGET=... because npm scripts run through cmd.exe
   on Windows, where the inline `VAR=value command` form is not a thing. */
export default defineConfig(({ command, mode }) => ({
  base: command === 'build' && mode !== 'pages' ? DEPLOY_BASE : '/',
  plugins: [react()],
  server: { port: 5178, host: true, proxy: { '/api': 'http://localhost:8790' } },
  preview: { port: 5178, host: true },
}));
