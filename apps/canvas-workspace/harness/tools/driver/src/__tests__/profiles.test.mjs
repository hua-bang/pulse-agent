import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { STORE_RELATIVE_DIR } from '../config.mjs';
import { prepareProfile, seedDemoHome } from '../profiles.mjs';

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

describe('prepareProfile temp --home', () => {
  it('reuses a kept harness temp HOME so a later boot is a returning user', async () => {
    const home = await mkdtemp(join(tmpdir(), 'pulse-canvas-harness-home-'));
    homes.push(home);

    expect(await prepareProfile('temp', { home })).toEqual({ home, cleanupHome: true });
  });

  it('refuses a HOME the harness did not create', async () => {
    const home = await mkdtemp(join(tmpdir(), 'pulse-canvas-profile-test-'));
    homes.push(home);

    await expect(prepareProfile('temp', { home })).rejects.toThrow(/harness temp HOME/);
    await expect(prepareProfile('temp', { home: join(tmpdir(), 'pulse-canvas-harness-home-missing') }))
      .rejects.toThrow(/does not exist/);
  });
});
