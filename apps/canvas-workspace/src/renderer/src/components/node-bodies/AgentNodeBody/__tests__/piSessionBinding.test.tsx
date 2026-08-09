// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasNode } from '../../../../types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Pi has no caller-supplied session id, so a node's conversation is addressable
// only through its private `--session-dir`. These tests pin that binding end to
// end: the flag is on every launch, `--continue` reads back the SAME directory,
// and two nodes never share one — the property that makes resume safe at all.

class MockTerminal {
  static instances: MockTerminal[] = [];
  element: HTMLElement | null = null;
  readonly cols = 80;
  readonly rows = 24;
  readonly options: { fontSize?: number } = {};
  readonly buffer = {
    active: {
      length: 0,
      getLine: () => undefined,
    },
  };

  constructor() {
    MockTerminal.instances.push(this);
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
  clear(): void {}
  dispose(): void {}
  write(_data: string, callback?: () => void): void { callback?.(); }
  writeln(_data = '', callback?: () => void): void { callback?.(); }
}

class MockFitAddon {
  fit(): void {}
}

let AgentNodeBody: typeof import('../index').AgentNodeBody;
let root: Root | null = null;
let host: HTMLDivElement | null = null;
let onUpdate: ReturnType<typeof vi.fn>;
let write: ReturnType<typeof vi.fn>;

const piNode = (id: string, data: Record<string, unknown>): CanvasNode => ({
  id,
  type: 'agent',
  title: 'Agent',
  x: 0,
  y: 0,
  width: 640,
  height: 420,
  data: {
    agentType: 'pi',
    status: 'running',
    viewMode: 'running',
    sessionId: `${id}-session`,
    cwd: '/workspace',
    scrollback: '',
    ...data,
  },
});

const SESSION_DIR = /--session-dir "\$HOME\/\.pi\/agent\/sessions\/pulse-canvas\/([^"]+)"/;

beforeAll(async () => {
  vi.doMock('@xterm/xterm', () => ({ Terminal: MockTerminal }));
  vi.doMock('@xterm/addon-fit', () => ({ FitAddon: MockFitAddon }));
  vi.doMock('../../../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
  ({ AgentNodeBody } = await import('../index'));
});

beforeEach(() => {
  vi.useFakeTimers();
  MockTerminal.instances = [];
  onUpdate = vi.fn();
  write = vi.fn();
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
        spawn: vi.fn().mockResolvedValue({ ok: true, leaseId: 'lease-1' }),
        getCwd: vi.fn().mockResolvedValue({ ok: true, cwd: '/workspace' }),
        onData: vi.fn(() => () => undefined),
        onExit: vi.fn(() => () => undefined),
        write,
        resize: vi.fn(),
        kill: vi.fn(),
      },
    },
  });
});

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount();
      root = null;
      await Promise.resolve();
    });
  }
  host?.remove();
  host = null;
  Reflect.deleteProperty(window, 'canvasWorkspace');
  vi.useRealTimers();
});

afterAll(() => {
  vi.doUnmock('@xterm/xterm');
  vi.doUnmock('@xterm/addon-fit');
  vi.doUnmock('../../../../i18n');
});

describe('Pi per-node session binding', () => {
  it('scopes a first launch to a node-private session dir and persists the key', async () => {
    const node = piNode('pi-node-1', { inlinePrompt: 'review this repo' });
    await renderAgent(node);

    const command = launchCommand();
    const dir = command.match(SESSION_DIR);
    expect(dir).not.toBeNull();
    // A first launch has nothing to continue: the flag only puts the new
    // conversation somewhere a later --continue can find it.
    expect(command).not.toContain('--continue');
    expect(command).toContain("'review this repo'");

    const key = dir![1];
    expect(onUpdate).toHaveBeenCalledWith('pi-node-1', {
      data: expect.objectContaining({ piSessionKey: key }),
    });
  });

  it('resumes with --continue against the same directory the key names', async () => {
    const node = piNode('pi-node-2', { piSessionKey: 'saved-key-2222' });
    await renderAgent(node);

    const command = launchCommand();
    expect(command).toContain(
      '--session-dir "$HOME/.pi/agent/sessions/pulse-canvas/saved-key-2222" --continue',
    );
    // Resuming must not re-mint: a new key would silently orphan the
    // conversation this node has been holding.
    const mintedKeys = onUpdate.mock.calls
      .map(([, patch]) => (patch as { data?: { piSessionKey?: string } }).data?.piSessionKey)
      .filter((key): key is string => !!key);
    expect(new Set(mintedKeys)).toEqual(new Set(['saved-key-2222']));
  });

  it('gives two nodes disjoint session dirs', async () => {
    await renderAgent(piNode('pi-node-3', { inlinePrompt: 'first' }));
    const first = launchCommand().match(SESSION_DIR)![1];

    await act(async () => {
      root?.unmount();
      root = null;
      await Promise.resolve();
    });
    host?.remove();
    host = null;
    write.mockClear();

    await renderAgent(piNode('pi-node-4', { inlinePrompt: 'second' }));
    const second = launchCommand().match(SESSION_DIR)![1];

    expect(second).not.toBe(first);
  });
});

const renderAgent = async (node: CanvasNode): Promise<void> => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<AgentNodeBody node={node} onUpdate={onUpdate} />);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  // The launch command is written on the prompt-detection fallback timer.
  await act(async () => {
    vi.advanceTimersByTime(600);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

const launchCommand = (): string => {
  const launch = write.mock.calls.find((call) => String(call[1]).includes('pi '));
  expect(launch, `no pi launch written; saw ${JSON.stringify(write.mock.calls)}`).toBeDefined();
  return launch![1] as string;
};
