// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasNode } from '../../types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class MockTerminal {
  static instances: MockTerminal[] = [];

  private content = '';
  disposed = false;
  readonly cols = 80;
  readonly rows = 24;
  readonly options: { fontSize?: number } = {};
  readonly buffer: {
    active: {
      readonly length: number;
      getLine: (index: number) => { translateToString: () => string } | undefined;
    };
  };
  element: HTMLElement | null = null;

  constructor() {
    MockTerminal.instances.push(this);
    const terminal = this;
    this.buffer = {
      active: {
        get length() { return terminal.content ? terminal.content.split('\n').length : 0; },
        getLine: (index) => {
          const line = terminal.content.split('\n')[index];
          return line === undefined ? undefined : { translateToString: () => line };
        },
      },
    };
  }

  loadAddon(): void {}
  open(container: HTMLElement): void {
    this.element = document.createElement('div');
    container.appendChild(this.element);
  }
  attachCustomKeyEventHandler(): void {}
  onData(): { dispose: () => void } { return { dispose: () => undefined }; }
  onResize(): { dispose: () => void } { return { dispose: () => undefined }; }
  refresh(): void {}
  clear(): void { this.content = ''; }
  dispose(): void { this.disposed = true; }
  write(data: string, callback?: () => void): void {
    queueMicrotask(() => {
      this.content += data.replace(/\r\n/g, '\n');
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

let AgentNodeBody: typeof import('./index').AgentNodeBody;
let root: Root | null = null;
let host: HTMLDivElement | null = null;
let emitPtyData: ((data: string) => void) | null = null;
let onUpdate: ReturnType<typeof vi.fn>;
let getCwd: ReturnType<typeof vi.fn>;
let kill: ReturnType<typeof vi.fn>;
let spawn: ReturnType<typeof vi.fn>;
let write: ReturnType<typeof vi.fn>;
let onData = vi.fn((_sessionId: string, _callback: (data: string) => void) => () => undefined);
let onExit = vi.fn(() => () => undefined);

// This branch persists terminal scrollback churn without occupying an undo
// slot (see useNodes.test.tsx); every persister write carries this option.
const NO_HISTORY = { history: false };

const agentNode: CanvasNode = {
  id: 'agent-1',
  type: 'agent',
  title: 'Agent',
  x: 0,
  y: 0,
  width: 640,
  height: 420,
  data: {
    agentType: 'claude-code',
    status: 'running',
    viewMode: 'running',
    sessionId: 'agent-session-1',
    cliSessionId: 'cli-session-1',
    cwd: '/workspace',
    inlinePrompt: 'continue',
    scrollback: '',
  },
};

beforeAll(async () => {
  vi.doMock('@xterm/xterm', () => ({ Terminal: MockTerminal }));
  vi.doMock('@xterm/addon-fit', () => ({ FitAddon: MockFitAddon }));
  vi.doMock('../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
  ({ AgentNodeBody } = await import('./index'));
});

beforeEach(() => {
  vi.useFakeTimers();
  MockTerminal.instances = [];
  emitPtyData = null;
  onUpdate = vi.fn();
  getCwd = vi.fn().mockResolvedValue({ ok: true, cwd: '/workspace' });
  kill = vi.fn();
  spawn = vi.fn().mockResolvedValue({ ok: true, leaseId: 'lease-default' });
  write = vi.fn();
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
        write,
        resize: vi.fn(),
        kill,
      },
    },
  });
});

