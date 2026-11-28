import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { phosphorWeightsPlugin } from './scripts/build/phosphor-weights.mjs';

const vpsProxyTarget = process.env.PULSE_VPS_ENDPOINT?.trim() || 'http://127.0.0.1:4770';

export default defineConfig({
  root: 'src/renderer',
  base: '/',
  define: {
    __PULSE_CANVAS_AGENT_OBSERVABILITY__: JSON.stringify(false),
    __PULSE_WEB_HOST__: JSON.stringify(true),
  },
  server: {
    host: '127.0.0.1',
    port: 5178,
    proxy: {
      '/v1': {
        target: vpsProxyTarget,
        changeOrigin: true,
      },
      '/health': {
        target: vpsProxyTarget,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
    // Match electron.vite.config.ts: esbuild@0.21.5 (bundled with Vite 5) miscompiles
    // @xterm/xterm@6.0.0's `let r; (...)(r ||= {})` in InputHandler.requestMode when
    // lowering for target < es2021, dropping `let r` and emitting `(void 0 || (i = {}))`,
    // which throws ReferenceError in strict ESM on any DECRQM sequence (e.g. Codex TUI).
    minify: 'terser',
    terserOptions: {
      compress: { passes: 2 },
      format: { comments: false },
    },
    cssMinify: 'esbuild',
  },
  plugins: [react(), phosphorWeightsPlugin()],
});
