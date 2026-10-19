import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  appOn: vi.fn(),
  ipcOn: vi.fn(),
  fromId: vi.fn(),
  getLocale: vi.fn(() => 'en-US'),
  fromWebContents: vi.fn(() => ({ id: 'window' })),
  showMessageBoxSync: vi.fn(() => 0),
}));

vi.mock('electron', () => ({
  app: { on: electronMocks.appOn, getLocale: electronMocks.getLocale },
  BrowserWindow: { fromWebContents: electronMocks.fromWebContents },
  dialog: { showMessageBoxSync: electronMocks.showMessageBoxSync },
  ipcMain: { on: electronMocks.ipcOn },
  webContents: { fromId: electronMocks.fromId },
}));

type UnloadHandler = (event: { preventDefault(): void }) => void;

const attach = async (type: string) => {
  const { setupUnloadPrompt } = await import('../unload-prompt');
  setupUnloadPrompt();
  const created = electronMocks.appOn.mock.calls.find(([name]) => name === 'web-contents-created')?.[1];
  const host = { isDestroyed: () => false, send: vi.fn() };
  const contents = {
    id: 7,
    getType: () => type,
    hostWebContents: host,
    on: vi.fn(),
    once: vi.fn(),
  };
  electronMocks.fromId.mockImplementation((id: number) => (id === 7 ? contents : undefined));
  created({}, contents);
  const handler = contents.on.mock.calls.find(([name]) => name === 'will-prevent-unload')?.[1] as
    UnloadHandler | undefined;
  const sendFrom = (sender: unknown, channel: string) => {
    const listener = electronMocks.ipcOn.mock.calls.find(([name]) => name === channel)?.[1];
    listener({ sender }, { webContentsId: 7 });
  };
  return { handler, host, sendFrom };
};

describe('unload prompt', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('hands an announced, vetoed action back to the host surface', async () => {
    const { handler, host, sendFrom } = await attach('webview');
    sendFrom(host, 'iframe:expect-unload');
    const event = { preventDefault: vi.fn() };
    handler!(event);
    expect(host.send).toHaveBeenCalledWith('iframe:unload-blocked', { webContentsId: 7 });
    expect(electronMocks.showMessageBoxSync).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('lets the replayed action through once the user chose Leave', async () => {
    const { handler, host, sendFrom } = await attach('webview');
    sendFrom(host, 'iframe:allow-unload');
    const event = { preventDefault: vi.fn() };
    handler!(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(electronMocks.showMessageBoxSync).not.toHaveBeenCalled();
  });

  it('ignores marks from a window that does not host the guest', async () => {
    const { handler, host, sendFrom } = await attach('webview');
    sendFrom({ other: true }, 'iframe:allow-unload');
    handler!({ preventDefault: vi.fn() });
    expect(host.send).not.toHaveBeenCalled();
    expect(electronMocks.showMessageBoxSync).toHaveBeenCalledOnce();
  });

  it('asks natively when the page started the navigation itself', async () => {
    const { handler } = await attach('webview');
    const event = { preventDefault: vi.fn() };
    handler!(event);
    expect(electronMocks.showMessageBoxSync).toHaveBeenCalledWith(
      { id: 'window' },
      expect.objectContaining({ buttons: ['Leave', 'Stay'], defaultId: 1, message: 'Leave site?' }),
    );
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it('keeps the page when the user chooses Stay in the native dialog', async () => {
    electronMocks.showMessageBoxSync.mockReturnValueOnce(1);
    const { handler } = await attach('webview');
    const event = { preventDefault: vi.fn() };
    handler!(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('leaves the app window itself alone', async () => {
    expect((await attach('window')).handler).toBeUndefined();
  });
});
