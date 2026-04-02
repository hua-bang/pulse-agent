import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', 'mcp-server': 'src/mcp-server.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  target: 'es2022'
});
