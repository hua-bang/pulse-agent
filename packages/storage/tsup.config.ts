import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    sqlite: 'src/sqlite/index.ts',
    canvas: 'src/canvas-compat.ts',
    local: 'src/local.ts',
    'local-files': 'src/local-files.ts',
    'local-conversations': 'src/local-conversations.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  target: 'es2022',
  external: ['better-sqlite3'],
});
