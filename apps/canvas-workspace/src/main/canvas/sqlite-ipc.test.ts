import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PulseStorage } from '@pulse-coder/storage';
import { openSqliteStorage } from '@pulse-coder/storage/sqlite';
import { createCanvasCompatibilityStore } from '@pulse-coder/storage/canvas';

const state = vi.hoisted(() => ({
  store: null as PulseStorage | null,
  backend: null as ReturnType<typeof createCanvasCompatibilityStore> | null,
  firstWindow: vi.fn(), secondWindow: vi.fn(),
}));
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [
  { isDestroyed: () => false, webContents: { send: state.firstWindow } },
  { isDestroyed: () => false, webContents: { send: state.secondWindow } },
] } }));
vi.mock('./persistence/backend', () => ({
  getCanvasBackend: async () => state.backend,
  getLocalCanvasStorage: async () => state.store,
}));
vi.mock('./sync/markdown-index', () => ({ watchWorkspaceMarkdown: vi.fn(), stopMarkdownIndexWatchers: vi.fn() }));

import { loadSqliteCanvas, saveSqliteCanvas, stopSqliteCanvasObserver } from './sqlite-ipc';

beforeEach(async () => {
  vi.useFakeTimers();
  state.firstWindow.mockReset();
  state.secondWindow.mockReset();
  state.store = await openSqliteStorage({ path: ':memory:' });
  state.backend = createCanvasCompatibilityStore(state.store.canvas);
});
afterEach(async () => {
  stopSqliteCanvasObserver();
  await Promise.resolve();
  await state.store?.close();
  vi.useRealTimers();
});

describe('SQLite Canvas IPC contracts', () => {
  it('returns the generation on create so the next renderer save can succeed', async () => {
    const first = await saveSqliteCanvas('new', { nodes: [], edges: [] });
    expect(first).toMatchObject({ ok: true, revision: 1, storageGeneration: state.store!.generation });
    expect(await saveSqliteCanvas('new', {
      nodes: [{ id: 'n', type: 'text', data: { content: 'second save' } }], edges: [],
      revision: 1, storageGeneration: state.store!.generation,
    })).toMatchObject({ ok: true, revision: 2 });
    expect((await loadSqliteCanvas('new'))?.data?.nodes).toHaveLength(1);
  });

  it('broadcasts a renderer commit to sibling windows and returns conflicts with fresh data', async () => {
    await saveSqliteCanvas('ws', { nodes: [{ id: 'n', type: 'text', data: { content: 'base' } }] });
    const loaded = (await loadSqliteCanvas('ws'))!.data!;
    const first = JSON.parse(JSON.stringify(loaded));
    first.nodes[0].data.content = 'newer';
    expect(await saveSqliteCanvas('ws', first)).toMatchObject({ ok: true, revision: 2 });
    const stale = await saveSqliteCanvas('ws', loaded);
    expect(stale).toMatchObject({ ok: false, code: 'revision_conflict', data: { revision: 2 } });
    await vi.advanceTimersByTimeAsync(251);
    for (const send of [state.firstWindow, state.secondWindow]) {
      expect(send).toHaveBeenCalledWith('canvas:external-update', expect.objectContaining({ workspaceId: 'ws', revision: 2 }));
    }
  });

  it('keeps notifying healthy windows when another renderer is closing', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    state.firstWindow.mockImplementation(() => { throw new Error('webContents destroyed'); });
    try {
      await saveSqliteCanvas('ws', { nodes: [], edges: [] });
      await vi.advanceTimersByTimeAsync(251);
      expect(state.secondWindow).toHaveBeenCalledTimes(1);
      const current = (await loadSqliteCanvas('ws'))!.data!;
      await saveSqliteCanvas('ws', { ...current, transform: { x: 1, y: 2, scale: 1 } });
      await vi.advanceTimersByTimeAsync(251);
      expect(state.secondWindow).toHaveBeenCalledTimes(2);
      expect(state.secondWindow).toHaveBeenLastCalledWith('canvas:external-update', expect.objectContaining({ revision: 2 }));
    } finally {
      warning.mockRestore();
    }
  });
});
