/**
 * Snapshot-capture helpers shared by the L2 freeze path (registry.ts) and
 * the L3 discard sweep (discard-monitor.ts). Pure module — structural types
 * instead of an electron import — so the hang guard is unit-testable.
 */

const SNAPSHOT_MAX_WIDTH = 800;
const CAPTURE_TIMEOUT_MS = 2_000;

/** The NativeImage surface these helpers need (test-injectable). */
export interface CapturableImage {
  isEmpty: () => boolean;
  getSize: () => { width: number; height: number };
  resize: (options: { width: number }) => CapturableImage;
  toDataURL: () => string;
}

/** Encode a capturePage image bounded to the placeholder's display width. */
export const toBoundedSnapshotDataUrl = (
  image: CapturableImage,
): string | undefined => {
  if (image.isEmpty()) return undefined;
  const { width } = image.getSize();
  const bounded = width > SNAPSHOT_MAX_WIDTH ? image.resize({ width: SNAPSHOT_MAX_WIDTH }) : image;
  return bounded.toDataURL();
};

/**
 * capturePage NEVER SETTLES for a guest that isn't producing frames — a
 * hidden or occluded surface has no frame to copy (observed in CI: the
 * freeze IPC stalled >15s when the host element was hidden before the
 * freeze call). Bound every capture so the lifecycle handler and the
 * discard sweep degrade to "no snapshot" instead of hanging an IPC reply
 * or wedging the sweep's re-entrancy latch forever.
 */
export const captureBoundedSnapshot = (
  wc: { capturePage: () => Promise<CapturableImage> },
  timeoutMs = CAPTURE_TIMEOUT_MS,
): Promise<string | undefined> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), timeoutMs);
    wc.capturePage().then(
      (image) => {
        clearTimeout(timer);
        resolve(toBoundedSnapshotDataUrl(image));
      },
      () => {
        clearTimeout(timer);
        resolve(undefined);
      },
    );
  });
