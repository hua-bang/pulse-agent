import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  watch: vi.fn(),
  send: vi.fn(),
}));

vi.mock('fs', () => ({
  promises: { readFile: mocks.readFile },
  watch: mocks.watch,
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: mocks.send } }],
  },
}));

import {
  setWorkspaceSnapshot,
  seedWorkspaceSnapshotFromDisk,
  startWorkspaceWatcher,
  stopWorkspaceWatcher,
} from './workspace-watcher';

class FakeWatcher extends EventEmitter {
  close = vi.fn();
}

describe('workspace canvas watcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.readFile.mockReset();
    mocks.watch.mockReset();
    mocks.send.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces disk changes and broadcasts node and edge diffs once', async () => {
    const watcher = new FakeWatcher();
    mocks.watch.mockReturnValue(watcher);
    mocks.readFile.mockResolvedValue(JSON.stringify({
      nodes: [{ id: 'node-1', updatedAt: 2 }],
      edges: [{ id: 'edge-1', updatedAt: 2 }],
    }));
    setWorkspaceSnapshot(
      'ws-1',
      [{ id: 'node-1', updatedAt: 1 }],
      [{ id: 'edge-1', updatedAt: 1 }],
    );
    const observe = vi.fn();

    startWorkspaceWatcher('ws-1', observe);
    startWorkspaceWatcher('ws-1', observe);
    watcher.emit('change');
    watcher.emit('change');
    await vi.advanceTimersByTimeAsync(100);

    expect(mocks.watch).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledWith('ws-1', expect.anything());
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.send).toHaveBeenCalledWith('canvas:external-update', {
      type: 'canvas:updated',
      workspaceId: 'ws-1',
      nodeIds: ['node-1'],
      edgeIds: ['edge-1'],
      source: 'fs-watch',
    });

    stopWorkspaceWatcher('ws-1');
    expect(watcher.close).toHaveBeenCalledOnce();
  });

  it('cancels pending work, clears snapshots, and can restart from a disk seed', async () => {
    const firstWatcher = new FakeWatcher();
    const restartedWatcher = new FakeWatcher();
    mocks.watch
      .mockReturnValueOnce(firstWatcher)
      .mockReturnValueOnce(restartedWatcher);
    mocks.readFile.mockResolvedValue(JSON.stringify({
      nodes: [{ id: 'node-1', updatedAt: 2 }],
      edges: [{ id: 'edge-1', updatedAt: 2 }],
    }));

    startWorkspaceWatcher('ws-1', vi.fn());
    firstWatcher.emit('change');
    stopWorkspaceWatcher('ws-1');
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.send).not.toHaveBeenCalled();

    await seedWorkspaceSnapshotFromDisk('ws-1');
    startWorkspaceWatcher('ws-1', vi.fn());
    restartedWatcher.emit('change');
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.watch).toHaveBeenCalledTimes(2);
    expect(mocks.send).not.toHaveBeenCalled();

    stopWorkspaceWatcher('ws-1');
  });
});
