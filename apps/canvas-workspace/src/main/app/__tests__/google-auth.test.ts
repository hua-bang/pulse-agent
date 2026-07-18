import { afterEach, describe, expect, it, vi } from 'vitest';

// google-auth imports the shared coordinator, which imports electron. These
// tests only exercise pure helpers/rules, so a bare mock keeps resolution
// deterministic outside the Electron runtime.
vi.mock('electron', () => ({
  app: { on: vi.fn() },
  session: { defaultSession: { webRequest: { onBeforeSendHeaders: vi.fn() } } },
}));

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

describe('googleAuthIdentityRule', () => {
  afterEach(() => {
    delete process.env.PULSE_GOOGLE_AUTH_IDENTITY;
  });

  it('describes a Firefox identity scoped to the Google auth hosts', async () => {
    const { googleAuthIdentityRule } = await import('../google-auth');
    const rule = googleAuthIdentityRule();
    expect(rule).not.toBeNull();
    expect(rule?.userAgent).toContain('Firefox/');
    expect(rule?.matches('https://accounts.google.com/signin')).toBe(true);
    expect(rule?.matches('https://x.com/home')).toBe(false);
    expect(rule?.headerUrls).toContain('https://accounts.google.com/*');
    // The rewrite pins the same Firefox UA presented per-contents.
    const rewritten = rule?.rewriteHeaders({ 'Sec-CH-UA': '"Chromium";v="124"' });
    expect(rewritten?.['User-Agent']).toContain('Firefox/');
    expect(rewritten?.['Sec-CH-UA']).toBeUndefined();
  });

  it('returns null for the chrome identity A/B arm (installs no override)', async () => {
    process.env.PULSE_GOOGLE_AUTH_IDENTITY = 'chrome';
    const { googleAuthIdentityRule } = await import('../google-auth');
    expect(googleAuthIdentityRule()).toBeNull();
  });
});
