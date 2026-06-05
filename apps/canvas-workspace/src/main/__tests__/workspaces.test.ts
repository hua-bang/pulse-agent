import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  listWorkspaces,
  readWorkspaceManifest,
  WORKSPACES_MANIFEST_FILENAME,
} from '../canvas/workspaces';

let root: string;

beforeEach(async () => {
  root = join(tmpdir(), `workspaces-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await fs.mkdir(root, { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function writeManifest(payload: unknown): Promise<void> {
  await fs.writeFile(join(root, WORKSPACES_MANIFEST_FILENAME), JSON.stringify(payload), 'utf-8');
}

describe('workspaces', () => {
  it('reads workspaces + activeId from the manifest, preserving order and names', async () => {
    await writeManifest({
      activeId: 'ws-b',
      workspaces: [
        { id: 'ws-a', name: '周报', rootFolder: '/repo/a' },
        { id: 'ws-b', name: '调研' },
      ],
    });

    const { activeId, workspaces } = await listWorkspaces(root);
    expect(activeId).toBe('ws-b');
    expect(workspaces).toEqual([
      { id: 'ws-a', name: '周报', rootFolder: '/repo/a' },
      { id: 'ws-b', name: '调研' },
    ]);
  });

  it('accepts the legacy `entries` manifest key', async () => {
    await writeManifest({ entries: [{ id: 'ws-x', name: 'Legacy' }] });
    const { workspaces } = await readWorkspaceManifest(root);
    expect(workspaces).toEqual([{ id: 'ws-x', name: 'Legacy', rootFolder: undefined }]);
  });

  it('unions on-disk workspace dirs not present in the manifest, excluding skills', async () => {
    await writeManifest({ workspaces: [{ id: 'ws-a', name: 'Named A' }] });
    // A workspace dir missing from the manifest still surfaces (name falls back to id).
    await fs.mkdir(join(root, 'ws-orphan'), { recursive: true });
    // `skills` and the manifest dir must never be treated as workspaces.
    await fs.mkdir(join(root, 'skills'), { recursive: true });

    const { workspaces } = await listWorkspaces(root);
    const byId = new Map(workspaces.map((w) => [w.id, w.name]));
    expect(byId.get('ws-a')).toBe('Named A');
    expect(byId.get('ws-orphan')).toBe('ws-orphan');
    expect(byId.has('skills')).toBe(false);
  });

  it('returns an empty listing when the store does not exist', async () => {
    const { workspaces, activeId } = await listWorkspaces(join(root, 'nope'));
    expect(workspaces).toEqual([]);
    expect(activeId).toBeUndefined();
  });
});
