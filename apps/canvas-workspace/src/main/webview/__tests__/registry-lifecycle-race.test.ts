import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  contents: new Map<number, unknown>(),
  capture: vi.fn(),
  execute: vi.fn(),
  frozenSince: vi.fn((): number | undefined => undefined),
  remember: vi.fn(),
  forget: vi.fn(),
  setLifecycle: vi.fn(async (_wc: unknown, state: 'active' | 'frozen') => ({ ok: true, state })),
}));

vi.mock('electron', () => ({
  app: { getAppMetrics: () => [] },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler);
    },
  },
  webContents: { fromId: (id: number) => mocks.contents.get(id) ?? null },
}));

vi.mock('../snapshot', () => ({ captureBoundedSnapshot: mocks.capture }));
vi.mock('../discard-monitor', () => ({
  rememberFreezeSnapshot: mocks.remember,
  forgetFreezeSnapshot: mocks.forget,
}));
vi.mock('../freeze-probe', () => ({
  probeFreezeState: vi.fn(async () => ({
    scrollX: 0,
    scrollY: 0,
    dirty: false,
    hasEditable: false,
    nonTrivialDom: true,
  })),
  buildFreezeRecord: vi.fn(() => ({
    url: 'https://example.com/',
    scrollX: 0,
    scrollY: 0,
    dirty: false,
    reloadable: true,
  })),
}));
vi.mock('../lifecycle', () => ({
  getFrozenSince: mocks.frozenSince,
  getWebviewFreezeExemption: vi.fn(() => null),
  setWebviewLifecycle: mocks.setLifecycle,
}));
vi.mock('../shortcut-forwarding', () => ({ attachShortcutForwarding: vi.fn() }));

import { getNodeRenderedText, setupWebviewRegistryIpc } from '../registry';

const invoke = <T>(channel: string, payload: unknown): T => {
  const handler = mocks.handlers.get(channel);
  if (!handler) throw new Error(`Missing ${channel} handler`);
  return handler({}, payload) as T;
};

const identity = (nodeId: string) => ({
  workspaceId: 'ws',
  nodeId,
  webContentsId: 7,
});

let resolveCapture: (value: string | undefined) => void;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.frozenSince.mockReturnValue(undefined);
  mocks.setLifecycle.mockImplementation(async (_wc, state) => ({ ok: true, state }));
  mocks.handlers.clear();
  const wc = {
    id: 7,
    isDestroyed: () => false,
    once: vi.fn(),
    getURL: () => 'https://example.com/',
    executeJavaScript: mocks.execute,
    setFrameRate: vi.fn(),
  };
  mocks.contents.clear();
  mocks.contents.set(7, wc);
  mocks.capture.mockReturnValue(new Promise((resolve) => { resolveCapture = resolve; }));
  setupWebviewRegistryIpc();
  for (const nodeId of ['node-a', 'node-b']) {
    invoke('iframe:unregister-webview', identity(nodeId));
  }
});

const register = (nodeId: string): void => {
  invoke('iframe:register-webview', { ...identity(nodeId), surfaceKind: 'canvas-node' });
};

describe('webview lifecycle request races', () => {
  it('lets a newer active intent cancel an in-flight freeze for the same guest', async () => {
    register('node-a');
    const freeze = invoke<Promise<unknown>>('iframe:set-lifecycle', {
      ...identity('node-a'),
      state: 'frozen',
    });
    await Promise.resolve();

    await invoke<Promise<unknown>>('iframe:set-lifecycle', {
      ...identity('node-a'),
      state: 'active',
    });
    resolveCapture(undefined);
    await expect(freeze).resolves.toMatchObject({ ok: false, skipped: 'destroyed' });

    expect(mocks.setLifecycle).toHaveBeenCalledTimes(1);
    expect(mocks.setLifecycle.mock.calls[0]?.[1]).toBe('active');
    expect(mocks.remember).not.toHaveBeenCalled();
  });

  it('drops freeze preparation when the WebContents is rebound to another identity', async () => {
    register('node-a');
    const freeze = invoke<Promise<unknown>>('iframe:set-lifecycle', {
      ...identity('node-a'),
      state: 'frozen',
    });
    await Promise.resolve();

    invoke('iframe:unregister-webview', identity('node-a'));
    register('node-b');
    resolveCapture(undefined);
    await expect(freeze).resolves.toMatchObject({ ok: false, skipped: 'destroyed' });

    expect(mocks.setLifecycle).not.toHaveBeenCalled();
    expect(mocks.remember).not.toHaveBeenCalled();
  });

  it('makes a newer active intent win when freeze is already inside its CDP transition', async () => {
    mocks.capture.mockResolvedValue(undefined);
    let markFreezeStarted = (): void => {};
    const freezeStarted = new Promise<void>((resolve) => { markFreezeStarted = resolve; });
    let resolveFreeze = (_result: { ok: true; state: 'frozen' }): void => {};
    const freezeTransition = new Promise<{ ok: true; state: 'frozen' }>((resolve) => {
      resolveFreeze = resolve;
    });
    mocks.setLifecycle.mockImplementation(async (_wc, state) => {
      if (state === 'frozen') {
        markFreezeStarted();
        return freezeTransition;
      }
      return { ok: true, state };
    });
    register('node-a');

    const freeze = invoke<Promise<unknown>>('iframe:set-lifecycle', {
      ...identity('node-a'),
      state: 'frozen',
    });
    await freezeStarted;
    const active = invoke<Promise<unknown>>('iframe:set-lifecycle', {
      ...identity('node-a'),
      state: 'active',
    });
    resolveFreeze({ ok: true, state: 'frozen' });

    await expect(freeze).resolves.toMatchObject({ ok: false, skipped: 'destroyed' });
    await expect(active).resolves.toMatchObject({ ok: true, state: 'active' });
    expect(mocks.setLifecycle.mock.calls.map((call) => call[1]))
      .toEqual(['frozen', 'active', 'active']);
    expect(mocks.forget).toHaveBeenCalled();
  });

  it('does not re-freeze after the user activates a guest during temporary DOM extraction', async () => {
    mocks.frozenSince.mockReturnValue(123);
    let resolveRead = (_value: unknown): void => {};
    mocks.execute.mockReturnValue(new Promise((resolve) => { resolveRead = resolve; }));
    register('node-a');

    const read = getNodeRenderedText('ws', 'node-a');
    await vi.waitFor(() => {
      expect(mocks.setLifecycle.mock.calls.map((call) => call[1])).toEqual(['active']);
    });
    await invoke<Promise<unknown>>('iframe:set-lifecycle', {
      ...identity('node-a'),
      state: 'active',
    });
    resolveRead({
      ok: true,
      title: 'Example',
      text: 'live text',
      url: 'https://example.com/',
    });

    await expect(read).resolves.toContain('live text');
    expect(mocks.setLifecycle.mock.calls.map((call) => call[1]))
      .toEqual(['active', 'active']);
  });

  it('restores a frozen guest after an uncontested temporary DOM extraction', async () => {
    mocks.frozenSince.mockReturnValue(123);
    mocks.execute.mockResolvedValue({
      ok: true,
      title: 'Example',
      text: 'background text',
      url: 'https://example.com/',
    });
    register('node-a');

    await expect(getNodeRenderedText('ws', 'node-a')).resolves.toContain('background text');
    expect(mocks.setLifecycle.mock.calls.map((call) => call[1]))
      .toEqual(['active', 'frozen']);
  });
});
