import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'tsup';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));

/**
 * Bundle the MCP App view (`mcp-app/src`) into one self-contained HTML file.
 * MCP App resources run in a sandboxed iframe with no network by default, so
 * scripts and styles are inlined rather than referenced.
 */
export async function buildMcpApp(outputFile = join(packageRoot, 'dist', 'mcp-app.html')) {
  const workDir = await mkdtemp(join(tmpdir(), 'pulse-canvas-mcp-app-'));
  try {
    await build({
      config: false,
      entry: { app: join(packageRoot, 'mcp-app', 'src', 'main.ts') },
      outDir: workDir,
      format: ['iife'],
      platform: 'browser',
      target: 'es2022',
      minify: true,
      dts: false,
      sourcemap: false,
      clean: false,
      splitting: false,
      silent: true,
      noExternal: [/.*/],
      tsconfig: join(packageRoot, 'mcp-app', 'tsconfig.json'),
    });
    const script = await readFile(join(workDir, 'app.global.js'), 'utf-8');
    const styles = await readFile(join(packageRoot, 'mcp-app', 'src', 'styles.css'), 'utf-8');
    const html = [
      '<!doctype html>',
      '<html lang="en">',
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      '<title>Pulse Canvas</title>',
      `<style>${styles}</style>`,
      '</head>',
      '<body>',
      '<div id="app"></div>',
      // `</script` inside the bundle would end the inline script early.
      `<script>${script.replace(/<\/script/gi, '<\\/script')}</script>`,
      '</body>',
      '</html>',
    ].join('\n');
    await mkdir(resolve(outputFile, '..'), { recursive: true });
    await writeFile(outputFile, html, 'utf-8');
    return { outputFile, bytes: Buffer.byteLength(html) };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { outputFile, bytes } = await buildMcpApp();
  console.log(`MCP App view: ${outputFile} (${Math.round(bytes / 1024)} KiB)`);
}
