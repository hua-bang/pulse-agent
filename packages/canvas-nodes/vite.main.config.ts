import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  build: {
    outDir: resolve(root, 'dist'),
    emptyOutDir: false,
    target: 'node20',
    minify: false,
    lib: {
      entry: resolve(root, 'src/main.ts'),
      formats: ['es'],
      fileName: () => 'main.js',
    },
    rollupOptions: {
      external: [],
    },
  },
});
