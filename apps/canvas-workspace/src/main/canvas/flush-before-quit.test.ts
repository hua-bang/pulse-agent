import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ipc = new EventEmitter();
const windows: Array<{ isDestroyed: () => boolean; webContents: { send: (channel: string, requestId: string) => void } }> = [];
vi.mock('electron', () => ({
  app: { getPath: () => process.env.PULSE_TEST_USER_DATA },
  BrowserWindow: { getAllWindows: () => windows },
  ipcMain: {
    on: (channel: string, listener: (...args: unknown[]) => void) => ipc.on(channel, listener),
    removeListener: (channel: string, listener: (...args: unknown[]) => void) => ipc.removeListener(channel, listener),
    handle: () => undefined,
  },
}));
const { flushRenderersBeforeQuit, FLUSH_BEFORE_QUIT_TIMEOUT_MS } = await import('./flush-before-quit');
const { consumeUnsavedQuit } = await import('./unsaved-quit');

let userData = '';

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'unsaved-quit-'));
  process.env.PULSE_TEST_USER_DATA = userData;
});

afterEach(() => {
  windows.length = 0;
  vi.useRealTimers();
  delete process.env.PULSE_TEST_USER_DATA;
});

describe('flushRenderersBeforeQuit', () => {
  it('waits long enough for a slow disk', () => {
    expect(FLUSH_BEFORE_QUIT_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000);
  });

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
    expect(await consumeUnsavedQuit(userData)).toBe(false);
  });

  it('stops waiting for a window that never answers and records the unsaved quit', async () => {
    vi.useFakeTimers();
    windows.push({ isDestroyed: () => false, webContents: { send: vi.fn() } });
    const flushing = flushRenderersBeforeQuit(1_500);
    await vi.advanceTimersByTimeAsync(1_500);
    await flushing;
    expect(ipc.listenerCount('canvas:flushed')).toBe(0);
    expect(await consumeUnsavedQuit(userData)).toBe(true);
    expect(await consumeUnsavedQuit(userData)).toBe(false);
  });

  it('records a marker when a window reports that the save failed', async () => {
    windows.push({
      isDestroyed: () => false,
      webContents: {
        send: (_channel, requestId) => {
          setTimeout(() => ipc.emit('canvas:flushed', {}, requestId, false), 0);
        },
      },
    });
    await flushRenderersBeforeQuit(1_000);
    expect(await consumeUnsavedQuit(userData)).toBe(true);
  });
});
