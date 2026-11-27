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
    minify: 'esbuild',
    cssMinify: 'esbuild',
  },
  plugins: [react(), phosphorWeightsPlugin()],
});
