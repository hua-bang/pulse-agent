// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasNode } from '../../types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class MockTerminal {
  static instances: MockTerminal[] = [];

  private content = '';
  readonly options: { fontSize?: number } = {};
  readonly cols = 80;
  readonly rows = 24;
  readonly buffer = {
    active: {
      get length() {
        const terminal = MockTerminal.instances.at(-1);
        return terminal?.content ? terminal.content.split('\n').length : 0;
      },
      getLine: (index: number) => {
        const terminal = MockTerminal.instances.at(-1);
        const line = terminal?.content.split('\n')[index];
        return line === undefined ? undefined : { translateToString: () => line };
      },
    },
  };

  constructor() {
    MockTerminal.instances.push(this);
  }

  loadAddon(): void {}
  open(): void {}
  attachCustomKeyEventHandler(): void {}
  onData(): { dispose: () => void } { return { dispose: () => undefined }; }
  onResize(): { dispose: () => void } { return { dispose: () => undefined }; }
  focus(): void {}
  disposed = false;
  dispose(): void { this.disposed = true; }
  write(data: string, callback?: () => void): void {
    queueMicrotask(() => {
      if (data !== '\x07') this.content += data.replace(/\r\n/g, '\n');
      callback?.();
    });
  }
  writeln(data = '', callback?: () => void): void {
    this.write(`${data}\n`, callback);
  }
}

class MockFitAddon {
  fit(): void {}
}

let TerminalNodeBody: typeof import('./index').TerminalNodeBody;
let root: Root | null = null;
let host: HTMLDivElement | null = null;
let emitPtyData: ((data: string) => void) | null = null;
let onUpdate: ReturnType<typeof vi.fn>;
let getCwd: ReturnType<typeof vi.fn>;
let kill: ReturnType<typeof vi.fn>;
let spawn: ReturnType<typeof vi.fn>;
let onData = vi.fn((_sessionId: string, _callback: (data: string) => void) => () => undefined);
let onExit = vi.fn(() => () => undefined);

const terminalNode: CanvasNode = {
  id: 'terminal-1',
  type: 'terminal',
  title: 'Terminal',
  x: 0,
  y: 0,
  width: 640,
  height: 420,
  data: { sessionId: 'session-1', scrollback: '', cwd: '/workspace' },
};

beforeAll(async () => {
  vi.doMock('@xterm/xterm', () => ({ Terminal: MockTerminal }));
  vi.doMock('@xterm/addon-fit', () => ({ FitAddon: MockFitAddon }));
  vi.doMock('../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
  ({ TerminalNodeBody } = await import('./index'));
});

beforeEach(() => {
  vi.useFakeTimers();
  MockTerminal.instances = [];
  emitPtyData = null;
  onUpdate = vi.fn();
  getCwd = vi.fn().mockResolvedValue({ ok: true, cwd: '/workspace' });
  kill = vi.fn();
  spawn = vi.fn().mockResolvedValue({ ok: true, leaseId: 'lease-default' });
  onData = vi.fn((_sessionId: string, callback: (data: string) => void) => {
    emitPtyData = callback;
    return () => undefined;
  });
  onExit = vi.fn(() => () => undefined);
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: class {
      observe(): void {}
      disconnect(): void {}
    },
  });
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    value: (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    },
  });
  Object.defineProperty(window, 'canvasWorkspace', {
    configurable: true,
    value: {
      pty: {
        spawn,
        getCwd,
        onData,
        onExit,
        write: vi.fn(),
        resize: vi.fn(),
        kill,
      },
    },
  });
});

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount();
      await Promise.resolve();
    });
  }
  host?.remove();
  root = null;
  host = null;
  Reflect.deleteProperty(window, 'canvasWorkspace');
  vi.useRealTimers();
});

afterAll(() => {
  vi.doUnmock('@xterm/xterm');
  vi.doUnmock('@xterm/addon-fit');
  vi.doUnmock('../../i18n');
});

