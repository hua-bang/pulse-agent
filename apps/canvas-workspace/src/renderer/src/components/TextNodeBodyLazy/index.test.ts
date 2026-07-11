import { describe, expect, it } from 'vitest';
import { htmlToPreviewText } from '.';

describe('htmlToPreviewText', () => {
  it('extracts text without executing or exposing markup', () => {
    expect(htmlToPreviewText('<p>Hello <strong>Canvas</strong></p><script>alert(1)</script>'))
      .toBe('Hello Canvasalert(1)');
  });
});
