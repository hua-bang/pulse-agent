import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Regenerate `plugins/pulse-canvas/skills` from this package's skill bundle.
 * `skills/` stays the source of truth; the plugin copy exists because
 * marketplace installs fetch the plugin directory alone. The drift guard in
 * src/mcp/__tests__/plugin-package.test.ts fails until this has been run.
 */
const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const cli = join(packageRoot, 'dist', 'index.cjs');
const target = join(packageRoot, '..', '..', 'plugins', 'pulse-canvas', 'skills');

if (!existsSync(cli)) {
  console.error('Build first: pnpm --filter @pulse-coder/canvas-cli build');
  process.exit(1);
}

await rm(target, { recursive: true, force: true });
const result = spawnSync(process.execPath, [cli, 'install-skills', '--dir', target], { stdio: 'inherit' });
process.exit(result.status ?? 1);
