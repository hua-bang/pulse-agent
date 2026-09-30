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
  // The app ships dist/index.cjs as a standalone executable: bundle every
  // JavaScript dependency (the MCP SDK pulls in zod, ajv, and friends).
  noExternal: [
    'commander',
    '@pulse-coder/storage',
    'better-sqlite3',
    'bindings',
    'file-uri-to-path',
    /^@modelcontextprotocol\/sdk(\/|$)/,
    /^zod(\/|$)/,
    /^ajv(-formats)?(\/|$)/,
    'fast-deep-equal',
    'fast-uri',
    'json-schema-traverse',
    'require-from-string',
  ],
  banner: { js: '#!/usr/bin/env node' },
  outExtension: () => ({ js: '.cjs' }),
});
