import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['cjs'],
  dts: false,
  clean: true,
  splitting: false,
  sourcemap: true,
  target: 'es2022',
  platform: 'node',
  noExternal: [/^@pulse-coder\/storage/],
  external: ['better-sqlite3', 'node-pty'],
  outExtension({ format }) {
    return {
      js: format === 'cjs' ? '.cjs' : '.js',
    };
  },
});
