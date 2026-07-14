import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Minimal vite root for the ui/ showcase — deliberately separate from
// electron.vite.config.ts (which builds the full Electron app's three
// targets). This showcase only needs a plain browser React page, so it
// reuses the workspace's already-installed `vite` + `@vitejs/plugin-react`
// devDependencies instead of pulling in electron-vite's Electron-shaped
// config. `root`/`base` default to this directory (the CWD the `vite`
// CLI is invoked from — see package.json's `visual`/`visual:update`
// scripts and playwright.config.ts's `webServer.cwd`).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 4319,
    strictPort: true,
    host: '127.0.0.1',
  },
  preview: {
    port: 4319,
    strictPort: true,
    host: '127.0.0.1',
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
