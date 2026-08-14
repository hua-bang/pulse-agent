import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({ appOn: vi.fn() }));
const registryMocks = vi.hoisted(() => ({
  registrations: new Map<number, {
    workspaceId: string;
    nodeId: string;
    webContentsId: number;
    surfaceKind: 'canvas-node' | 'dock-browser';
  }>(),
}));

vi.mock('electron', () => ({ app: { on: electronMocks.appOn } }));
vi.mock('../../webview/registry', () => ({
  getWebviewRegistration: (webContentsId: number) => registryMocks.registrations.get(webContentsId) ?? null,
  getWebviewSurfaceKind: (webContentsId: number) => (
    registryMocks.registrations.get(webContentsId)?.surfaceKind ?? null
  ),
}));

type InputHandler = (
  event: { preventDefault: () => void },
  input: Record<string, unknown>,
) => void;

function createGuest(type = 'webview') {
  const hostWebContents = { isDestroyed: vi.fn(() => false), send: vi.fn() };
  const contents = {
    id: 42,
    hostWebContents,
    getType: vi.fn(() => type),
    on: vi.fn(),
  };
  return { contents, hostWebContents };
}

const registerGuest = (surfaceKind: 'canvas-node' | 'dock-browser'): void => {
  registryMocks.registrations.set(42, {
    workspaceId: 'ws-1',
    nodeId: 'dock-tab-1',
    webContentsId: 42,
    surfaceKind,
  });
};

async function install() {
  const { setupWebviewShortcuts } = await import('../webview-shortcuts');
  setupWebviewShortcuts();
  const handler = electronMocks.appOn.mock.calls.find(([event]) => event === 'web-contents-created')?.[1];
  if (typeof handler !== 'function') throw new Error('web-contents-created handler not registered');
  return handler as (_event: unknown, contents: ReturnType<typeof createGuest>['contents']) => void;
}

const inputHandlerOf = (contents: ReturnType<typeof createGuest>['contents']): InputHandler =>
  contents.on.mock.calls.find(([event]) => event === 'before-input-event')?.[1] as InputHandler;

describe('webview shortcut relay', () => {
  beforeEach(() => {
    vi.resetModules();
    electronMocks.appOn.mockReset();
    registryMocks.registrations.clear();
  });

  it('relays an owned chord to the embedder and keeps it from the page', async () => {
    // The whole point: while a page has focus the host window never sees the
    // key, so without this relay ⌘W is a dead shortcut mid-browsing.
    registerGuest('dock-browser');
    const created = await install();
    const { contents, hostWebContents } = createGuest();
    created({}, contents);

    const preventDefault = vi.fn();
    inputHandlerOf(contents)({ preventDefault }, { type: 'keyDown', key: 'w', meta: true });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(hostWebContents.send).toHaveBeenCalledWith('dock:shortcut', {
      command: 'close-tab',
      source: {
        workspaceId: 'ws-1',
        nodeId: 'dock-tab-1',
        webContentsId: 42,
        surfaceKind: 'dock-browser',
      },
    });
  });

  it('relays find from a dock page to the embedder find bar', async () => {
    registerGuest('dock-browser');
    const created = await install();
    const { contents, hostWebContents } = createGuest();
    created({}, contents);

    const preventDefault = vi.fn();
    inputHandlerOf(contents)({ preventDefault }, { type: 'keyDown', key: 'f', control: true });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(hostWebContents.send).toHaveBeenCalledWith('dock:shortcut', {
      command: 'find',
      source: {
        workspaceId: 'ws-1',
        nodeId: 'dock-tab-1',
        webContentsId: 42,
        surfaceKind: 'dock-browser',
      },
    });
  });

  it('leaves browser chords inside canvas-node guests untouched', async () => {
    registerGuest('canvas-node');
    const created = await install();
    const { contents, hostWebContents } = createGuest();
    created({}, contents);

    const preventDefault = vi.fn();
    inputHandlerOf(contents)({ preventDefault }, { type: 'keyDown', key: 'w', meta: true });

    expect(preventDefault).not.toHaveBeenCalled();
    expect(hostWebContents.send).not.toHaveBeenCalled();
  });

  it('leaves keys the dock does not own to the page', async () => {
    registerGuest('dock-browser');
    const created = await install();
    const { contents, hostWebContents } = createGuest();
    created({}, contents);

    const preventDefault = vi.fn();
    const handle = inputHandlerOf(contents);
    handle({ preventDefault }, { type: 'keyDown', key: 'c', meta: true });
    handle({ preventDefault }, { type: 'keyDown', key: 'a' });

    expect(preventDefault).not.toHaveBeenCalled();
    expect(hostWebContents.send).not.toHaveBeenCalled();
  });

  it('fires once per physical press, not on the matching keyUp', async () => {
    registerGuest('dock-browser');
    const created = await install();
    const { contents, hostWebContents } = createGuest();
    created({}, contents);

    const preventDefault = vi.fn();
    const handle = inputHandlerOf(contents);
    handle({ preventDefault }, { type: 'keyDown', key: 't', meta: true });
    handle({ preventDefault }, { type: 'keyUp', key: 't', meta: true });

    expect(hostWebContents.send).toHaveBeenCalledTimes(1);
  });

  it('relays shifted bracket cycling by physical key code', async () => {
    registerGuest('dock-browser');
    const created = await install();
    const { contents, hostWebContents } = createGuest();
    created({}, contents);

    inputHandlerOf(contents)({ preventDefault: vi.fn() }, {
      type: 'keyDown',
      key: '}',
      code: 'BracketRight',
      meta: true,
      shift: true,
    });

    expect(hostWebContents.send).toHaveBeenCalledWith('dock:shortcut', {
      command: 'next-tab',
      source: expect.objectContaining({ webContentsId: 42 }),
    });
  });

  it('ignores non-webview contents', async () => {
    const created = await install();
    const { contents } = createGuest('window');
    created({}, contents);

    expect(contents.on).not.toHaveBeenCalled();
  });
});
