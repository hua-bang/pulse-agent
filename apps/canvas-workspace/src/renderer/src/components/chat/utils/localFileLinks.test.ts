import { describe, expect, it } from 'vitest';
import { localPathFromHref } from './localFileLinks';

describe('localPathFromHref', () => {
  it('accepts absolute POSIX paths from Markdown links', () => {
    expect(localPathFromHref('/Users/example/My%20Image.png')).toBe('/Users/example/My Image.png');
  });

  it('accepts file URLs and decodes their path', () => {
    expect(localPathFromHref('file:///Users/example/My%20Image.png')).toBe('/Users/example/My Image.png');
  });

  it('accepts Windows absolute paths', () => {
    expect(localPathFromHref('C:\\Users\\example\\report.pdf')).toBe('C:\\Users\\example\\report.pdf');
    expect(localPathFromHref('file:///C:/Users/example/report.pdf')).toBe('C:/Users/example/report.pdf');
  });

  it('does not claim relative or external links', () => {
    expect(localPathFromHref('images/example.png')).toBeNull();
    expect(localPathFromHref('https://example.com/image.png')).toBeNull();
    expect(localPathFromHref('vscode://file/Users/example/app.ts')).toBeNull();
  });
});
