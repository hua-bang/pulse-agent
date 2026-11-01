import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openSqliteStorage, type SqliteStorage } from '@pulse-coder/storage/sqlite';

const mocks = vi.hoisted(() => ({
  storage: null as unknown,
  rootFolder: undefined as string | undefined,
}));
vi.mock('../../canvas/persistence/backend', () => ({ getLocalCanvasStorage: async () => mocks.storage }));
vi.mock('./workspace-meta', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./workspace-meta')>()),
  readWorkspaceMeta: async () => ({ rootFolder: mocks.rootFolder }),
}));

import { readWorkspaceContext, writeWorkspaceContext } from './workspace-context';
import { formatWorkspaceContextSection } from './workspace-meta';
import { createWorkspaceContextTools } from './workspace-context-tool';

let dir: string;
let storage: SqliteStorage;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'workspace-context-'));
  storage = await openSqliteStorage({ path: join(dir, 'store.sqlite') });
  await storage.canvas.commit({ workspaceId: 'ws', expectedRevision: null, metadata: {} });
  mocks.storage = storage;
  mocks.rootFolder = undefined;
});
afterEach(async () => {
  await storage.close();
  await rm(dir, { recursive: true, force: true });
});

describe('workspace context storage', () => {
  it('imports a legacy pulse-workspace.md once, leaves the file alone, and never re-imports it', async () => {
    const project = join(dir, 'project');
    await mkdir(project);
    await writeFile(join(project, 'pulse-workspace.md'), '# Legacy\n');
    mocks.rootFolder = project;

    const imported = await readWorkspaceContext('ws');
    expect(imported).toEqual({ content: '# Legacy\n', revision: expect.any(Number) });

    const cleared = await writeWorkspaceContext('ws', '', imported.revision);
    expect(cleared.ok).toBe(true);
    await writeFile(join(project, 'pulse-workspace.md'), '# Edited outside\n');
    expect((await readWorkspaceContext('ws')).content).toBe('');
    expect(await readFile(join(project, 'pulse-workspace.md'), 'utf8')).toBe('# Edited outside\n');
  });

  it('returns an empty unsaved document when nothing exists', async () => {
    expect(await readWorkspaceContext('ws')).toEqual({ content: '', revision: null });
  });

  it('rejects stale writes as conflicts', async () => {
    const first = await writeWorkspaceContext('ws', 'one', null);
    expect(first).toEqual({ ok: true, revision: expect.any(Number) });
    expect(await writeWorkspaceContext('ws', 'stale', null)).toMatchObject({ ok: false, conflict: true });
  });
});

describe('workspace_context_update tool and prompt', () => {
  it('writes through storage and returns the current document on conflict', async () => {
    const tool = createWorkspaceContextTools('ws').workspace_context_update;
    const created = JSON.parse(await tool.execute({ content: '# Goal', expected_revision: null }));
    expect(created).toEqual({ ok: true, revision: expect.any(Number) });

    const user = await writeWorkspaceContext('ws', '# Goal\nuser edit', created.revision);
    const conflict = JSON.parse(await tool.execute({ content: '# Goal\nagent', expected_revision: created.revision }));
    expect(conflict).toMatchObject({
      ok: false, conflict: true, currentContent: '# Goal\nuser edit', currentRevision: user.ok ? user.revision : -1,
    });
  });

  it('tells the agent to use the tool with the current revision instead of a file', () => {
    const section = formatWorkspaceContextSection('/repo', { content: '# Goal', revision: 7 });
    expect(section).toContain('workspace_context_update');
    expect(section).toContain('expected_revision: 7');
    expect(section).toContain('never create or edit a `pulse-workspace.md` file');
    expect(formatWorkspaceContextSection(undefined, { content: '  ', revision: null })).toBe('');
  });
});
