import { mkdtemp, mkdir, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { pruneRunDirectories } from '../retention.mjs';

const tempRoots = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('pruneRunDirectories', () => {
  it('retains the latest 20 harness sessions by run id', async () => {
    const root = await mkdtemp(join(tmpdir(), 'canvas-harness-retention-'));
    tempRoots.push(root);
    const runNames = Array.from({ length: 23 }, (_, index) =>
      `harness-${new Date(1_700_000_000_000 + index * 1_000).toISOString().replace(/[:.]/g, '-')}`);

    for (const runName of runNames) {
      await mkdir(join(root, runName));
    }
    await mkdir(join(root, 'manual-baseline'));
    await writeFile(join(root, 'README.txt'), 'not a run directory');
    const newestMtime = new Date(1_800_000_000_000);
    await utimes(join(root, runNames[0]), newestMtime, newestMtime);

    const removed = await pruneRunDirectories(root);
    const remaining = (await readdir(root)).sort();

    expect(removed).toEqual(runNames.slice(0, 3));
    expect(remaining).toEqual([
      'README.txt',
      'manual-baseline',
      ...runNames.slice(3),
    ].sort());
  });
});
