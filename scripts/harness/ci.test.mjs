import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { parseYaml } from './validation-data.mjs';
import { cleanupFixtures, createFixture, repoRoot } from './test-support.mjs';

afterEach(cleanupFixtures);
const workflow = () => parseYaml(fs.readFileSync(path.join(repoRoot, '.github/workflows/harness.yml'), 'utf8'), 'harness.yml');

describe('harness integrity workflow', () => {
  it.each([false, true])('the actual integrity step reports a broken binding=%s', (broken) => {
    const root = createFixture();
    if (broken) fs.unlinkSync(path.join(root, 'scripts/check.cjs'));
    const step = workflow().jobs.integrity.steps.find((step) => step.name === 'Check harness integrity');
    const result = spawnSync('sh', ['-c', step.run], { cwd: root, encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(broken ? 1 : 0);
    if (broken) expect(result.stdout).toContain('missing command target scripts/check.cjs');
    else expect(JSON.parse(result.stdout).harnessGaps).toBe(0);
  });

  it('keeps CI limited to harness integrity and exposes target-moving changes', () => {
    const config = workflow();
    const commands = config.jobs.integrity.steps.flatMap((step) => step.run ?? []);
    expect(config.permissions).toEqual({ contents: 'read' });
    expect(commands.find((command) => command.startsWith('pnpm install'))).toContain('--ignore-scripts');
    expect(commands.some((command) => command.includes('--all --dry-run'))).toBe(true);
    expect(commands.join('\n')).not.toMatch(/perf:report|canvas-workspace (?:dev|test|build)|harness start/);
    for (const event of ['pull_request', 'push']) {
      expect(config.on[event].paths).toContain('**/*.test.*');
      expect(config.on[event].paths).toContain('**/scripts/**');
      expect(config.on[event].paths).toContain('pnpm-lock.yaml');
    }
  });
});
