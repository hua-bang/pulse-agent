import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IpcRenderer } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  sendOne: vi.fn(),
  sendTwo: vi.fn(),
}));
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: (...args: any[]) => any) => mocks.handlers.set(channel, handler) },
  BrowserWindow: { getAllWindows: () => [{ webContents: { send: mocks.sendOne } }, { webContents: { send: mocks.sendTwo } }] },
  dialog: {}, clipboard: {}, nativeImage: {}, shell: {},
}));

import { setupFileManagerIpc } from './manager';
import { createFileApi } from '../../preload/bridge/file';

let directory: string;
let path: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'file-io-ipc-'));
  path = join(directory, 'note.md');
  await writeFile(path, 'original');
  mocks.handlers.clear();
  mocks.sendOne.mockClear();
  mocks.sendTwo.mockClear();
  setupFileManagerIpc();
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe('versioned file IPC', () => {
  it('returns read versions without broadcasting, and broadcasts only successful writes', async () => {
    const read = await mocks.handlers.get('file:read')!(null, { filePath: path });
    expect(read).toMatchObject({ ok: true, content: 'original', version: expect.any(String) });
    expect(mocks.sendOne).not.toHaveBeenCalled();
    const written = await mocks.handlers.get('file:write')!(null, {
      filePath: path, content: 'edited', expectedVersion: read.version,
    });
    expect(written).toMatchObject({ ok: true, version: expect.any(String) });
    for (const send of [mocks.sendOne, mocks.sendTwo]) {
      expect(send).toHaveBeenCalledWith('canvas:file-changed', { filePath: path, content: 'edited' });
    }
    const stale = await mocks.handlers.get('file:write')!(null, {
      filePath: path, content: 'stale', expectedVersion: read.version,
    });
    expect(stale).toMatchObject({ ok: false, conflict: true });
    expect(mocks.sendOne).toHaveBeenCalledTimes(1);
    expect(await readFile(path, 'utf8')).toBe('edited');
  });

  it('keeps legacy write payloads and forwards the optional expected version through preload', async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true });
    const bridge = createFileApi({ invoke } as unknown as IpcRenderer);
    await bridge.write(path, 'legacy');
    expect(invoke).toHaveBeenLastCalledWith('file:write', { filePath: path, content: 'legacy' });
    await bridge.write(path, 'conditional', 'sha-version');
    expect(invoke).toHaveBeenLastCalledWith('file:write', {
      filePath: path, content: 'conditional', expectedVersion: 'sha-version',
    });
    expect(await mocks.handlers.get('file:write')!(null, { filePath: path, content: 'legacy' }))
      .toMatchObject({ ok: true, version: expect.any(String) });
  });
});
