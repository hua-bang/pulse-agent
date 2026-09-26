import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ipc = new EventEmitter();
const windows: Array<{ isDestroyed: () => boolean; webContents: { send: (channel: string, requestId: string) => void } }> = [];
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => windows },
  ipcMain: {
    on: (channel: string, listener: (...args: unknown[]) => void) => ipc.on(channel, listener),
    removeListener: (channel: string, listener: (...args: unknown[]) => void) => ipc.removeListener(channel, listener),
  },
}));
const { flushRenderersBeforeQuit } = await import('./flush-before-quit');

afterEach(() => {
  windows.length = 0;
  vi.useRealTimers();
});

describe('flushRenderersBeforeQuit', () => {
  it('waits for each window to answer its own request', async () => {
    const send = vi.fn((_channel: string, requestId: string) => {
      setTimeout(() => ipc.emit('canvas:flushed', {}, 'someone-else'), 0);
      setTimeout(() => ipc.emit('canvas:flushed', {}, requestId), 5);
    });
    windows.push({ isDestroyed: () => false, webContents: { send } });
    let settled = false;
    const flushing = flushRenderersBeforeQuit(1_000).then(() => { settled = true; });
    await new Promise(resolve => setTimeout(resolve, 2));
    expect(settled).toBe(false);
    await flushing;
    expect(send).toHaveBeenCalledWith('canvas:flush-before-quit', expect.any(String));
    expect(ipc.listenerCount('canvas:flushed')).toBe(0);
  });

  it('stops waiting for a window that never answers', async () => {
    vi.useFakeTimers();
    windows.push({ isDestroyed: () => false, webContents: { send: vi.fn() } });
    const flushing = flushRenderersBeforeQuit(1_500);
    await vi.advanceTimersByTimeAsync(1_500);
    await flushing;
    expect(ipc.listenerCount('canvas:flushed')).toBe(0);
  });
});
