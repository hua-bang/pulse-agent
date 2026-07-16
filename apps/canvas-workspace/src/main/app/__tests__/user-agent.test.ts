import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { userAgentFallback: '' },
  session: { defaultSession: { webRequest: { onBeforeSendHeaders: vi.fn() } } },
}));

import { rewriteClientHintHeaders, SPOOFED_CHROME_MAJOR } from '../user-agent';

describe('rewriteClientHintHeaders', () => {
  it('rewrites the low-entropy brand list to the spoofed Chrome major', () => {
    const out = rewriteClientHintHeaders({
      'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not.A/Brand";v="99"',
    });
    expect(out['sec-ch-ua']).toContain(`"Google Chrome";v="${SPOOFED_CHROME_MAJOR}"`);
    expect(out['sec-ch-ua']).toContain(`"Chromium";v="${SPOOFED_CHROME_MAJOR}"`);
    expect(out['sec-ch-ua']).not.toContain('124');
  });

  it('rewrites the full-version-list and full-version hints consistently', () => {
    const out = rewriteClientHintHeaders({
      'Sec-CH-UA-Full-Version-List':
        '"Chromium";v="124.0.6367.207", "Google Chrome";v="124.0.6367.207"',
      'Sec-CH-UA-Full-Version': '"124.0.6367.207"',
    });
    expect(out['Sec-CH-UA-Full-Version-List']).toContain(`v="${SPOOFED_CHROME_MAJOR}.0.0.0"`);
    expect(out['Sec-CH-UA-Full-Version']).toBe(`"${SPOOFED_CHROME_MAJOR}.0.0.0"`);
    expect(out['Sec-CH-UA-Full-Version-List']).not.toContain('124');
  });

  it('is case-insensitive on header names', () => {
    const out = rewriteClientHintHeaders({ 'Sec-CH-UA': '"Chromium";v="124"' });
    expect(out['Sec-CH-UA']).toContain(SPOOFED_CHROME_MAJOR);
  });

  it('leaves non-version hints and other headers untouched', () => {
    const input = {
      'sec-ch-ua-platform': '"macOS"',
      'sec-ch-ua-mobile': '?0',
      'accept-language': 'en-US',
    };
    expect(rewriteClientHintHeaders(input)).toEqual(input);
  });

  it('does not add hint headers that were not already present', () => {
    const out = rewriteClientHintHeaders({ 'user-agent': 'x' });
    expect(out).toEqual({ 'user-agent': 'x' });
    expect('sec-ch-ua' in out).toBe(false);
  });
});
