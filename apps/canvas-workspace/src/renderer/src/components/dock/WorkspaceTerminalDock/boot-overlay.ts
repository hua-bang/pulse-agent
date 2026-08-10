export const MIN_BOOT_OVERLAY_MS = 400;

type Schedule = (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;

export const scheduleBootOverlayDismiss = (
  startedAt: number,
  dismiss: () => void,
  now = Date.now(),
  schedule: Schedule = setTimeout,
): ReturnType<typeof setTimeout> | undefined => {
  const remainingMs = MIN_BOOT_OVERLAY_MS - (now - startedAt);
  if (remainingMs <= 0) {
    dismiss();
    return undefined;
  }
  return schedule(dismiss, remainingMs);
};
