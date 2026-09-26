import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>;
  build?: {
    npmRebuild?: boolean;
    files?: string[];
    asarUnpack?: string[];
    extraResources?: Array<{ from?: string; to?: string; filter?: string[] }>;
  };
};

describe('packaged agent tooling', () => {
  it('rebuilds workspace runtimes before bundling the CLI and its complete skills tree', () => {
    expect(packageJson.scripts?.['prepare:workspace-runtime']).toContain(
      'pnpm --filter pulse-coder-engine build',
    );
    expect(packageJson.scripts?.['prepare:workspace-runtime']).toContain(
      'pnpm --filter pulse-coder-agent-teams build',
    );
    expect(packageJson.scripts?.['prepare:agent-tooling']).toContain(
      'pnpm --filter @pulse-coder/canvas-cli build',
    );
    expect(packageJson.scripts?.['prepare:agent-tooling']).toContain(
      'node scripts/setup/prepare-sqlite-native.mjs',
    );
    expect(packageJson.scripts?.['prepare:package']).toBe(
      'pnpm run prepare:workspace-runtime && pnpm run prepare:agent-tooling',
    );
    for (const script of ['package', 'package:mac', 'package:mac:arm64', 'package:win', 'package:linux']) {
      expect(packageJson.scripts?.[script]).toMatch(/^pnpm run prepare:package && /);
    }
    expect(packageJson.build?.extraResources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        from: '../../packages/canvas-cli/dist',
        to: 'agent-tooling/canvas-cli',
        filter: ['index.cjs', 'skills/**/*'],
      }),
      expect.objectContaining({
        from: 'node_modules/.cache/pulse-sqlite/package-native',
        to: 'agent-tooling/canvas-cli/native',
        filter: ['*.node'],
      }),
      expect.objectContaining({
        from: '../../packages/canvas-cli/package.json',
        to: 'agent-tooling/canvas-cli-package.json',
      }),
    ]));
  });

  it('bundles the CLI JavaScript dependency closure while native modules stay explicit', () => {
    const cliBuildConfig = readFileSync(
      resolve(process.cwd(), '../../packages/canvas-cli/tsup.config.ts'),
      'utf8',
    );
    const bundledDependencies = cliBuildConfig.match(/noExternal:\s*\[([^\]]+)\]/)?.[1] ?? '';
    for (const dependency of ['commander', '@pulse-coder/storage', 'better-sqlite3', 'bindings', 'file-uri-to-path']) {
      expect(bundledDependencies).toContain(`'${dependency}'`);
    }
  });

  it('excludes SQLite compilation inputs and the unused Node binding while retaining the JS driver', () => {
    expect(packageJson.build?.files).toEqual(expect.arrayContaining([
      '!node_modules/better-sqlite3/deps/**/*',
      '!node_modules/better-sqlite3/src/**/*',
      '!node_modules/better-sqlite3/build/**/*',
    ]));
    expect(packageJson.build?.files).not.toContain('!node_modules/better-sqlite3/**/*');
    expect(packageJson.build?.asarUnpack).not.toContain('node_modules/better-sqlite3/**/*.node');
  });

  it('does not rebuild the shared SQLite dependency for Electron during install or packaging', () => {
    expect(packageJson.build?.npmRebuild).toBe(false);
    for (const script of ['postinstall', 'rebuild']) {
      expect(packageJson.scripts?.[script]).toBe('node scripts/setup/rebuild-native.mjs');
    }
    // `-o` restricts electron-rebuild to node-pty; `-w` would add it to the
    // normal set and overwrite SQLite's Node binary. The host-header fallback
    // runs node-gyp only inside node-pty's own directory.
    const rebuildScript = readFileSync(resolve(process.cwd(), 'scripts/setup/rebuild-native.mjs'), 'utf8');
    expect(rebuildScript).toContain("['-f', '-o', 'node-pty']");
    expect(rebuildScript).not.toMatch(/'-w'|better-sqlite3/);
    expect(rebuildScript).toContain("[nodeGyp, 'rebuild'], nodePtyDir");
  });
});
