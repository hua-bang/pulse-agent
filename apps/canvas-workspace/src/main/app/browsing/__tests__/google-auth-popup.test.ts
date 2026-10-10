import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  BrowserWindow: vi.fn(),
}));

vi.mock('electron', () => ({
  BrowserWindow: electronMocks.BrowserWindow,
  app: { on: vi.fn() },
  session: { defaultSession: { webRequest: { onBeforeSendHeaders: vi.fn() } } },
}));

type NavigateHandler = (event: { preventDefault(): void }, url: string) => void;

function createPopupInstance() {
  return {
    webContents: {
      on: vi.fn(),
      loadURL: vi.fn(() => Promise.resolve()),
    },
    destroy: vi.fn(),
  };
}

function createOpener(currentUrl = 'https://github.com/login') {
  return {
    session: { marker: 'opener-session' },
    getURL: vi.fn(() => currentUrl),
    isDestroyed: vi.fn(() => false),
    loadURL: vi.fn(() => Promise.resolve()),
  };
}

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=github';

async function openPopup(opener = createOpener()) {
  const popup = createPopupInstance();
  electronMocks.BrowserWindow.mockImplementation(function (this: unknown) {
    return popup;
  });
  const { openGoogleAuthPopup } = await import('../google-auth-popup');
  openGoogleAuthPopup(opener as never, AUTH_URL);
  const findHandler = (event: string) =>
    popup.webContents.on.mock.calls.find(([name]) => name === event)?.[1] as NavigateHandler;
  return { popup, opener, findHandler };
}

describe('google auth popup', () => {
  beforeEach(() => {
    vi.resetModules();
    electronMocks.BrowserWindow.mockReset();
  });

  it("creates the popup on the opener's session and loads the auth URL", async () => {
    const { popup, opener } = await openPopup();

    const options = electronMocks.BrowserWindow.mock.calls[0]?.[0];
    expect(options.webPreferences.session).toBe(opener.session);
    expect(options.webPreferences.sandbox).toBe(true);
    expect(options.webPreferences.nodeIntegration).toBe(false);
    // The opener page is passed as referrer: rerouting must not make the
    // sign-in leg look like a URL typed from nowhere.
    expect(popup.webContents.loadURL).toHaveBeenCalledWith(AUTH_URL, {
      httpReferrer: 'https://github.com/login',
    });
  });

  it('hands the post-login continuation back to the opener webview and closes', async () => {
    const { popup, opener, findHandler } = await openPopup();
    const redirectHandler = findHandler('will-redirect');
    const preventDefault = vi.fn();
    const continuation = 'https://github.com/sessions/from-google?code=abc';

    redirectHandler({ preventDefault }, continuation);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(opener.loadURL).toHaveBeenCalledWith(continuation);
    expect(popup.destroy).toHaveBeenCalledOnce();
  });

  it('keeps hops between Google auth hosts inside the popup', async () => {
    const { popup, opener, findHandler } = await openPopup();
    const navigateHandler = findHandler('will-navigate');
    const preventDefault = vi.fn();

    navigateHandler({ preventDefault }, 'https://accounts.youtube.com/accounts/SetSID');

    expect(preventDefault).not.toHaveBeenCalled();
    expect(opener.loadURL).not.toHaveBeenCalled();
    expect(popup.destroy).not.toHaveBeenCalled();
  });

  it('lets non-Google side excursions browse in the popup instead of hijacking the opener', async () => {
    // "Learn more" style links from the sign-in page (support.google.com) are
    // not the OAuth continuation — they do not return to the opener's site.
    const { popup, opener, findHandler } = await openPopup();
    const navigateHandler = findHandler('will-navigate');
    const preventDefault = vi.fn();

    navigateHandler({ preventDefault }, 'https://support.google.com/accounts/answer/6010255');

    expect(preventDefault).not.toHaveBeenCalled();
    expect(opener.loadURL).not.toHaveBeenCalled();
    expect(popup.destroy).not.toHaveBeenCalled();
  });

  it('treats subdomains of the opener site as the continuation target', async () => {
    const { opener, findHandler } = await openPopup(createOpener('https://www.notion.so/login'));
    const redirectHandler = findHandler('will-redirect');
    const preventDefault = vi.fn();
    const continuation = 'https://www.notion.so/googlelogin?code=abc';

    redirectHandler({ preventDefault }, continuation);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(opener.loadURL).toHaveBeenCalledWith(continuation);
  });

  it('finishes in the popup when the opener webview is gone', async () => {
    // The session is shared, so the login still lands even without a handoff.
    const opener = createOpener();
    opener.isDestroyed.mockReturnValue(true);
    const { popup, findHandler } = await openPopup(opener);
    const redirectHandler = findHandler('will-redirect');
    const preventDefault = vi.fn();

    redirectHandler({ preventDefault }, 'https://github.com/sessions/from-google?code=abc');

    expect(preventDefault).not.toHaveBeenCalled();
    expect(opener.loadURL).not.toHaveBeenCalled();
    expect(popup.destroy).not.toHaveBeenCalled();
  });
});