describe('TerminalNodeBody scrollback persistence', () => {
  it('reclaims a successful PTY spawn that resolves after unmount', async () => {
    const lateSpawn = createDeferred<{ ok: true; leaseId: string }>();
    spawn.mockReturnValueOnce(lateSpawn.promise);

    await mountTerminal();
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(onData).not.toHaveBeenCalled();

    await unmountTerminal();
    lateSpawn.resolve({ ok: true, leaseId: 'lease-late' });
    await flushPromises();

    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith('session-1', 'lease-late');
    expect(onData).not.toHaveBeenCalled();
    expect(onExit).not.toHaveBeenCalled();
    expect(MockTerminal.instances[0]?.disposed).toBe(true);
  });

  it('ignores a failed PTY spawn that resolves after unmount', async () => {
    const lateSpawn = createDeferred<{ ok: false; error: string }>();
    spawn.mockReturnValueOnce(lateSpawn.promise);

    await mountTerminal();
    await unmountTerminal();
    lateSpawn.resolve({ ok: false, error: 'late failure' });
    await flushPromises();

    expect(kill).not.toHaveBeenCalled();
    expect(onData).not.toHaveBeenCalled();
    expect(onExit).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('does no CWD IPC or node update on an idle save tick', async () => {
    await renderTerminal();

    await advanceSaveTick();

    expect(getCwd).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('coalesces a PTY output burst into one update', async () => {
    await renderTerminal();

    act(() => {
      emitPtyData?.('one');
      emitPtyData?.(' two');
      emitPtyData?.(' three');
    });
    await advanceSaveTick();

    expect(getCwd).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith('terminal-1', {
      data: {
        sessionId: 'session-1',
        scrollback: 'one two three',
        cwd: '/workspace',
      },
    });
  });

  it('skips an update when dirty output leaves the serialized snapshot unchanged', async () => {
    await renderTerminal();

    act(() => emitPtyData?.('\x07'));
    await advanceSaveTick();

    expect(getCwd).toHaveBeenCalledTimes(1);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('flushes dirty output when unmounted before the next save tick', async () => {
    await renderTerminal();
    act(() => emitPtyData?.('last chunk'));

    await act(async () => {
      root?.unmount();
      root = null;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getCwd).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('reads the final CWD before killing the PTY session', async () => {
    await renderTerminal();
    let resolveCwd: ((value: { ok: boolean; cwd: string }) => void) | undefined;
    getCwd.mockImplementationOnce(() => new Promise((resolve) => {
      resolveCwd = resolve;
    }));
    act(() => emitPtyData?.('cd subdir'));

    await act(async () => {
      root?.unmount();
      root = null;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getCwd).toHaveBeenCalledTimes(1);
    expect(kill).not.toHaveBeenCalled();
    resolveCwd?.({ ok: true, cwd: '/workspace/subdir' });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(kill).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith('terminal-1', {
      data: {
        sessionId: 'session-1',
        scrollback: 'cd subdir',
        cwd: '/workspace/subdir',
      },
    });
  });

  it('does not let an old pending cleanup kill a remounted owner of the same PTY session', async () => {
    let resolveOldCwd: ((value: { ok: boolean; cwd: string }) => void) | undefined;
    let activeLease: string | undefined;
    const terminate = vi.fn();
    getCwd
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveOldCwd = resolve;
      }))
      .mockResolvedValueOnce({ ok: true, cwd: '/workspace/new-owner' });
    spawn
      .mockImplementationOnce(async () => {
        activeLease = 'lease-old';
        return { ok: true, leaseId: activeLease };
      })
      .mockImplementationOnce(async () => {
        activeLease = 'lease-new';
        return { ok: true, reused: true, leaseId: activeLease };
      });
    kill.mockImplementation((id: string, leaseId?: string) => {
      if (leaseId === activeLease) terminate(id);
    });

    await renderTerminal();
    act(() => emitPtyData?.('old final chunk'));
    await unmountTerminal();

    expect(getCwd).toHaveBeenCalledTimes(1);
    expect(kill).not.toHaveBeenCalled();
    expect(terminate).not.toHaveBeenCalled();

    host?.remove();
    host = null;
    await renderTerminal();
    expect(spawn).toHaveBeenCalledTimes(2);

    resolveOldCwd?.({ ok: true, cwd: '/workspace/old-owner' });
    await flushPromises();

    expect(kill).toHaveBeenCalledWith('session-1', 'lease-old');
    expect(terminate).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalledWith('terminal-1', expect.objectContaining({
      data: expect.objectContaining({ scrollback: 'old final chunk' }),
    }));

    act(() => emitPtyData?.('new final chunk'));
    await unmountTerminal();
    await flushPromises();

    expect(onUpdate).toHaveBeenCalledWith('terminal-1', {
      data: {
        sessionId: 'session-1',
        scrollback: 'old final chunk\nnew final chunk',
        cwd: '/workspace/new-owner',
      },
    });
    expect(kill).toHaveBeenCalledTimes(2);
    expect(kill).toHaveBeenCalledWith('session-1', 'lease-new');
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(terminate).toHaveBeenCalledWith('session-1');
  });
});

const renderTerminal = async (): Promise<void> => {
  await mountTerminal();
  expect(emitPtyData).not.toBeNull();
};

const mountTerminal = async (): Promise<void> => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<TerminalNodeBody node={terminalNode} onUpdate={onUpdate} />);
    await Promise.resolve();
    await Promise.resolve();
  });
};

const advanceSaveTick = async (): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_000);
  });
};

const unmountTerminal = async (): Promise<void> => {
  await act(async () => {
    root?.unmount();
    root = null;
    await Promise.resolve();
    await Promise.resolve();
  });
};

const flushPromises = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
};
