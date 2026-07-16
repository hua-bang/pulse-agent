import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  appOn: vi.fn(),
  openExternal: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    on: electronMocks.appOn,
  },
  shell: {
    openExternal: electronMocks.openExternal,
  },
}));

type WindowOpenHandler = (details: { url: string; disposition: string }) => { action: string };
type NavigateHandler = (event: { preventDefault(): void }, url: string) => void;

function createContents() {
  const hostWebContents = {
    isDestroyed: vi.fn(() => false),
    send: vi.fn(),
  };
  const contents = {
    hostWebContents,
    setWindowOpenHandler: vi.fn(),
    getType: vi.fn(() => 'webview'),
    getURL: vi.fn(() => 'https://www.figma.com/files/recent'),
    on: vi.fn(),
  };
  return { contents, hostWebContents };
}

async function installPolicy() {
  const { setupLinkPolicy } = await import('../link-policy');
  setupLinkPolicy();
  const createdHandler = electronMocks.appOn.mock.calls.find(([event]) => event === 'web-contents-created')?.[1];
  if (typeof createdHandler !== 'function') throw new Error('web-contents-created handler not registered');
  return createdHandler as (_event: unknown, contents: ReturnType<typeof createContents>['contents']) => void;
}

describe('link policy', () => {
  beforeEach(() => {
    vi.resetModules();
    electronMocks.appOn.mockReset();
    electronMocks.openExternal.mockReset();
    electronMocks.openExternal.mockResolvedValue(undefined);
  });

  it('opens Google auth popups in an in-app window so the session flows back', async () => {
    // Google's embedded-browser policy blocks <webview> sign-in, and the system
    // browser can't share its session back to the app. A real BrowserWindow
    // popup (action: allow) inherits the opener's session, giving the login
    // round-trip a chance to complete in-app — so a new-window auth popup must
    // NOT be pushed to the system browser.
    const createdHandler = await installPolicy();
    const { contents } = createContents();
    createdHandler({}, contents);

    const windowOpenHandler = contents.setWindowOpenHandler.mock.calls[0]?.[0] as WindowOpenHandler;
    const url = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=figma';
    const result = windowOpenHandler({ url, disposition: 'new-window' });

    expect(result).toEqual({ action: 'allow' });
    expect(electronMocks.openExternal).not.toHaveBeenCalled();
  });

  it('opens Google auth navigations in the system browser', async () => {
    const createdHandler = await installPolicy();
    const { contents, hostWebContents } = createContents();
    createdHandler({}, contents);

    const navigateHandler = contents.on.mock.calls.find(([event]) => event === 'will-navigate')?.[1] as NavigateHandler;
    const preventDefault = vi.fn();
    const url = 'https://accounts.google.com/signin/v2/identifier';
    navigateHandler({ preventDefault }, url);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(electronMocks.openExternal).toHaveBeenCalledWith(url);
    expect(hostWebContents.send).not.toHaveBeenCalled();
  });

  it('keeps Figma SAML callbacks inside the webview', async () => {
    const createdHandler = await installPolicy();
    const { contents, hostWebContents } = createContents();
    createdHandler({}, contents);

    const navigateHandler = contents.on.mock.calls.find(([event]) => event === 'will-navigate')?.[1] as NavigateHandler;
    const preventDefault = vi.fn();
    const url = 'https://www.figma.com/saml/844724983289219349/consume';
    navigateHandler({ preventDefault }, url);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(electronMocks.openExternal).not.toHaveBeenCalled();
    expect(hostWebContents.send).not.toHaveBeenCalled();
  });

  it('keeps Figma to enterprise SSO navigations inside the webview', async () => {
    const createdHandler = await installPolicy();
    const { contents, hostWebContents } = createContents();
    createdHandler({}, contents);

    const navigateHandler = contents.on.mock.calls.find(([event]) => event === 'will-navigate')?.[1] as NavigateHandler;
    const preventDefault = vi.fn();
    const url = 'https://sso.bytedance.com/idp/login/process?rid=abc';
    navigateHandler({ preventDefault }, url);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(electronMocks.openExternal).not.toHaveBeenCalled();
    expect(hostWebContents.send).not.toHaveBeenCalled();
  });
});
