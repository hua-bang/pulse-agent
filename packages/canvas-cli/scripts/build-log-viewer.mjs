import { build } from 'tsup';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants } from 'node:zlib';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appDir = resolve(packageDir, '../../apps/canvas-workspace');
const output = await fs.mkdtemp(join(tmpdir(), 'pulse-log-viewer-build-'));
try {
  await build({
    entry: { viewer: join(appDir, 'src/plugins/renderer/devtools/log-viewer.tsx') },
    outDir: output,
    format: ['iife'], platform: 'browser', target: 'es2022',
    minify: true, dts: false, sourcemap: false, config: false,
    noExternal: [/.*/],
    tsconfig: join(appDir, 'tsconfig.json'),
    loader: { '.woff2': 'dataurl' },
    esbuildOptions(options) {
      options.jsx = 'automatic';
      options.define = { 'process.env.NODE_ENV': '"production"' };
    },
  });
  const script = await fs.readFile(join(output, 'viewer.global.js'), 'utf8');
  const styles = await fs.readFile(join(output, 'viewer.css'), 'utf8');
  const generated = join(packageDir, 'src/generated/log-viewer.ts');
  await fs.mkdir(dirname(generated), { recursive: true });
  const compressed = brotliCompressSync(Buffer.from(JSON.stringify({ script, styles })), {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  }).toString('base64');
  await fs.writeFile(generated,
    `// Generated; do not edit.\nexport const viewerAssetsBrotli = ${JSON.stringify(compressed)};\n`);

} finally {
  await fs.rm(output, { recursive: true, force: true });
}
