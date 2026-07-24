import { describe, expect, it, vi } from 'vitest';

// x-com-compat imports the shared coordinator, which imports electron.
vi.mock('electron', () => ({
  app: { on: vi.fn() },
  session: { defaultSession: { webRequest: { onBeforeSendHeaders: vi.fn() } } },
}));

describe('isXComUrl', () => {
  it('matches x.com and twitter.com surfaces over https, including subdomains', async () => {
    const { isXComUrl } = await import('../x-com-compat');
    expect(isXComUrl('https://x.com/home')).toBe(true);
    expect(isXComUrl('https://www.x.com/')).toBe(true);
    expect(isXComUrl('https://api.x.com/1.1/foo.json')).toBe(true);
    expect(isXComUrl('https://mobile.x.com/')).toBe(true);
    expect(isXComUrl('https://twitter.com/home')).toBe(true);
    expect(isXComUrl('https://api.twitter.com/graphql')).toBe(true);
  });

  it('rejects non-x.com hosts, lookalikes, and non-https', async () => {
    const { isXComUrl } = await import('../x-com-compat');
    // Suffix boundary: a host merely ending in the literal string must not pass.
    expect(isXComUrl('https://x.com.evil.example/')).toBe(false);
    expect(isXComUrl('https://notx.com/')).toBe(false);
    expect(isXComUrl('https://xtwitter.com/')).toBe(false);
    expect(isXComUrl('http://x.com/home')).toBe(false);
    expect(isXComUrl('https://example.com/')).toBe(false);
    expect(isXComUrl('not a url')).toBe(false);
  });
});

describe('rewriteXComHeaders', () => {
  it('pins a Firefox UA and strips client-hint headers', async () => {
    const { rewriteXComHeaders } = await import('../x-com-compat');
    const rewritten = rewriteXComHeaders({
      'user-agent': 'Mozilla/5.0 Chrome/140.0.0.0',
      'Sec-CH-UA': '"Chromium";v="124"',
      'sec-ch-ua-mobile': '?0',
      Accept: 'text/html',
    });
    expect(rewritten['User-Agent']).toMatch(/Gecko\/20100101 Firefox\/\d+/);
    expect(rewritten['User-Agent']).not.toContain('Chrome');
    expect(rewritten.Accept).toBe('text/html');
    expect(Object.keys(rewritten).some((k) => k.toLowerCase().startsWith('sec-ch-'))).toBe(false);
    expect(Object.keys(rewritten).filter((k) => k.toLowerCase() === 'user-agent')).toEqual(['User-Agent']);
  });
});

describe('xComIdentityRule', () => {
  it('describes a Firefox identity scoped to x.com/twitter.com hosts', async () => {
    const { xComIdentityRule } = await import('../x-com-compat');
    const rule = xComIdentityRule();
    expect(rule.id).toBe('x-com');
    expect(rule.userAgent).toContain('Firefox/');
    expect(rule.matches('https://x.com/home')).toBe(true);
    expect(rule.matches('https://accounts.google.com/signin')).toBe(false);
    expect(rule.headerUrls).toEqual(
      expect.arrayContaining([
        'https://x.com/*',
        'https://*.x.com/*',
        'https://twitter.com/*',
        'https://*.twitter.com/*',
      ]),
    );
  });
});
