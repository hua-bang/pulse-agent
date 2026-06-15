import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  plugins: [
    react({
      jsxRuntime: 'classic',
    }),
  ],
  build: {
    outDir: resolve(root, 'dist'),
    emptyOutDir: true,
    target: 'es2020',
    minify: false,
    lib: {
      entry: resolve(root, 'src/remote-entry.ts'),
      name: 'pulse_canvas_demo_note_bundle',
      formats: ['iife'],
      fileName: () => 'remoteEntry.js',
    },
    rollupOptions: {
      external: ['react'],
      output: {
        globals: {
          react: '__PULSE_CANVAS_PLUGIN_REACT__',
        },
        inlineDynamicImports: true,
      },
    },
  },
});
