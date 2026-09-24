import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  canvas: vi.fn(), sessions: vi.fn(), recover: vi.fn(), open: vi.fn(),
  canvasBackend: vi.fn(), sessionBackend: vi.fn(), registerArchive: vi.fn(), createArchive: vi.fn(),
  closeCanvas: vi.fn(), closeSessions: vi.fn(), stopObserver: vi.fn(),
  quit: vi.fn(), showErrorBox: vi.fn(), showMessageBox: vi.fn(), recoverImports: vi.fn(),
}));
vi.mock('electron', () => ({
  app: { quit: mocks.quit }, dialog: { showErrorBox: mocks.showErrorBox, showMessageBox: mocks.showMessageBox },
}));
vi.mock('../canvas/persistence/activate-sqlite', () => ({ activateCanvasSqlite: mocks.canvas }));
vi.mock('../canvas/persistence/backend', () => ({
  getLocalCanvasStorage: mocks.open, getCanvasBackend: mocks.canvasBackend, closeCanvasStorage: mocks.closeCanvas,
}));
vi.mock('../canvas/persistence/paths', () => ({ STORE_DIR: '/test-storage' }));
vi.mock('../canvas/sqlite-ipc', () => ({ stopSqliteCanvasObserver: mocks.stopObserver }));
vi.mock('../agent/sqlite-session-migration', () => ({ activateSqliteSessions: mocks.sessions }));
vi.mock('../agent/sqlite-session-backend', () => ({
  getSqliteSessionStorage: mocks.sessionBackend, closeSqliteSessionStorage: mocks.closeSessions,
}));
vi.mock('../agent/workspace-session-archive', () => ({ createCanvasSessionArchivePort: mocks.createArchive }));
vi.mock('../canvas/persistence/session-archive-port', () => ({ setCanvasSessionArchivePort: mocks.registerArchive }));
vi.mock('@pulse-coder/storage/local-files', () => ({ recoverLocalFileWrites: mocks.recover }));
vi.mock('../canvas/persistence/import-recovery', () => ({ recoverInterruptedWorkspaceImports: mocks.recoverImports }));

import { startStorage, stopStorageAfterWriters } from './storage-lifecycle';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.canvasBackend.mockResolvedValue(null);
  mocks.sessionBackend.mockResolvedValue(null);
  mocks.canvas.mockResolvedValue(undefined);
  mocks.sessions.mockResolvedValue([]);
  mocks.open.mockResolvedValue({});
  mocks.closeCanvas.mockResolvedValue(undefined);
  mocks.closeSessions.mockResolvedValue(undefined);
  mocks.recover.mockResolvedValue({ ok: true, items: [], conflicts: 0, errors: 0 });
  mocks.recoverImports.mockResolvedValue([]);
});

