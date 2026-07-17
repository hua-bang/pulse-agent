import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  appOn: vi.fn(),
  onBeforeSendHeaders: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    on: electronMocks.appOn,
  },
  session: {
    defaultSession: {
      webRequest: {
        onBeforeSendHeaders: electronMocks.onBeforeSendHeaders,
      },
    },
  },
}));

type WillNavigateHandler = (event: unknown, url: string) => void;
type DidStartNavigationHandler = (
  event: unknown,
  url: string,
  isInPage: boolean,
  isMainFrame: boolean,
) => void;

function createContents(userAgent = 'SpoofedChrome/140') {
  let currentUserAgent = userAgent;
  return {
    on: vi.fn(),
    debugger: {
      isAttached: vi.fn(() => false),
      attach: vi.fn(),
      sendCommand: vi.fn(() => Promise.resolve()),
    },
    getUserAgent: vi.fn(() => currentUserAgent),
    setUserAgent: vi.fn((next: string) => {
      currentUserAgent = next;
    }),
  };
}

async function installCompat() {
  const { setupGoogleAuthCompat } = await import('../google-auth');
  setupGoogleAuthCompat();
  const createdHandler = electronMocks.appOn.mock.calls.find(
    ([event]) => event === 'web-contents-created',
  )?.[1];
  if (typeof createdHandler !== 'function') throw new Error('web-contents-created handler not registered');
  return createdHandler as (_event: unknown, contents: ReturnType<typeof createContents>) => void;
}

describe('isGoogleAuthUrl', () => {
  it('matches only the exact Google auth hosts over https', async () => {
    const { isGoogleAuthUrl } = await import('../google-auth');
    expect(isGoogleAuthUrl('https://accounts.google.com/signin')).toBe(true);
    expect(isGoogleAuthUrl('https://accounts.youtube.com/accounts/SetSID')).toBe(true);
    // Lookalike/suffix hosts must never pass — this check loosens link policy.
    expect(isGoogleAuthUrl('https://accounts.google.com.evil.example/signin')).toBe(false);
    expect(isGoogleAuthUrl('https://evilaccounts.google.com.example/')).toBe(false);
    expect(isGoogleAuthUrl('http://accounts.google.com/signin')).toBe(false);
    expect(isGoogleAuthUrl('https://www.google.com/')).toBe(false);
    expect(isGoogleAuthUrl('not a url')).toBe(false);
  });
});

describe('rewriteGoogleAuthHeaders', () => {
  it('replaces the UA with a Firefox identity and strips client-hint headers', async () => {
    const { rewriteGoogleAuthHeaders } = await import('../google-auth');
    const rewritten = rewriteGoogleAuthHeaders({
      'user-agent': 'Mozilla/5.0 Chrome/140.0.0.0',
      'Sec-CH-UA': '"Chromium";v="124"',
      'sec-ch-ua-platform': '"macOS"',
      Accept: 'text/html',
    });

    expect(rewritten['User-Agent']).toMatch(/Gecko\/20100101 Firefox\/\d+/);
    expect(rewritten['User-Agent']).not.toContain('Chrome');
    expect(rewritten.Accept).toBe('text/html');
    expect(Object.keys(rewritten).some((k) => k.toLowerCase().startsWith('sec-ch-'))).toBe(false);
    expect(Object.keys(rewritten).filter((k) => k.toLowerCase() === 'user-agent')).toEqual(['User-Agent']);
  });
});

describe('googleAuthUserAgent', () => {
  it('builds a platform-appropriate Firefox UA', async () => {
    const { googleAuthUserAgent } = await import('../google-auth');
    expect(googleAuthUserAgent('darwin')).toContain('Macintosh');
    expect(googleAuthUserAgent('win32')).toContain('Windows NT 10.0');
    expect(googleAuthUserAgent('linux')).toContain('X11; Linux x86_64');
    expect(googleAuthUserAgent('linux')).not.toContain('Electron');
  });
});

