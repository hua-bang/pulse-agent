import { describe, expect, it, vi } from 'vitest';
import {
  MIN_BOOT_OVERLAY_MS,
  scheduleBootOverlayDismiss,
} from './boot-overlay';

describe('scheduleBootOverlayDismiss', () => {
  it('keeps the loading state visible for a perceptible minimum after immediate PTY output', () => {
    const dismiss = vi.fn();
    const schedule = vi.fn(
      () => 1 as unknown as ReturnType<typeof setTimeout>,
    );

    scheduleBootOverlayDismiss(1_000, dismiss, 1_010, schedule);

    expect(dismiss).not.toHaveBeenCalled();
    expect(schedule).toHaveBeenCalledWith(dismiss, MIN_BOOT_OVERLAY_MS - 10);
  });

  it('dismisses immediately once the minimum duration has elapsed', () => {
    const dismiss = vi.fn();
    const schedule = vi.fn(
      () => 1 as unknown as ReturnType<typeof setTimeout>,
    );

    scheduleBootOverlayDismiss(1_000, dismiss, 1_000 + MIN_BOOT_OVERLAY_MS, schedule);

    expect(dismiss).toHaveBeenCalledOnce();
    expect(schedule).not.toHaveBeenCalled();
  });
});
