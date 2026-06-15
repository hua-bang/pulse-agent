import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { federation } from '@module-federation/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  plugins: [
    react({
      jsxRuntime: 'classic',
    }),
    federation({
      name: 'pulse_canvas_demo_note',
      filename: 'remoteEntry.js',
      manifest: true,
      exposes: {
        './plugin': './src/plugin.tsx',
      },
      shared: {
        react: {
          singleton: true,
          requiredVersion: false,
        },
        'react/': {
          singleton: true,
          requiredVersion: false,
        },
      },
    }),
  ],
  build: {
    outDir: resolve(root, 'dist'),
    emptyOutDir: true,
    target: 'chrome89',
    minify: false,
  },
});
