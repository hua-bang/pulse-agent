import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  appOn: vi.fn(),
  openExternal: vi.fn(),
  openGoogleAuthPopup: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    on: electronMocks.appOn,
  },
  shell: {
    openExternal: electronMocks.openExternal,
  },
}));

vi.mock('../google-auth-popup', () => ({
  openGoogleAuthPopup: electronMocks.openGoogleAuthPopup,
}));

type WindowOpenHandler = (details: { url: string; disposition: string }) => { action: string };
type NavigateHandler = (event: { preventDefault(): void }, url: string) => void;

function createContents(currentUrl = 'https://www.figma.com/files/recent') {
  const hostWebContents = {
    isDestroyed: vi.fn(() => false),
    send: vi.fn(),
  };
  const contents = {
    hostWebContents,
    setWindowOpenHandler: vi.fn(),
    getType: vi.fn(() => 'webview'),
    getURL: vi.fn(() => currentUrl),
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
    electronMocks.openGoogleAuthPopup.mockReset();
    delete process.env.PULSE_GOOGLE_AUTH_IDENTITY;
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

  it('opens VS Code protocol links through the OS handler instead of a BrowserWindow', async () => {
    const createdHandler = await installPolicy();
    const { contents } = createContents();
    createdHandler({}, contents);

    const windowOpenHandler = contents.setWindowOpenHandler.mock.calls[0]?.[0] as WindowOpenHandler;
    const url = 'vscode://file/root/project/src/App.tsx:12:3';
    const result = windowOpenHandler({ url, disposition: 'new-window' });

    expect(result).toEqual({ action: 'deny' });
    expect(electronMocks.openExternal).toHaveBeenCalledWith(url);
  });

  it('opens Google auth target=_blank links in an in-app window, not the system browser', async () => {
    // A login link with target=_blank arrives as disposition foreground-tab.
    // The system browser can't share its session back to the app, so the
    // cookie from a login completed there would be stranded — these must open
    // in-app like popups do.
    const createdHandler = await installPolicy();
    const { contents } = createContents();
    createdHandler({}, contents);

    const windowOpenHandler = contents.setWindowOpenHandler.mock.calls[0]?.[0] as WindowOpenHandler;
    const url = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=notion';
    const result = windowOpenHandler({ url, disposition: 'foreground-tab' });

    expect(result).toEqual({ action: 'allow' });
    expect(electronMocks.openExternal).not.toHaveBeenCalled();
  });

  it('keeps in-place Google auth entry navigations in the webview under the default chrome identity', async () => {
    // Default (honest chrome) identity matches what Codex presents while
    // passing /v3/signin in-place, so the entry leg stays in the webview —
    // no popup, no system browser, no drawer.
    const createdHandler = await installPolicy();
    const { contents, hostWebContents } = createContents('https://github.com/login');
    createdHandler({}, contents);

    const navigateHandler = contents.on.mock.calls.find(([event]) => event === 'will-navigate')?.[1] as NavigateHandler;
    const preventDefault = vi.fn();
    navigateHandler({ preventDefault }, 'https://accounts.google.com/signin/v2/identifier');

    expect(electronMocks.openGoogleAuthPopup).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
    expect(electronMocks.openExternal).not.toHaveBeenCalled();
    expect(hostWebContents.send).not.toHaveBeenCalled();
  });

  it('reroutes in-place Google auth entry navigations into a popup in firefox fallback mode', async () => {
    // Redirect-mode "Sign in with Google" navigates the webview itself to
    // accounts.google.com. In the firefox fallback strategy the entry leg
    // leaves the webview for a real top-level popup on the same session —
    // never the system browser (that would strand the login cookie).
    process.env.PULSE_GOOGLE_AUTH_IDENTITY = 'firefox';
    const createdHandler = await installPolicy();
    const { contents, hostWebContents } = createContents('https://github.com/login');
    createdHandler({}, contents);

    const navigateHandler = contents.on.mock.calls.find(([event]) => event === 'will-navigate')?.[1] as NavigateHandler;
    const preventDefault = vi.fn();
    const url = 'https://accounts.google.com/signin/v2/identifier';
    navigateHandler({ preventDefault }, url);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(electronMocks.openGoogleAuthPopup).toHaveBeenCalledWith(contents, url);
    expect(electronMocks.openExternal).not.toHaveBeenCalled();
    expect(hostWebContents.send).not.toHaveBeenCalled();
  });

  it('reroutes server-side redirects into Google auth to the popup in firefox fallback mode', async () => {
    // The common OAuth entry is a same-origin navigation
    // (github.com/login → github.com/sessions/…) that 302s into
    // accounts.google.com. Cross-origin will-navigate never fires for it;
    // only will-redirect carries the Google URL.
    process.env.PULSE_GOOGLE_AUTH_IDENTITY = 'firefox';
    const createdHandler = await installPolicy();
    const { contents } = createContents('https://github.com/login');
    createdHandler({}, contents);

    const redirectHandler = contents.on.mock.calls.find(([event]) => event === 'will-redirect')?.[1] as NavigateHandler;
    const preventDefault = vi.fn();
    const url = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=github';
    redirectHandler({ preventDefault }, url);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(electronMocks.openGoogleAuthPopup).toHaveBeenCalledWith(contents, url);
  });

  it('keeps hops between Google auth hosts inside the surface already on Google', async () => {
    // accounts.google.com ↔ accounts.youtube.com is part of the sign-in
    // cookie handshake; a surface already on a Google host must not spawn
    // another popup.
    const createdHandler = await installPolicy();
    const { contents, hostWebContents } = createContents('https://accounts.google.com/signin/v2/identifier');
    createdHandler({}, contents);

    const navigateHandler = contents.on.mock.calls.find(([event]) => event === 'will-navigate')?.[1] as NavigateHandler;
    const preventDefault = vi.fn();
    navigateHandler({ preventDefault }, 'https://accounts.youtube.com/accounts/SetSID');

    expect(preventDefault).not.toHaveBeenCalled();
    expect(electronMocks.openGoogleAuthPopup).not.toHaveBeenCalled();
    expect(hostWebContents.send).not.toHaveBeenCalled();
  });

  it('keeps the post-login continuation leaving accounts.google.com inside the webview', async () => {
    const createdHandler = await installPolicy();
    const { contents, hostWebContents } = createContents('https://accounts.google.com/signin/oauth/consent');
    createdHandler({}, contents);

    const navigateHandler = contents.on.mock.calls.find(([event]) => event === 'will-navigate')?.[1] as NavigateHandler;
    const preventDefault = vi.fn();
    const url = 'https://www.notion.so/googlelogin?code=abc';
    navigateHandler({ preventDefault }, url);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(electronMocks.openExternal).not.toHaveBeenCalled();
    expect(hostWebContents.send).not.toHaveBeenCalled();
  });

  it('does not treat lookalike Google auth hosts as auth navigations', async () => {
    const createdHandler = await installPolicy();
    const { contents, hostWebContents } = createContents();
    createdHandler({}, contents);

    const navigateHandler = contents.on.mock.calls.find(([event]) => event === 'will-navigate')?.[1] as NavigateHandler;
    const preventDefault = vi.fn();
    const url = 'https://accounts.google.com.evil.example/signin';
    navigateHandler({ preventDefault }, url);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(hostWebContents.send).toHaveBeenCalledWith('link:open', { url });
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
