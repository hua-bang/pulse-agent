import { describe, expect, it } from 'vitest';
import { getWebNodeUrl } from './webNode';

describe('getWebNodeUrl', () => {
  it('opens a URL-mode Web node at its trimmed address', () => {
    expect(getWebNodeUrl({ type: 'iframe', data: { url: ' https://chatgpt.com/ ', html: '', mode: 'url' } }))
      .toBe('https://chatgpt.com/');
  });

  it('treats a Web node without a mode as URL mode', () => {
    expect(getWebNodeUrl({ type: 'iframe', data: { url: 'https://example.com', html: '' } as never }))
      .toBe('https://example.com');
  });

  it('keeps node detail for HTML-mode, blank and non-Web nodes', () => {
    expect(getWebNodeUrl({ type: 'iframe', data: { url: 'https://example.com', html: '<p/>', mode: 'html' } })).toBeNull();
    expect(getWebNodeUrl({ type: 'iframe', data: { url: '  ', html: '', mode: 'url' } })).toBeNull();
    expect(getWebNodeUrl({ type: 'text', data: { content: 'https://example.com' } as never })).toBeNull();
    expect(getWebNodeUrl(undefined)).toBeNull();
  });
});
