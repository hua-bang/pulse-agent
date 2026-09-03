import { describe, expect, it } from 'vitest';
import { isVSCodeLink } from './externalLinks';

describe('chat external links', () => {
  it('detects VS Code editor protocol links', () => {
    expect(isVSCodeLink('vscode://file/root/project/src/App.tsx:12:3')).toBe(true);
    expect(isVSCodeLink('vscode-insiders://file/root/project/src/App.tsx:12:3')).toBe(true);
  });

  it('ignores non-editor and malformed links', () => {
    expect(isVSCodeLink('https://example.com')).toBe(false);
    expect(isVSCodeLink('mailto:dev@example.com')).toBe(false);
    expect(isVSCodeLink('not a url')).toBe(false);
  });
});
