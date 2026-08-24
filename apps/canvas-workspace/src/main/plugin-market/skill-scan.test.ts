import { mkdtemp, mkdir, realpath, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it } from 'vitest';
import { AGENT_PLUGIN_V1_SCHEMA } from '../../shared/plugin-market';
import { agentPluginSkillScanPathsSync } from './skill-scan';

const roots: string[] = [];

async function pluginRoot(manifest: Record<string, unknown>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pulse-plugin-scan-'));
  roots.push(root);
  await writeFile(join(root, 'plugin.json'), JSON.stringify(manifest), 'utf8');
  return root;
}

async function skill(root: string, directory: string, name = directory): Promise<void> {
  const path = join(root, 'skills', directory);
  await mkdir(path, { recursive: true });
  await writeFile(
    join(path, 'SKILL.md'),
    `---\nname: ${name}\ndescription: Test skill\n---\n`,
    'utf8',
  );
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('agentPluginSkillScanPathsSync', () => {
  it('loads only immediate Agent Skills with matching names', async () => {
    const root = await pluginRoot({ $schema: AGENT_PLUGIN_V1_SCHEMA, name: 'valid-plugin' });
    await skill(root, 'valid');
    await skill(root, 'wrong-directory', 'different-name');

    expect(agentPluginSkillScanPathsSync(root)).toEqual([
      await realpath(join(root, 'skills', 'valid')),
    ]);
  });

  it('does not expose skills when the core manifest is invalid', async () => {
    const root = await pluginRoot({ $schema: AGENT_PLUGIN_V1_SCHEMA, name: 'Invalid Name' });
    await skill(root, 'valid');

    expect(agentPluginSkillScanPathsSync(root)).toEqual([]);
  });

  it('keeps legacy fallback distinguishable from a rejected plugin.json', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pulse-plugin-scan-'));
    roots.push(root);

    expect(agentPluginSkillScanPathsSync(root)).toBeUndefined();
    await writeFile(join(root, 'plugin.json'), '{', 'utf8');
    expect(agentPluginSkillScanPathsSync(root)).toEqual([]);
  });
});
