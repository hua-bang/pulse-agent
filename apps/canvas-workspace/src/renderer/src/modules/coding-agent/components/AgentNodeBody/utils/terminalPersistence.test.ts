import { describe, expect, it, vi } from 'vitest';
import {
  claimTerminalSessionOwner,
  createPtySpawnLifecycle,
  createTerminalSnapshotPersister,
  finalizeTerminalSnapshotBeforeDispose,
  type TerminalSnapshot,
  writeTerminalOutput,
} from './terminal';

const initialSnapshot: TerminalSnapshot = {
  scrollback: 'saved output',
  cwd: '/workspace',
};

describe('createTerminalSnapshotPersister', () => {
  it('does no snapshot work or update on an idle interval tick', async () => {
    const persist = vi.fn();
    const readSnapshot = vi.fn(() => initialSnapshot);
    const persister = createTerminalSnapshotPersister({ initialSnapshot, readSnapshot, persist });

    expect(await persister.flush()).toBe(false);
    expect(readSnapshot).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it('coalesces a burst of PTY output into one persisted snapshot', async () => {
    const persist = vi.fn();
    const readSnapshot = vi.fn(() => ({
      scrollback: 'saved output\nthree chunks',
      cwd: '/workspace',
    }));
    const persister = createTerminalSnapshotPersister({ initialSnapshot, readSnapshot, persist });

    persister.markDirty();
    persister.markDirty();
    persister.markDirty();

    expect(await persister.flush()).toBe(true);
    expect(readSnapshot).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith({
      scrollback: 'saved output\nthree chunks',
      cwd: '/workspace',
    });

    expect(await persister.flush()).toBe(false);
    expect(readSnapshot).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('skips the update when a dirty snapshot is unchanged', async () => {
    const persist = vi.fn();
    const readSnapshot = vi.fn(() => ({ ...initialSnapshot }));
    const persister = createTerminalSnapshotPersister({ initialSnapshot, readSnapshot, persist });

    persister.markDirty();

    expect(await persister.flush()).toBe(false);
    expect(readSnapshot).toHaveBeenCalledTimes(1);
    expect(persist).not.toHaveBeenCalled();
  });

  it('flushes the last dirty output during unmount cleanup', async () => {
    const persist = vi.fn();
    const readSnapshot = vi.fn(() => ({
      scrollback: 'saved output\nlast chunk before unmount',
      cwd: '/workspace/subdir',
    }));
    const persister = createTerminalSnapshotPersister({ initialSnapshot, readSnapshot, persist });

    persister.markDirty();

    expect(await persister.flushFinal()).toBe(true);
    expect(readSnapshot).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('does not acknowledge output until xterm reports that parsing completed', async () => {
    let buffer = 'saved output';
    const parserCallbacks: Array<() => void> = [];
    const term = {
      write: (data: string, callback?: () => void) => {
        parserCallbacks.push(() => {
          buffer += data;
          callback?.();
        });
      },
      writeln: vi.fn(),
    };
    const persist = vi.fn();
    const persister = createTerminalSnapshotPersister({
      initialSnapshot,
      readSnapshot: () => ({ scrollback: buffer, cwd: '/workspace' }),
      persist,
    });

    writeTerminalOutput(term as never, '\ntail chunk', persister);
    expect(await persister.flush()).toBe(false);
    expect(persist).not.toHaveBeenCalled();

    parserCallbacks.shift()?.();
    expect(await persister.flush()).toBe(true);
    expect(persist).toHaveBeenCalledWith({
      scrollback: 'saved output\ntail chunk',
      cwd: '/workspace',
    });
  });

  it('queues final capture behind pending parser work before disposing xterm', async () => {
    let buffer = 'saved output';
    const parserCallbacks: Array<() => void> = [];
    const term = {
      write: (data: string, callback?: () => void) => {
        parserCallbacks.push(() => {
          buffer += data;
          callback?.();
        });
      },
      writeln: vi.fn(),
    };
    let releasePersist: (() => void) | undefined;
    const persist = vi.fn(() => new Promise<void>((resolve) => {
      releasePersist = resolve;
    }));
    const dispose = vi.fn();
    const persister = createTerminalSnapshotPersister({
      initialSnapshot,
      readSnapshot: () => ({ scrollback: buffer, cwd: '/workspace' }),
      persist,
    });

    writeTerminalOutput(term as never, '\nlast parser chunk', persister);
    finalizeTerminalSnapshotBeforeDispose(term as never, persister, dispose);
    expect(parserCallbacks).toHaveLength(2);
    expect(dispose).not.toHaveBeenCalled();

    parserCallbacks.shift()?.();
    expect(dispose).not.toHaveBeenCalled();
    parserCallbacks.shift()?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(persist).toHaveBeenCalledWith({
      scrollback: 'saved output\nlast parser chunk',
      cwd: '/workspace',
    });
    expect(dispose).not.toHaveBeenCalled();
    releasePersist?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});

describe('terminal session ownership handoff', () => {
  it('reclaims a scoped late spawn even when no snapshot owner is needed', () => {
    const lifecycle = createPtySpawnLifecycle();
    const kill = vi.fn();

    lifecycle.cancel();

    expect(lifecycle.reclaimIfCancelled({ ok: true, leaseId: 'dock-lease' }, kill)).toBe(true);
    expect(kill).toHaveBeenCalledWith('dock-lease');
  });

  it('suppresses a stale owner update and rebases its final snapshot into the successor', async () => {
    const oldOwner = claimTerminalSessionOwner('handoff-session');
    oldOwner.beginFinalization();
    const newOwner = claimTerminalSessionOwner('handoff-session');
    const oldPersist = vi.fn();
    const newPersist = vi.fn();

    await oldOwner.persistIfCurrent({ scrollback: 'old final chunk', cwd: '/old' }, oldPersist);
    oldOwner.finishFinalization();
    await newOwner.persistIfCurrent({ scrollback: 'new final chunk', cwd: '/new' }, newPersist);

    expect(oldPersist).not.toHaveBeenCalled();
    expect(newPersist).toHaveBeenCalledWith({
      scrollback: 'old final chunk\nnew final chunk',
      cwd: '/new',
    });
    newOwner.beginFinalization();
    newOwner.finishFinalization();
  });

  it('does not discard repeated successor output that also appeared in the predecessor', async () => {
    const oldOwner = claimTerminalSessionOwner('repeated-output-session');
    oldOwner.beginFinalization();
    const newOwner = claimTerminalSessionOwner('repeated-output-session');
    const persist = vi.fn();

    await oldOwner.persistIfCurrent({ scrollback: 'status: ok', cwd: '/old' }, vi.fn());
    oldOwner.finishFinalization();
    await newOwner.persistIfCurrent({ scrollback: 'ok', cwd: '/new' }, persist);

    expect(persist).toHaveBeenCalledWith({ scrollback: 'status: ok\nok', cwd: '/new' });
    newOwner.beginFinalization();
    newOwner.finishFinalization();
  });
});