describe('setupGoogleAuthCompat', () => {
  beforeEach(() => {
    vi.resetModules();
    electronMocks.appOn.mockReset();
    electronMocks.onBeforeSendHeaders.mockReset();
  });

  it('switches to a Firefox UA on Google auth hosts and restores it after leaving', async () => {
    const createdHandler = await installCompat();
    const contents = createContents();
    createdHandler({}, contents);

    const willNavigate = contents.on.mock.calls.find(
      ([event]) => event === 'will-navigate',
    )?.[1] as WillNavigateHandler;

    willNavigate({}, 'https://accounts.google.com/signin/v2/identifier');
    expect(contents.setUserAgent).toHaveBeenLastCalledWith(
      expect.stringContaining('Firefox/'),
    );

    // Same-host navigation must not re-save the (already overridden) UA.
    willNavigate({}, 'https://accounts.google.com/signin/challenge');
    expect(contents.setUserAgent).toHaveBeenCalledTimes(1);

    // Leaving Google restores the original UA, not the Firefox one.
    willNavigate({}, 'https://www.notion.so/googlelogin?code=abc');
    expect(contents.setUserAgent).toHaveBeenLastCalledWith('SpoofedChrome/140');
  });

  it('injects a userAgentData-hiding script on Google auth hosts (main world, doc-start)', async () => {
    const createdHandler = await installCompat();
    const contents = createContents();
    createdHandler({}, contents);

    const willNavigate = contents.on.mock.calls.find(
      ([event]) => event === 'will-navigate',
    )?.[1] as WillNavigateHandler;

    // A non-Google leg must not attach the debugger.
    willNavigate({}, 'https://github.com/login');
    expect(contents.debugger.attach).not.toHaveBeenCalled();

    // Entering Google attaches the debugger and registers the doc-start script.
    willNavigate({}, 'https://accounts.google.com/o/oauth2/v2/auth');
    expect(contents.debugger.attach).toHaveBeenCalledOnce();
    expect(contents.debugger.sendCommand).toHaveBeenCalledWith(
      'Page.addScriptToEvaluateOnNewDocument',
      expect.objectContaining({
        source: expect.stringContaining('userAgentData'),
      }),
    );

    // Idempotent across the many OAuth hops — no second attach.
    willNavigate({}, 'https://accounts.google.com/signin/challenge');
    expect(contents.debugger.attach).toHaveBeenCalledOnce();
  });

  it('applies the override for main-frame did-start-navigation only', async () => {
    const createdHandler = await installCompat();
    const contents = createContents();
    createdHandler({}, contents);

    const didStartNavigation = contents.on.mock.calls.find(
      ([event]) => event === 'did-start-navigation',
    )?.[1] as DidStartNavigationHandler;

    didStartNavigation({}, 'https://accounts.google.com/embedded/frame', false, false);
    expect(contents.setUserAgent).not.toHaveBeenCalled();

    didStartNavigation({}, 'https://accounts.google.com/signin', false, true);
    expect(contents.setUserAgent).toHaveBeenCalledWith(expect.stringContaining('Firefox/'));
  });

  it('applies the Firefox identity on server-redirect hops into Google (OAuth entry)', async () => {
    // The common OAuth entry is a server-side redirect
    // (site.com/auth/google → 302 → accounts.google.com), which fires neither
    // will-navigate nor did-start-navigation with the Google URL. Regression:
    // without will-redirect coverage the Google document commits under the
    // Chrome-spoof identity and Google bounces to /v3/signin/rejected.
    const createdHandler = await installCompat();
    const contents = createContents();
    createdHandler({}, contents);

    const didStartNavigation = contents.on.mock.calls.find(
      ([event]) => event === 'did-start-navigation',
    )?.[1] as DidStartNavigationHandler;
    const willRedirect = contents.on.mock.calls.find(
      ([event]) => event === 'will-redirect',
    )?.[1] as DidStartNavigationHandler;

    // The leg starts on the OAuth initiator, not a Google host.
    didStartNavigation({}, 'https://github.com/sessions/auth/google', false, true);
    expect(contents.setUserAgent).not.toHaveBeenCalled();

    // Subframe redirects must not flip the top-level identity.
    willRedirect({}, 'https://accounts.google.com/o/oauth2/v2/auth', false, false);
    expect(contents.setUserAgent).not.toHaveBeenCalled();

    // The 302 hop into Google must land the Firefox identity before commit.
    willRedirect({}, 'https://accounts.google.com/o/oauth2/v2/auth', false, true);
    expect(contents.setUserAgent).toHaveBeenLastCalledWith(
      expect.stringContaining('Firefox/'),
    );

    // The continuation redirect back to the site restores the original UA.
    willRedirect({}, 'https://github.com/sessions/auth/google/callback?code=abc', false, true);
    expect(contents.setUserAgent).toHaveBeenLastCalledWith('SpoofedChrome/140');
  });

  it('registers a header rewrite scoped to Google auth hosts', async () => {
    await installCompat();

    expect(electronMocks.onBeforeSendHeaders).toHaveBeenCalledOnce();
    const [filter, listener] = electronMocks.onBeforeSendHeaders.mock.calls[0] as [
      { urls: string[] },
      (details: { requestHeaders: Record<string, string> }, callback: (res: unknown) => void) => void,
    ];
    expect(filter.urls).toContain('https://accounts.google.com/*');

    const callback = vi.fn();
    listener(
      { requestHeaders: { 'User-Agent': 'x', 'Sec-CH-UA': '"Chromium";v="124"' } },
      callback,
    );
    const response = callback.mock.calls[0]?.[0] as { requestHeaders: Record<string, string> };
    expect(response.requestHeaders['User-Agent']).toContain('Firefox/');
    expect(response.requestHeaders['Sec-CH-UA']).toBeUndefined();
  });
});
