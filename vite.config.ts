import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const DEPLOY_BASE = '/wp-content/uploads/anihub/';

/* ANIHUB_TARGET=pages builds for a root-domain static host; the default build
   targets the WordPress uploads dir. Either way JS/CSS follow `base` and art
   is fetched root-absolute from /art, so the same bundle works from both. */
const PAGES = process.env.ANIHUB_TARGET === 'pages';

export default defineConfig(({ command }) => ({
  base: command === 'build' && !PAGES ? DEPLOY_BASE : '/',
  plugins: [react()],
  server: { port: 5178, host: true, proxy: { '/api': 'http://localhost:8790' } },
  preview: { port: 5178, host: true },
}));
