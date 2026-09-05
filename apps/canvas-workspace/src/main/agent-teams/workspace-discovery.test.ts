import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { AgentTeamWorkspaceDiscovery } from './workspace-discovery';

const roots: string[] = [];

const makeRoot = async (): Promise<string> => {
  const root = await fs.mkdtemp(join(tmpdir(), 'agent-team-workspaces-'));
  roots.push(root);
  return root;
};

describe('AgentTeamWorkspaceDiscovery', () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it('merges active workspaces with directories containing persisted team state', async () => {
    const root = await makeRoot();
    await fs.mkdir(join(root, 'persisted', 'agent-teams'), { recursive: true });
    await fs.writeFile(join(root, 'persisted', 'agent-teams', 'state.json'), '{}');
    await fs.mkdir(join(root, 'empty'), { recursive: true });
    await fs.writeFile(join(root, 'not-a-workspace'), 'file');
    const discovery = new AgentTeamWorkspaceDiscovery({ storeDir: root });

    await expect(discovery.discover(['active'])).resolves.toEqual(['active', 'persisted']);
  });

  it('caches disk discoveries while always including newly active workspaces', async () => {
    const root = await makeRoot();
    let now = 1_000;
    const discovery = new AgentTeamWorkspaceDiscovery({ storeDir: root, now: () => now });

    expect(await discovery.discover(['active-1'])).toEqual(['active-1']);
    await fs.mkdir(join(root, 'later', 'agent-teams'), { recursive: true });
    await fs.writeFile(join(root, 'later', 'agent-teams', 'state.json'), '{}');
    expect(await discovery.discover(['active-2'])).toEqual(['active-2']);

    now += 60_000;
    expect(await discovery.discover(['active-2'])).toEqual(['active-2']);

    now += 1;
    expect(await discovery.discover(['active-2'])).toEqual(['active-2', 'later']);
  });
});
