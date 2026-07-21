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
      // electron resolves at runtime in the host main process; node builtins
      // are provided by the runtime. pdfjs-dist stays out of the bundle via a
      // variable dynamic-import specifier in src/pdf-extract.ts.
      external: ['electron', /^node:/],
    },
  },
});
