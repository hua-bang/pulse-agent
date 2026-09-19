import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'core/index': 'src/core/index.ts',
  },
  format: ['cjs'],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  target: 'es2022',
  platform: 'node',
  noExternal: ['commander', '@pulse-coder/storage', 'better-sqlite3', 'bindings', 'file-uri-to-path'],
  banner: { js: '#!/usr/bin/env node' },
  outExtension: () => ({ js: '.cjs' }),
});
