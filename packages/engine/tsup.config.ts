import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'built-in/index': 'src/built-in/index.ts',
    'orchestrator/index': 'src/orchestrator/index.ts'
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  splitting: true,
  minify: true,
  keepNames: true,
  esbuildOptions(options, { format }) {
    if (format === 'cjs') {
      // Lower optional/nullish syntax before tsup's CJS splitting transform.
      options.target = 'es2019';
      options.define = { ...options.define, 'import.meta.url': '__filename' };
    }
  },
  sourcemap: true,
  target: 'es2022'
});
