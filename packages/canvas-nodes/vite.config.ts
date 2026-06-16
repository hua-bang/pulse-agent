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
      name: 'pulse_canvas_nodes',
      filename: 'remoteEntry.js',
      manifest: true,
      exposes: {
        './plugin': './src/plugin.tsx',
      },
      shared: {
        react: {
          singleton: true,
          requiredVersion: '*',
          import: false,
        },
        'react-dom': {
          singleton: true,
          requiredVersion: '*',
          import: false,
        },
        'react-dom/client': {
          singleton: true,
          requiredVersion: '*',
          import: false,
        },
        'react/jsx-runtime': {
          singleton: true,
          requiredVersion: '*',
          import: false,
        },
        'react/': {
          singleton: true,
          requiredVersion: '*',
          import: false,
        },
      },
    }),
  ],
  build: {
    outDir: resolve(root, 'dist'),
    emptyOutDir: true,
    target: 'chrome89',
    minify: false,
    rollupOptions: {
      input: resolve(root, 'src/plugin.tsx'),
    },
  },
});
