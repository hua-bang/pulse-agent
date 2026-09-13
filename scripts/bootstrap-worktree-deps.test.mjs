import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  assertLocalNodeModules,
  buildBootstrapPlan,
  resolvePackageImportMethod,
  resolvePnpmCommand,
  resolvePnpmShell,
} from './bootstrap-worktree-deps.mjs';

test('builds a frozen prefer-offline install plan with the shared store', async () => {
  const root = await createRepoFixture();
  const storeDir = join(root, '.pnpm-store');
  await mkdir(storeDir);

  const plan = await buildBootstrapPlan({
    cwd: root,
    storeDir,
    execFile: async (command, args) => {
      assert.equal(command, 'git');
      assert.deepEqual(args, ['-C', root, 'rev-parse', '--show-toplevel']);
      return { stdout: `${root}\n` };
    },
  });

  assert.equal(plan.repoRoot, root);
  assert.equal(plan.storeDir, storeDir);
  assert.equal(plan.packageImportMethod, 'hardlink');
  assert.deepEqual(plan.args, ['install', '--frozen-lockfile', '--prefer-offline']);
  assert.equal(plan.env.npm_config_store_dir, storeDir);
  assert.equal(plan.env.npm_config_package_import_method, 'hardlink');
});

test('refuses a root node_modules symlink into another worktree', async () => {
  const root = await createRepoFixture();
  const other = await mkdtemp(join(tmpdir(), 'pulse-worktree-other-'));
  await mkdir(join(other, 'node_modules'));
  await symlink(join(other, 'node_modules'), join(root, 'node_modules'));

  await assert.rejects(
    assertLocalNodeModules(root),
    /cross-worktree dependency link/,
  );
});

test('refuses a workspace node_modules symlink into another worktree', async () => {
  const root = await createRepoFixture();
  const other = await mkdtemp(join(tmpdir(), 'pulse-worktree-other-'));
  await mkdir(join(other, 'node_modules'));
  await symlink(join(other, 'node_modules'), join(root, 'packages', 'engine', 'node_modules'));

  await assert.rejects(
    assertLocalNodeModules(root),
    /cross-worktree dependency link/,
  );
});

test('refuses a virtual store symlink into another worktree', async () => {
  const root = await createRepoFixture();
  const other = await mkdtemp(join(tmpdir(), 'pulse-worktree-other-'));
  await mkdir(join(root, 'node_modules'));
  await mkdir(join(other, '.pnpm'));
  await symlink(join(other, '.pnpm'), join(root, 'node_modules', '.pnpm'));

  await assert.rejects(
    assertLocalNodeModules(root),
    /cross-worktree dependency link/,
  );
});

test('allows a node_modules symlink whose target stays inside the worktree', async () => {
  const root = await createRepoFixture();
  await mkdir(join(root, '.deps'));
  await symlink(join(root, '.deps'), join(root, 'node_modules'));

  await assert.doesNotReject(assertLocalNodeModules(root));
});

test('uses the Windows pnpm shim through a shell when needed', () => {
  assert.equal(resolvePnpmCommand('win32'), 'pnpm.cmd');
  assert.equal(resolvePnpmShell('win32'), true);
  assert.equal(resolvePnpmCommand('darwin'), 'pnpm');
  assert.equal(resolvePnpmShell('darwin'), false);
  assert.equal(resolvePnpmCommand('linux'), 'pnpm');
  assert.equal(resolvePnpmShell('linux'), false);
});

test('falls back when the store cannot be inspected', async () => {
  const root = await createRepoFixture();
  assert.equal(
    await resolvePackageImportMethod(root, join(root, 'missing-store')),
    'clone-or-copy',
  );
});

async function createRepoFixture() {
  const root = await mkdtemp(join(tmpdir(), 'pulse-worktree-bootstrap-'));
  await mkdir(join(root, 'packages', 'engine'), { recursive: true });
  await mkdir(join(root, 'apps', 'canvas-workspace'), { recursive: true });
  await writeFile(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  return root;
}
