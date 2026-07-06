import { describe, it, expect, afterEach } from 'vitest';
import { shouldRunHeadless, assertDisplayAvailable } from '../headless.mjs';

// process.platform is a read-only-ish property (simple assignment is silently
// ignored), so mock it via defineProperty and always restore the real value.
const realPlatform = process.platform;
const setPlatform = (p) => {
  Object.defineProperty(process, 'platform', { value: p, configurable: true, writable: true });
};

afterEach(() => {
  setPlatform(realPlatform);
});

describe('shouldRunHeadless', () => {
  it('honors --headless on Linux (Xvfb is available there)', () => {
    setPlatform('linux');
    expect(shouldRunHeadless({ headless: true })).toBe(true);
  });

  it('ignores --headless on macOS — real display is used, not Xvfb', () => {
    // Regression: previously --headless unconditionally triggered ensureHeadlessDisplay(),
    // which spawns Xvfb. Xvfb is absent on macOS → 8s timeout → perf:report degraded to
    // bundle-only. macOS has a real display, so headless-via-Xvfb must not engage.
    setPlatform('darwin');
    expect(shouldRunHeadless({ headless: true })).toBe(false);
  });

  it('ignores --headless on Windows too', () => {
    setPlatform('win32');
    expect(shouldRunHeadless({ headless: true })).toBe(false);
  });

  it('returns false when --headless is not requested, on any platform', () => {
    setPlatform('linux');
    expect(shouldRunHeadless({ headless: false })).toBe(false);
    expect(shouldRunHeadless({})).toBe(false);
  });
});

describe('assertDisplayAvailable', () => {
  it('passes on macOS without DISPLAY (real display assumed)', () => {
    setPlatform('darwin');
    const saved = process.env.DISPLAY;
    delete process.env.DISPLAY;
    try {
      expect(() => assertDisplayAvailable()).not.toThrow();
    } finally {
      if (saved !== undefined) process.env.DISPLAY = saved;
    }
  });
});
