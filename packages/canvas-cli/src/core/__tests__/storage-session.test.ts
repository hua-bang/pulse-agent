import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PulseStorage } from '@pulse-coder/storage';
import { prepareLegacyCanvasImport } from '@pulse-coder/storage/canvas';

const opened = vi.hoisted(() => ({ stores: [] as unknown[], calls: 0 }));
vi.mock('@pulse-coder/storage/local', async importOriginal => {
  const actual = await importOriginal<typeof import('@pulse-coder/storage/local')>();
  return {
    ...actual,
    openLocalStorage: async (...args: Parameters<typeof actual.openLocalStorage>) => {
      opened.calls += 1;
      const store = await actual.openLocalStorage(...args);
      if (store) opened.stores.push(store);
      return store;
    },
  };
});

import { activateLocalCanvasStorage } from '@pulse-coder/storage/local';
import { hasSqliteStorage, withStorageSession } from '../sqlite-store';
import * as store from '../store';

let root: string;
const canvas = {
  nodes: [{ id: 'n', type: 'text', title: 'N', x: 0, y: 0, width: 100, height: 80, data: { content: 'SQL' } }],
  edges: [], transform: { x: 0, y: 0, scale: 1 }, savedAt: '2026-09-24T00:00:00.000Z',
};

async function activate(): Promise<void> {
  const storage = await activateLocalCanvasStorage({
    root, loadLegacyWorkspaces: async () => [prepareLegacyCanvasImport('ws', canvas)],
  });
  await storage.close();
}

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'canvas-cli-session-'));
  opened.stores.length = 0;
  opened.calls = 0;
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

it('opens the database once per command, including concurrent reads, and closes it afterwards', async () => {
  await activate();
  opened.calls = 0;
  await withStorageSession(async () => {
    expect((await store.loadCanvas('ws', root))?.nodes).toHaveLength(1);
    expect(await store.listWorkspaceIds(root)).toEqual(['ws']);
    await Promise.all([store.loadCanvas('ws', root), store.loadCanvas('ws', root), hasSqliteStorage(root)]);
  });
  expect(opened.calls).toBe(1);
  await expect((opened.stores[0] as PulseStorage).canvas.read('ws')).rejects.toMatchObject({ code: 'storage_closed' });
});

it('keeps opening and closing per access outside a command session', async () => {
  await activate();
  opened.calls = 0;
  await store.loadCanvas('ws', root);
  await store.loadCanvas('ws', root);
  expect(opened.calls).toBe(2);
  for (const connection of opened.stores) {
    await expect((connection as PulseStorage).canvas.read('ws')).rejects.toMatchObject({ code: 'storage_closed' });
  }
});

it('does not cache an inactive root, so an activation during the command is seen', async () => {
  await withStorageSession(async () => {
    expect(await hasSqliteStorage(root)).toBe(false);
    await activate();
    expect(await hasSqliteStorage(root)).toBe(true);
    expect((await store.loadCanvas('ws', root))?.nodes).toHaveLength(1);
  });
  expect(opened.stores).toHaveLength(1);
  await expect((opened.stores[0] as PulseStorage).canvas.read('ws')).rejects.toMatchObject({ code: 'storage_closed' });
});
