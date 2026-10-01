import { copyFile, mkdir, rename } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = fileURLToPath(new URL('../..', import.meta.url));
const cliDist = resolve(appRoot, '../../packages/canvas-cli/dist');

/**
 * Dev runs install the CLI from packages/canvas-cli/dist, so the MCP node view
 * must sit there for `pulse-canvas mcp` to serve it after "Enable connection".
 * Packaging gets the same file from extraResources instead.
 */
export async function stageNodeView(
  source = join(appRoot, 'dist', 'node-view', 'node-view.html'),
  targetDir = cliDist,
) {
  const target = join(targetDir, 'node-view.html');
  const staging = `${target}.${process.pid}.tmp`;
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, staging);
  await rename(staging, target);
  return target;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Staged MCP node view at ${await stageNodeView()}`);
}