afterEach(async () => {
  if (root) await unmountAgent();
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

describe('AgentNodeBody PTY ownership', () => {
  it('cancels a mirror whose initial live-session probe resolves after unmount', async () => {
    const lateCwd = createDeferred<{ ok: true; cwd: string }>();
    getCwd.mockReturnValueOnce(lateCwd.promise);
    const mirrorNode: CanvasNode = {
      ...agentNode,
      id: 'mirror-agent-1',
      data: { ...agentNode.data, sessionId: 'mirror-session-1' },
    };
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(<AgentNodeBody node={mirrorNode} terminalMode="mirror" onUpdate={onUpdate} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getCwd).toHaveBeenCalledWith('mirror-session-1');

    await unmountAgent();
    lateCwd.resolve({ ok: true, cwd: '/workspace' });
    await flushPromises();

    expect(onData).not.toHaveBeenCalled();
    expect(onExit).not.toHaveBeenCalled();
    expect(MockTerminal.instances[0]?.disposed).toBe(true);
  });

  it('removes provisional listeners and reclaims a spawn that resolves after unmount', async () => {
    const lateSpawn = createDeferred<{ ok: true; leaseId: string }>();
    const removePrompt = vi.fn();
    const removeExit = vi.fn();
    spawn.mockReturnValueOnce(lateSpawn.promise);
    onData.mockImplementationOnce((_sessionId: string, callback: (data: string) => void) => {
      emitPtyData = callback;
      return removePrompt;
    });
    onExit.mockReturnValueOnce(removeExit);

    await renderAgent();
    await unmountAgent();

    expect(removePrompt).toHaveBeenCalledTimes(1);
    expect(removeExit).toHaveBeenCalledTimes(1);
    expect(kill).not.toHaveBeenCalled();
    onUpdate.mockClear();

    lateSpawn.resolve({ ok: true, leaseId: 'agent-lease-late' });
    await flushPromises();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });

    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith('agent-session-1', 'agent-lease-late');
    expect(write).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalledWith('agent-1', expect.objectContaining({
      data: expect.objectContaining({ status: 'running' }),
    }));
  });

  it('does not publish an error when spawn failure resolves after unmount', async () => {
    const lateSpawn = createDeferred<{ ok: false; error: string }>();
    spawn.mockReturnValueOnce(lateSpawn.promise);

    await renderAgent();
    await unmountAgent();
    onUpdate.mockClear();
    lateSpawn.resolve({ ok: false, error: 'late failure' });
    await flushPromises();

    expect(kill).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalledWith('agent-1', expect.objectContaining({
      data: expect.objectContaining({ status: 'error' }),
    }));
  });

  it('hands final output to a remounted owner without letting stale cleanup kill or overwrite it', async () => {
    let resolveOldCwd: ((value: { ok: boolean; cwd: string }) => void) | undefined;
    let activeLease: string | undefined;
    const terminate = vi.fn();
    getCwd
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOldCwd = resolve; }))
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

    await renderAgent();
    act(() => emitPtyData?.('old agent chunk'));
    await unmountAgent();
    expect(getCwd).toHaveBeenCalledTimes(1);
    expect(kill).not.toHaveBeenCalled();

    host?.remove();
    host = null;
    await renderAgent();
    resolveOldCwd?.({ ok: true, cwd: '/workspace/old-owner' });
    await flushPromises();

    expect(kill).toHaveBeenCalledWith('agent-session-1', 'lease-old');
    expect(terminate).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalledWith('agent-1', expect.objectContaining({
      data: expect.objectContaining({ scrollback: 'old agent chunk' }),
    }), NO_HISTORY);

    act(() => emitPtyData?.('new agent chunk'));
    await unmountAgent();
    await flushPromises();

    expect(onUpdate).toHaveBeenCalledWith('agent-1', {
      data: expect.objectContaining({
        scrollback: 'old agent chunk\nnew agent chunk',
        cwd: '/workspace/new-owner',
      }),
    }, NO_HISTORY);
    expect(kill).toHaveBeenCalledWith('agent-session-1', 'lease-new');
    expect(terminate).toHaveBeenCalledTimes(1);
  });
});

const renderAgent = async (): Promise<void> => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<AgentNodeBody node={agentNode} onUpdate={onUpdate} />);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(spawn).toHaveBeenCalled();
  expect(emitPtyData).not.toBeNull();
};

const unmountAgent = async (): Promise<void> => {
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
