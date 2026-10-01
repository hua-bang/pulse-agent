import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { stageNodeView } from './stage-node-view.mjs';

it('places the built node view beside the development CLI entry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pulse-node-view-'));
  try {
    const source = join(root, 'node-view.html');
    const cliDist = join(root, 'cli', 'dist');
    await mkdir(cliDist, { recursive: true });
    await writeFile(join(cliDist, 'index.cjs'), 'cli');
    await writeFile(source, '<html>v1</html>');
    expect(await stageNodeView(source, cliDist)).toBe(join(cliDist, 'node-view.html'));

    await writeFile(source, '<html>v2</html>');
    await stageNodeView(source, cliDist);
    expect(await readFile(join(cliDist, 'node-view.html'), 'utf8')).toBe('<html>v2</html>');
    expect((await readdir(cliDist)).sort()).toEqual(['index.cjs', 'node-view.html']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('fails when the node view has not been built', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pulse-node-view-'));
  try {
    await expect(stageNodeView(join(root, 'missing.html'), root)).rejects.toThrow('ENOENT');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
