import { readFileSync } from 'fs';
import { defineConfig } from 'tsup';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'built-in/index': 'src/built-in/index.ts',
    'orchestrator/index': 'src/orchestrator/index.ts'
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  target: 'es2022',
  define: {
    __PULSE_ENGINE_VERSION__: JSON.stringify(version),
  },
});