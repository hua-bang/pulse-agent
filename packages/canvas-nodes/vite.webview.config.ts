import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  base: './',
  plugins: [
    react({
      jsxRuntime: 'classic',
    }),
  ],
  build: {
    outDir: resolve(root, 'dist'),
    emptyOutDir: false,
    target: 'chrome89',
    minify: false,
    rollupOptions: {
      input: resolve(root, 'index.html'),
    },
  },
});
