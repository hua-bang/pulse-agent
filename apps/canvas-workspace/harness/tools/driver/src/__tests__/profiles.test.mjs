import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { STORE_RELATIVE_DIR } from '../config.mjs';
import { seedDemoHome } from '../profiles.mjs';

const homes = [];

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

describe('seedDemoHome', () => {
  it('preserves an existing manifest and imported workspaces without reset', async () => {
    const home = await mkdtemp(join(tmpdir(), 'pulse-canvas-profile-test-'));
    homes.push(home);
    const storeDir = join(home, STORE_RELATIVE_DIR);
    await mkdir(storeDir, { recursive: true });
    const manifestPath = join(storeDir, '__workspaces__.json');
    const original = JSON.stringify({
      workspaces: [{ id: 'imported', name: 'Imported board' }],
      folders: [],
      activeId: 'imported',
    }, null, 2);
    await writeFile(manifestPath, original);

    await seedDemoHome(home, { force: false });

    expect(await readFile(manifestPath, 'utf8')).toBe(original);
  });
});
