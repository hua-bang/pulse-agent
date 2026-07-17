import { describe, expect, it } from 'vitest';
import { looksLikeUrl, resolveAddressInput, SEARCH_ENGINES } from '../address-input';

describe('looksLikeUrl', () => {
  it('accepts explicit scheme://, protocol-relative, and blank', () => {
    expect(looksLikeUrl('https://example.com')).toBe(true);
    expect(looksLikeUrl('vscode://file/x.ts')).toBe(true);
    expect(looksLikeUrl('//cdn.example.com/x.js')).toBe(true);
    expect(looksLikeUrl('blank')).toBe(true);
    expect(looksLikeUrl('about:blank')).toBe(true);
  });

  it('accepts domains, localhost, IPs — with ports and paths', () => {
    expect(looksLikeUrl('example.com')).toBe(true);
    expect(looksLikeUrl('sub.example.co.uk/path?q=1')).toBe(true);
    expect(looksLikeUrl('localhost')).toBe(true);
    expect(looksLikeUrl('localhost:3000/admin')).toBe(true);
    expect(looksLikeUrl('192.168.1.1:8080')).toBe(true);
  });

  it('rejects queries: spaces, single words, questions', () => {
    expect(looksLikeUrl('how to cook rice')).toBe(false);
    expect(looksLikeUrl('cats')).toBe(false);
    expect(looksLikeUrl('什么是人工智能')).toBe(false);
    expect(looksLikeUrl('')).toBe(false);
  });

  it('does not treat bare scheme-like input (javascript:) as a URL', () => {
    expect(looksLikeUrl('javascript:alert(1)')).toBe(false);
  });
});

describe('resolveAddressInput', () => {
  it('normalizes URL-ish input', () => {
    expect(resolveAddressInput('example.com', 'google')).toBe('https://example.com');
    expect(resolveAddressInput('https://example.com/a', 'google')).toBe('https://example.com/a');
  });

  it('sends queries to the chosen engine', () => {
    expect(resolveAddressInput('how to cook rice', 'google')).toBe(
      'https://www.google.com/search?q=how%20to%20cook%20rice',
    );
    expect(resolveAddressInput('rust', 'bing')).toBe('https://www.bing.com/search?q=rust');
    expect(resolveAddressInput('privacy', 'duckduckgo')).toBe('https://duckduckgo.com/?q=privacy');
  });

  it('offers exactly the supported engines (baidu was removed)', () => {
    expect(Object.keys(SEARCH_ENGINES).sort()).toEqual(['bing', 'duckduckgo', 'google']);
  });

  it('returns empty for empty input and defaults to google', () => {
    expect(resolveAddressInput('   ', 'google')).toBe('');
    // No stored preference in this environment → default engine is used.
    expect(resolveAddressInput('cats')).toBe(SEARCH_ENGINES.google.buildSearchUrl('cats'));
  });
});