describe('first-upgrade startup boundary', () => {
  it('does not release startup until Canvas and conversation migrations finish', async () => {
    let finishCanvas!: () => void;
    let finish!: (skipped: never[]) => void;
    mocks.canvas.mockReturnValueOnce(new Promise<void>(resolve => { finishCanvas = resolve; }));
    mocks.sessions.mockReturnValueOnce(new Promise<never[]>(resolve => { finish = resolve; }));
    const startup = startStorage(vi.fn());
    await vi.waitFor(() => expect(mocks.canvas).toHaveBeenCalledOnce());
    expect(mocks.sessionBackend).not.toHaveBeenCalled();
    expect(mocks.sessions).not.toHaveBeenCalled();
    finishCanvas();
    await vi.waitFor(() => expect(mocks.sessions).toHaveBeenCalledOnce());
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.recover).not.toHaveBeenCalled();
    finish([]);
    expect(await startup).toBe(true);
    expect(mocks.recover).toHaveBeenCalledOnce();
    expect(mocks.quit).not.toHaveBeenCalled();
    expect(mocks.showMessageBox).not.toHaveBeenCalled();
  });

  it('recovers interrupted imports before IPC and keeps starting when that recovery fails', async () => {
    const results = [{ workspaceId: 'ws', outcome: 'published' }];
    mocks.recoverImports.mockResolvedValueOnce(results);
    const writeLog = vi.fn();
    expect(await startStorage(writeLog)).toBe(true);
    expect(mocks.recoverImports).toHaveBeenCalledWith('/test-storage', {});
    expect(writeLog).toHaveBeenCalledWith('storage', expect.stringContaining('Recovered'), JSON.stringify(results));
    mocks.recoverImports.mockRejectedValueOnce(new Error('manifest locked'));
    expect(await startStorage(writeLog)).toBe(true);
    expect(writeLog).toHaveBeenCalledWith('storage', expect.stringContaining('recovery failed'), expect.stringContaining('manifest locked'));
    expect(mocks.quit).not.toHaveBeenCalled();
  });

  it('starts after skipping unreadable session files, logging and announcing them without waiting', async () => {
    const skipped = [{ path: '/sessions/ws/agent-sessions/archive/broken.json', reason: 'Cannot migrate corrupted session JSON' }];
    mocks.sessions.mockResolvedValueOnce(skipped);
    mocks.showMessageBox.mockReturnValueOnce(new Promise(() => undefined));
    const writeLog = vi.fn();
    expect(await startStorage(writeLog)).toBe(true);
    expect(writeLog).toHaveBeenCalledWith('storage', expect.stringContaining('Skipped'), JSON.stringify(skipped));
    expect(mocks.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
      type: 'warning', detail: expect.stringContaining(skipped[0].path),
    }));
    expect(mocks.recover).toHaveBeenCalledOnce();
    expect(mocks.quit).not.toHaveBeenCalled();
  });

  it('opens activated domains without running their legacy importers', async () => {
    mocks.canvasBackend.mockResolvedValue({});
    mocks.sessionBackend.mockResolvedValue({});
    expect(await startStorage(vi.fn())).toBe(true);
    expect(mocks.canvasBackend).toHaveBeenCalledWith('/test-storage');
    expect(mocks.sessionBackend).toHaveBeenCalledWith();
    expect(mocks.canvas).not.toHaveBeenCalled();
    expect(mocks.sessions).not.toHaveBeenCalled();
    expect(mocks.recover).toHaveBeenCalledOnce();
  });

  it('registers archive codecs without constructing them until an archive operation requests them', async () => {
    const port = {};
    mocks.createArchive.mockReturnValue(port);
    expect(await startStorage(vi.fn())).toBe(true);
    expect(mocks.registerArchive).toHaveBeenCalledOnce();
    expect(mocks.createArchive).not.toHaveBeenCalled();
    const loader = mocks.registerArchive.mock.calls[0][0];
    expect(await loader()).toBe(port);
    expect(mocks.createArchive).toHaveBeenCalledOnce();
  });

  it.each(['canvasBackend', 'sessionBackend'] as const)('migrates only the inactive domain when %s is active', async backend => {
    mocks[backend].mockResolvedValue({});
    expect(await startStorage(vi.fn())).toBe(true);
    expect(mocks.canvas).toHaveBeenCalledTimes(backend === 'canvasBackend' ? 0 : 1);
    expect(mocks.sessions).toHaveBeenCalledTimes(backend === 'sessionBackend' ? 0 : 1);
  });

  it.each(['canvasBackend', 'sessionBackend'] as const)('fails closed when active %s validation rejects', async backend => {
    mocks.canvasBackend.mockResolvedValue({});
    mocks.sessionBackend.mockResolvedValue({});
    mocks[backend].mockRejectedValueOnce(new Error('Active database schema is unsupported'));
    expect(await startStorage(vi.fn())).toBe(false);
    expect(mocks.canvas).not.toHaveBeenCalled();
    expect(mocks.sessions).not.toHaveBeenCalled();
    expect(mocks.recover).not.toHaveBeenCalled();
    expect(mocks.closeCanvas).toHaveBeenCalledOnce();
    expect(mocks.closeSessions).toHaveBeenCalledOnce();
    expect(mocks.showErrorBox).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('Active database schema is unsupported'));
    expect(mocks.quit).toHaveBeenCalledOnce();
  });

  it.each(['canvas', 'sessions'] as const)('stops startup visibly when %s data cannot migrate', async domain => {
    mocks[domain].mockRejectedValueOnce(new Error('Unsupported legacy schema 99'));
    const log = vi.fn().mockResolvedValue(undefined);
    expect(await startStorage(log)).toBe(false);
    expect(mocks.recover).not.toHaveBeenCalled();
    if (domain === 'canvas') expect(mocks.sessions).not.toHaveBeenCalled();
    expect(mocks.showErrorBox).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('Unsupported legacy schema 99'));
    expect(mocks.closeCanvas).toHaveBeenCalledOnce();
    expect(mocks.closeSessions).toHaveBeenCalledOnce();
    expect(mocks.quit).toHaveBeenCalledOnce();
    expect(await startStorage(log)).toBe(true);
  });

  it('keeps a recoverable file conflict visible without blocking access to other data', async () => {
    mocks.recover.mockResolvedValue({ ok: false, conflicts: 1, errors: 0 });
    const log = vi.fn().mockResolvedValue(undefined);
    expect(await startStorage(log)).toBe(true);
    expect(log).toHaveBeenCalledWith('storage', 'Some file writes need recovery', expect.stringContaining('"conflicts":1'));
    expect(mocks.quit).not.toHaveBeenCalled();
  });
});

describe('storage shutdown', () => {
  it('closes connections only after queued persistence completes', async () => {
    let finish!: () => void;
    const drain = new Promise<void>(resolve => { finish = resolve; });
    const shutdown = stopStorageAfterWriters(() => drain, vi.fn());
    await Promise.resolve();
    expect(mocks.closeSessions).not.toHaveBeenCalled();
    finish();
    expect(await shutdown).toBe(true);
    expect(mocks.closeSessions).toHaveBeenCalledOnce();
    expect(mocks.closeCanvas).toHaveBeenCalledOnce();
  });

  it('does not close handles beneath a provider that ignores shutdown', async () => {
    vi.useFakeTimers();
    try {
      let finish!: () => void;
      const drain = new Promise<void>(resolve => { finish = resolve; });
      const shutdown = stopStorageAfterWriters(() => drain, vi.fn().mockResolvedValue(undefined), 100);
      await vi.advanceTimersByTimeAsync(101);
      expect(await shutdown).toBe(false);
      finish();
      await Promise.resolve();
      expect(mocks.closeSessions).not.toHaveBeenCalled();
      expect(mocks.closeCanvas).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
