import { describe, expect, it } from 'vitest';
import { imageExtensionFromMime, isImageUrl, resolveWorkspaceId } from './noteImageInsert';

describe('imageExtensionFromMime', () => {
  it('maps jpeg to jpg', () => expect(imageExtensionFromMime('image/jpeg')).toBe('jpg'));
  it('strips the image/ prefix', () => expect(imageExtensionFromMime('image/webp')).toBe('webp'));
  it('defaults to png for empty/unknown', () => {
    expect(imageExtensionFromMime(undefined)).toBe('png');
    expect(imageExtensionFromMime('')).toBe('png');
  });
});

describe('resolveWorkspaceId', () => {
  it('prefers the explicit id', () => {
    expect(resolveWorkspaceId('ws1', '/canvas/other/notes/a.md')).toBe('ws1');
  });
  it('derives from the file path when no explicit id', () => {
    expect(resolveWorkspaceId(null, '/home/x/canvas/ws-7/notes/a.md')).toBe('ws-7');
  });
  it('falls back to default', () => {
    expect(resolveWorkspaceId(undefined, '/tmp/a.md')).toBe('default');
  });
});

describe('isImageUrl', () => {
  it('accepts http(s) image urls (with query)', () => {
    expect(isImageUrl('https://x.com/a.png')).toBe(true);
    expect(isImageUrl('http://x.com/a/b.JPG?v=2')).toBe(true);
  });
  it('rejects non-image or non-url text', () => {
    expect(isImageUrl('hello world')).toBe(false);
    expect(isImageUrl('https://x.com/page')).toBe(false);
    expect(isImageUrl('a.png')).toBe(false);
  });
});
