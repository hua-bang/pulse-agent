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

type NavHandler = (event: unknown, url: string) => void;
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
    getUserAgent: vi.fn(() => currentUserAgent),
    setUserAgent: vi.fn((next: string) => {
      currentUserAgent = next;
    }),
  };
}

type Contents = ReturnType<typeof createContents>;

async function install(rules: unknown[]) {
  const { setupEmbeddedIdentity } = await import('../embedded-identity');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setupEmbeddedIdentity(rules as any);
  const createdHandler = electronMocks.appOn.mock.calls.find(
    ([event]) => event === 'web-contents-created',
  )?.[1] as ((event: unknown, contents: Contents) => void) | undefined;
  return createdHandler;
}

function firefoxRule(id: string, host: string) {
  return {
    id,
    matches: (url: string) => {
      try {
        return new URL(url).hostname === host;
      } catch {
        return false;
      }
    },
    userAgent: `Mozilla/5.0 Firefox/140.0 (${id})`,
    headerUrls: [`https://${host}/*`],
    rewriteHeaders: (headers: Record<string, string>) => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(headers)) {
        if (k.toLowerCase().startsWith('sec-ch-') || k.toLowerCase() === 'user-agent') continue;
        out[k] = v;
      }
      out['User-Agent'] = `Mozilla/5.0 Firefox/140.0 (${id})`;
      return out;
    },
  };
}

describe('setupEmbeddedIdentity', () => {
  beforeEach(() => {
    vi.resetModules();
    electronMocks.appOn.mockReset();
    electronMocks.onBeforeSendHeaders.mockReset();
  });

  it('installs nothing when given no rules', async () => {
    await install([]);
    expect(electronMocks.appOn).not.toHaveBeenCalled();
    expect(electronMocks.onBeforeSendHeaders).not.toHaveBeenCalled();
  });

  it('overrides the UA on a matching host and restores it after leaving', async () => {
    const createdHandler = await install([firefoxRule('x-com', 'x.com')]);
    const contents = createContents();
    createdHandler?.({}, contents);

    const willNavigate = contents.on.mock.calls.find(
      ([event]) => event === 'will-navigate',
    )?.[1] as NavHandler;

    willNavigate({}, 'https://x.com/home');
    expect(contents.setUserAgent).toHaveBeenLastCalledWith(expect.stringContaining('Firefox/'));

    // Same-host navigation must not churn the UA (already the target identity).
    willNavigate({}, 'https://x.com/explore');
    expect(contents.setUserAgent).toHaveBeenCalledTimes(1);

    // Leaving the host restores the original spoofed UA, not the Firefox one.
    willNavigate({}, 'https://example.com/');
    expect(contents.setUserAgent).toHaveBeenLastCalledWith('SpoofedChrome/140');
  });

  it('applies the override for main-frame did-start-navigation only', async () => {
    const createdHandler = await install([firefoxRule('x-com', 'x.com')]);
    const contents = createContents();
    createdHandler?.({}, contents);

    const didStart = contents.on.mock.calls.find(
      ([event]) => event === 'did-start-navigation',
    )?.[1] as DidStartNavigationHandler;

    didStart({}, 'https://x.com/i/subframe', false, false);
    expect(contents.setUserAgent).not.toHaveBeenCalled();

    didStart({}, 'https://x.com/home', false, true);
    expect(contents.setUserAgent).toHaveBeenCalledWith(expect.stringContaining('Firefox/'));
  });

  it('keeps one saved original UA when a contents crosses between two host sets', async () => {
    const createdHandler = await install([
      firefoxRule('google', 'accounts.google.com'),
      firefoxRule('x-com', 'x.com'),
    ]);
    const contents = createContents();
    createdHandler?.({}, contents);

    const willNavigate = contents.on.mock.calls.find(
      ([event]) => event === 'will-navigate',
    )?.[1] as NavHandler;

    willNavigate({}, 'https://x.com/home');
    willNavigate({}, 'https://accounts.google.com/signin');
    // Different rule, different UA — the override must switch, not stick.
    expect(contents.setUserAgent).toHaveBeenLastCalledWith(expect.stringContaining('(google)'));

    // Leaving both restores the TRUE original captured on first entry.
    willNavigate({}, 'https://example.com/');
    expect(contents.setUserAgent).toHaveBeenLastCalledWith('SpoofedChrome/140');
  });

  it('registers a single header listener that dispatches by request host', async () => {
    await install([
      firefoxRule('google', 'accounts.google.com'),
      firefoxRule('x-com', 'x.com'),
    ]);

    expect(electronMocks.onBeforeSendHeaders).toHaveBeenCalledOnce();
    const [filter, listener] = electronMocks.onBeforeSendHeaders.mock.calls[0] as [
      { urls: string[] },
      (
        details: { url: string; requestHeaders: Record<string, string> },
        callback: (res: unknown) => void,
      ) => void,
    ];
    expect(filter.urls).toEqual(
      expect.arrayContaining(['https://accounts.google.com/*', 'https://x.com/*']),
    );

    const callback = vi.fn();
    listener(
      { url: 'https://x.com/home', requestHeaders: { 'User-Agent': 'x', 'Sec-CH-UA': '"Chromium";v="124"' } },
      callback,
    );
    const response = callback.mock.calls[0]?.[0] as { requestHeaders: Record<string, string> };
    expect(response.requestHeaders['User-Agent']).toContain('(x-com)');
    expect(response.requestHeaders['Sec-CH-UA']).toBeUndefined();
  });

  it('passes headers through unchanged for a filtered request no rule claims', async () => {
    await install([firefoxRule('x-com', 'x.com')]);
    const [, listener] = electronMocks.onBeforeSendHeaders.mock.calls[0] as [
      unknown,
      (
        details: { url: string; requestHeaders: Record<string, string> },
        callback: (res: unknown) => void,
      ) => void,
    ];
    const callback = vi.fn();
    listener({ url: 'https://other.example/', requestHeaders: { A: 'b' } }, callback);
    const response = callback.mock.calls[0]?.[0] as { requestHeaders: Record<string, string> };
    expect(response.requestHeaders).toEqual({ A: 'b' });
  });
});

describe('firefoxUserAgent', () => {
  it('builds a platform-appropriate Firefox UA with no client-hint source', async () => {
    const { firefoxUserAgent } = await import('../embedded-identity');
    expect(firefoxUserAgent('140.0', 'darwin')).toContain('Macintosh');
    expect(firefoxUserAgent('140.0', 'win32')).toContain('Windows NT 10.0');
    expect(firefoxUserAgent('140.0', 'linux')).toContain('X11; Linux x86_64');
    expect(firefoxUserAgent('140.0', 'linux')).toMatch(/Firefox\/140\.0$/);
  });
});
