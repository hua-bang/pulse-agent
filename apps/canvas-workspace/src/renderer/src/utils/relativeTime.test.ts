import { describe, expect, it } from 'vitest';
import { formatRelativeTime } from './relativeTime';

describe('formatRelativeTime', () => {
  const now = Date.UTC(2026, 9, 26, 12);

  it('speaks the app language', () => {
    expect(formatRelativeTime(now - 22 * 60_000, 'en', now)).toBe('22 minutes ago');
    expect(formatRelativeTime(now - 22 * 60_000, 'zh', now)).toBe('22分钟前');
    expect(formatRelativeTime(now - 3 * 3_600_000, 'zh', now)).toBe('3小时前');
  });
});
