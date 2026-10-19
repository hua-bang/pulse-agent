import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  appOn: vi.fn(),
  getLocale: vi.fn(() => 'en-US'),
  fromWebContents: vi.fn(() => ({ id: 'window' })),
  showMessageBoxSync: vi.fn(() => 0),
}));

vi.mock('electron', () => ({
  app: { on: electronMocks.appOn, getLocale: electronMocks.getLocale },
  BrowserWindow: { fromWebContents: electronMocks.fromWebContents },
  dialog: { showMessageBoxSync: electronMocks.showMessageBoxSync },
}));

type UnloadHandler = (event: { preventDefault(): void }) => void;

const attach = async (type: string) => {
  const { setupUnloadPrompt } = await import('../unload-prompt');
  setupUnloadPrompt();
  const created = electronMocks.appOn.mock.calls.find(([name]) => name === 'web-contents-created')?.[1];
  const contents = {
    getType: () => type,
    hostWebContents: { isDestroyed: () => false },
    on: vi.fn(),
  };
  created({}, contents);
  return contents.on.mock.calls.find(([name]) => name === 'will-prevent-unload')?.[1] as UnloadHandler | undefined;
};

describe('unload prompt', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('lets a webview page unload when the user chooses Leave', async () => {
    const handler = await attach('webview');
    const event = { preventDefault: vi.fn() };
    handler!(event);
    expect(electronMocks.showMessageBoxSync).toHaveBeenCalledWith(
      { id: 'window' },
      expect.objectContaining({ buttons: ['Leave', 'Stay'], message: 'Leave site?' }),
    );
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it('keeps the page when the user chooses Stay', async () => {
    electronMocks.showMessageBoxSync.mockReturnValueOnce(1);
    const handler = await attach('webview');
    const event = { preventDefault: vi.fn() };
    handler!(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('leaves the app window itself alone', async () => {
    expect(await attach('window')).toBeUndefined();
  });
});
