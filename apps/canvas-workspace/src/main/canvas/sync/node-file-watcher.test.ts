import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
  watch: vi.fn(),
  send: vi.fn(),
}));

vi.mock('fs', () => ({
  promises: { readdir: mocks.readdir, readFile: mocks.readFile },
  watch: mocks.watch,
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: mocks.send } }],
  },
}));

import {
  markNodeFileSelfWrites,
  seedNodeFileSnapshot,
  startNodeFileWatcher,
  stopNodeFileWatcher,
} from './node-file-watcher';

class FakeWatcher extends EventEmitter {
  close = vi.fn();
}

const nodeJson = (content: string, updatedAt: number): string => JSON.stringify({
  type: 'text',
  title: 'Note',
  data: { content },
  updatedAt,
});

describe('per-node canvas watcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.readdir.mockReset();
    mocks.readFile.mockReset();
    mocks.watch.mockReset();
    mocks.send.mockReset();
  });

  afterEach(() => {
    stopNodeFileWatcher('ws-1');
    vi.useRealTimers();
  });

  it('batches visible file changes and broadcasts the node id', async () => {
    const watcher = new FakeWatcher();
    mocks.watch.mockReturnValue(watcher);
    mocks.readdir.mockResolvedValue(['node-1.json']);
    mocks.readFile
      .mockResolvedValueOnce(nodeJson('before', 1))
      .mockResolvedValueOnce(nodeJson('after', 2));

    await seedNodeFileSnapshot('ws-1');
    startNodeFileWatcher('ws-1');
    watcher.emit('change', 'change', 'node-1.json');
    await vi.advanceTimersByTimeAsync(100);

    expect(mocks.send).toHaveBeenCalledWith('canvas:external-update', {
      type: 'canvas:updated',
      workspaceId: 'ws-1',
      nodeIds: ['node-1'],
      edgeIds: [],
      source: 'fs-watch',
    });
  });

  it('suppresses a recent self-write even when the snapshot is stale', async () => {
    const watcher = new FakeWatcher();
    mocks.watch.mockReturnValue(watcher);
    mocks.readFile.mockResolvedValue(nodeJson('after', 2));

    markNodeFileSelfWrites('ws-1', ['node-1']);
    startNodeFileWatcher('ws-1');
    watcher.emit('change', 'change', 'node-1.json');
    await vi.advanceTimersByTimeAsync(100);

    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('suppresses identical bytes and metadata-only changes', async () => {
    const watcher = new FakeWatcher();
    mocks.watch.mockReturnValue(watcher);
    mocks.readdir.mockResolvedValue(['node-1.json']);
    mocks.readFile
      .mockResolvedValueOnce(nodeJson('same', 1))
      .mockResolvedValueOnce(nodeJson('same', 2));

    await seedNodeFileSnapshot('ws-1');
    startNodeFileWatcher('ws-1');
    watcher.emit('change', 'change', 'node-1.json');
    await vi.advanceTimersByTimeAsync(100);

    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('broadcasts deletion of a previously seeded node', async () => {
    const watcher = new FakeWatcher();
    const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });
    mocks.watch.mockReturnValue(watcher);
    mocks.readdir.mockResolvedValue(['node-1.json']);
    mocks.readFile
      .mockResolvedValueOnce(nodeJson('before', 1))
      .mockRejectedValueOnce(missing);

    await seedNodeFileSnapshot('ws-1');
    startNodeFileWatcher('ws-1');
    watcher.emit('change', 'rename', 'node-1.json');
    await vi.advanceTimersByTimeAsync(100);

    expect(mocks.send).toHaveBeenCalledWith(
      'canvas:external-update',
      expect.objectContaining({ workspaceId: 'ws-1', nodeIds: ['node-1'] }),
    );
  });

  it('broadcasts after the self-write suppression window expires', async () => {
    const watcher = new FakeWatcher();
    mocks.watch.mockReturnValue(watcher);
    mocks.readFile.mockResolvedValue(nodeJson('external', 2));

    markNodeFileSelfWrites('ws-1', ['node-1']);
    startNodeFileWatcher('ws-1');
    await vi.advanceTimersByTimeAsync(501);
    watcher.emit('change', 'change', 'node-1.json');
    await vi.advanceTimersByTimeAsync(100);

    expect(mocks.send).toHaveBeenCalledOnce();
  });

  it('is idempotent and stop cancels a pending batch before restart', async () => {
    const firstWatcher = new FakeWatcher();
    const restartedWatcher = new FakeWatcher();
    mocks.watch
      .mockReturnValueOnce(firstWatcher)
      .mockReturnValueOnce(restartedWatcher);
    mocks.readFile.mockResolvedValue(nodeJson('external', 2));

    startNodeFileWatcher('ws-1');
    startNodeFileWatcher('ws-1');
    firstWatcher.emit('change', 'change', 'node-1.json');
    stopNodeFileWatcher('ws-1');
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.send).not.toHaveBeenCalled();

    startNodeFileWatcher('ws-1');
    restartedWatcher.emit('change', 'change', 'node-1.json');
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.watch).toHaveBeenCalledTimes(2);
    expect(mocks.send).toHaveBeenCalledOnce();
  });
});
