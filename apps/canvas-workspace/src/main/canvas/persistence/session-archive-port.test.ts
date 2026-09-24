import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCanvasSessionArchivePort, setCanvasSessionArchivePort, type CanvasSessionArchivePort } from './session-archive-port';

const createPort = (): CanvasSessionArchivePort => ({
  assertWorkspaceStorage: async () => undefined,
  withWorkspaceTrashGuard: async (_workspaceId, operation) => operation(),
  exportFiles: () => [],
  prepareImport: (_workspaceId, files) => ({ files, currentSessionId: null, conversations: [] }),
  rewriteAttachmentPaths: files => files,
  attachmentPaths: () => [],
});

afterEach(() => setCanvasSessionArchivePort(null));

describe('lazy workspace conversation archive port', () => {
  it('loads once on first demand and shares concurrent requests', async () => {
    const port = createPort();
    let finish!: (port: CanvasSessionArchivePort) => void;
    const loader = vi.fn(() => new Promise<CanvasSessionArchivePort>(resolve => { finish = resolve; }));
    setCanvasSessionArchivePort(loader);
    expect(loader).not.toHaveBeenCalled();
    const first = getCanvasSessionArchivePort();
    const second = getCanvasSessionArchivePort();
    await Promise.resolve();
    expect(loader).toHaveBeenCalledOnce();
    finish(port);
    expect(await first).toBe(port);
    expect(await second).toBe(port);
    expect(await getCanvasSessionArchivePort()).toBe(port);
    expect(loader).toHaveBeenCalledOnce();
  });

  it('reports a loader failure and allows the next archive operation to retry', async () => {
    const port = createPort();
    const loader = vi.fn().mockRejectedValueOnce(new Error('Archive module unavailable')).mockResolvedValue(port);
    setCanvasSessionArchivePort(loader);
    await expect(getCanvasSessionArchivePort()).rejects.toThrow('Archive module unavailable');
    expect(await getCanvasSessionArchivePort()).toBe(port);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('accepts a directly injected codec and fails closed after unregistering it', async () => {
    const port = createPort();
    setCanvasSessionArchivePort(port);
    expect(await getCanvasSessionArchivePort()).toBe(port);
    setCanvasSessionArchivePort(null);
    await expect(getCanvasSessionArchivePort()).rejects.toThrow('integration is unavailable');
  });

  it('does not restore an obsolete codec when an earlier loader finishes after replacement', async () => {
    const previous = createPort();
    const current = createPort();
    let finish!: (port: CanvasSessionArchivePort) => void;
    setCanvasSessionArchivePort(() => new Promise<CanvasSessionArchivePort>(resolve => { finish = resolve; }));
    const pending = getCanvasSessionArchivePort();
    await Promise.resolve();
    setCanvasSessionArchivePort(current);
    finish(previous);
    expect(await pending).toBe(previous);
    expect(await getCanvasSessionArchivePort()).toBe(current);
  });
});
