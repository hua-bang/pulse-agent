import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>;
  build?: {
    extraResources?: Array<{ from?: string; to?: string }>;
  };
};

describe('packaged agent tooling', () => {
  it('builds and bundles the existing pulse-canvas CLI and its complete skills tree', () => {
    expect(packageJson.scripts?.['prepare:agent-tooling']).toContain(
      'pnpm --filter @pulse-coder/canvas-cli build',
    );
    for (const script of ['package', 'package:mac', 'package:mac:arm64', 'package:win', 'package:linux']) {
      expect(packageJson.scripts?.[script]).toMatch(/^pnpm run prepare:agent-tooling && /);
    }
    expect(packageJson.build?.extraResources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        from: '../../packages/canvas-cli/dist',
        to: 'agent-tooling/canvas-cli',
      }),
      expect.objectContaining({
        from: '../../packages/canvas-cli/package.json',
        to: 'agent-tooling/canvas-cli-package.json',
      }),
    ]));
  });

  it('ships a self-contained CLI that does not resolve commander from the user machine', () => {
    const cliBuildConfig = readFileSync(
      resolve(process.cwd(), '../../packages/canvas-cli/tsup.config.ts'),
      'utf8',
    );
    expect(cliBuildConfig).toMatch(/noExternal:\s*\[['"]commander['"]\]/);
  });
});
