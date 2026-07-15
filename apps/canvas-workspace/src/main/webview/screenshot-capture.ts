import { nativeImage } from 'electron';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { withCdp, type CdpSender } from './cdp-session';
import type { AnyWebContents } from './reader';

const SCREENSHOT_WAKE_SETTLE_MS = 350;
const SCREENSHOT_CAPTURE_TIMEOUT_MS = 20_000;
const SCREENSHOT_WAKE_COMMAND_TIMEOUT_MS = 2_000;
const SCREENSHOT_CDP_COMMAND_TIMEOUT_MS = 3_000;
const SCREENSHOT_CLEANUP_TIMEOUT_MS = 2_000;
const SCREENSHOT_TOTAL_CAPTURE_TIMEOUT_MS = 30_000;
const MAX_WIDTH_CSS_PX = 4_096;
const MAX_HEIGHT_CSS_PX = 8_000;
const MAX_TILES = 16;
const MAX_OUTPUT_PIXELS = 8_000_000;

let screenshotCaptureQueue: Promise<void> = Promise.resolve();

const withScreenshotCaptureSlot = async <T>(operation: () => Promise<T>): Promise<T> => {
  const previous = screenshotCaptureQueue;
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  screenshotCaptureQueue = previous.then(() => current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

/** Temporarily move an off-window guest into view so it can paint a surface. */
export async function wakeWebviewHostForCapture(wc: AnyWebContents): Promise<boolean> {
  const host = wc.hostWebContents;
  if (!host || host.isDestroyed()) return false;
  try {
    const woke = await withTimeout(host.executeJavaScript(`(() => {
      const webview = [...document.querySelectorAll('webview')]
        .find((candidate) => {
          try { return candidate.getWebContentsId() === ${wc.id}; }
          catch { return false; }
        });
      const container = webview?.closest('.iframe-frame-host');
      if (!container) return false;

      // Move only the owning node, without mutating React's canvas transform.
      const rect = container.getBoundingClientRect();
      const outsideWindow = rect.right <= 0 || rect.bottom <= 0
        || rect.left >= window.innerWidth || rect.top >= window.innerHeight;
      const node = container.closest('.canvas-node');
      const canvasTransform = container.closest('.canvas-transform');
      if (outsideWindow && node && canvasTransform
        && !node.hasAttribute('data-webview-capture-translate')) {
        const transform = getComputedStyle(canvasTransform).transform;
        const matrix = transform === 'none' ? null : new DOMMatrixReadOnly(transform);
        const scaleX = Math.abs(matrix?.a ?? 1) || 1;
        const scaleY = Math.abs(matrix?.d ?? 1) || 1;
        const targetLeft = Math.max(16, Math.min(
          window.innerWidth - Math.min(rect.width, window.innerWidth) - 16,
          (window.innerWidth - rect.width) / 2,
        ));
        const targetTop = Math.max(16, Math.min(
          window.innerHeight - Math.min(rect.height, window.innerHeight) - 16,
          (window.innerHeight - rect.height) / 2,
        ));
        node.setAttribute('data-webview-capture-translate', node.style.translate || '');
        node.setAttribute('data-webview-capture-z-index', node.style.zIndex || '');
        node.setAttribute('data-webview-capture-opacity', node.style.opacity || '');
        node.setAttribute('data-webview-capture-pointer-events', node.style.pointerEvents || '');
        node.style.translate = ((targetLeft - rect.left) / scaleX) + 'px '
          + ((targetTop - rect.top) / scaleY) + 'px';
        node.style.zIndex = '2147483646';
        // Keep it composited without flashing or intercepting input.
        node.style.opacity = '0.001';
        node.style.pointerEvents = 'none';
      }
      return true;
    })()`, false) as Promise<boolean>, SCREENSHOT_WAKE_COMMAND_TIMEOUT_MS, 'webview wake timed out');
    if (woke) {
      await new Promise<void>((resolve) => setTimeout(resolve, SCREENSHOT_WAKE_SETTLE_MS));
    }
    return woke;
  } catch {
    return false;
  }
}

/** Restore any temporary host relocation performed by the screenshot wake. */
export async function restoreWebviewHostAfterCapture(wc: AnyWebContents): Promise<boolean> {
  const host = wc.hostWebContents;
  if (!host || host.isDestroyed()) return false;
  try {
    return await withTimeout(host.executeJavaScript(`(() => {
      const webview = [...document.querySelectorAll('webview')]
        .find((candidate) => {
          try { return candidate.getWebContentsId() === ${wc.id}; }
          catch { return false; }
        });
      const container = webview?.closest('.iframe-frame-host');
      const node = container?.closest('.canvas-node');
      if (!container || !node) return false;
      if (!node.hasAttribute('data-webview-capture-translate')) return true;
      node.style.translate = node.getAttribute('data-webview-capture-translate') || '';
      node.style.zIndex = node.getAttribute('data-webview-capture-z-index') || '';
      node.style.opacity = node.getAttribute('data-webview-capture-opacity') || '';
      node.style.pointerEvents = node.getAttribute('data-webview-capture-pointer-events') || '';
      node.removeAttribute('data-webview-capture-translate');
      node.removeAttribute('data-webview-capture-z-index');
      node.removeAttribute('data-webview-capture-opacity');
      node.removeAttribute('data-webview-capture-pointer-events');
      return true;
    })()`, false) as Promise<boolean>, SCREENSHOT_CLEANUP_TIMEOUT_MS, 'webview host restore timed out');
  } catch {
    return false;
  }
}

async function captureScreenshotExclusive(
  wc: AnyWebContents,
): Promise<{ ok: boolean; imagePath: string; error?: string }> {
  try {
    const result = await withCdp(wc, async (send: CdpSender) => {
      const captureStartedAt = Date.now();
      const withCaptureDeadline = <T>(
        promise: Promise<T>,
        commandTimeoutMs: number,
        message: string,
      ): Promise<T> => {
        const remaining = SCREENSHOT_TOTAL_CAPTURE_TIMEOUT_MS - (Date.now() - captureStartedAt);
        if (remaining <= 0) return Promise.reject(new Error('screenshot total capture timed out'));
        return withTimeout(
          promise,
          Math.min(commandTimeoutMs, remaining),
          remaining < commandTimeoutMs ? 'screenshot total capture timed out' : message,
        );
      };
      // Prepare the host only after acquiring this guest's CDP mutex.
      const hostWoke = await wakeWebviewHostForCapture(wc);
      const scrollStyleId = `pulse-screenshot-${randomUUID()}`;
      let scrollSessionAttempted = false;
      let originalX = 0;
      let originalY = 0;
      try {
        if (!hostWoke) throw new Error('webview host could not be prepared for screenshot');
        const metrics = await withCaptureDeadline(
          send<{
            contentSize: { width: number; height: number };
            visualViewport: { clientWidth: number; clientHeight: number };
            cssContentSize?: { width: number; height: number }; cssVisualViewport?: {
              clientWidth: number; clientHeight: number;
            };
          }>('Page.getLayoutMetrics'),
          SCREENSHOT_CDP_COMMAND_TIMEOUT_MS,
          'screenshot layout metrics timed out',
        );
        const useCss = Boolean(metrics.cssContentSize && metrics.cssVisualViewport);
        const content = useCss ? metrics.cssContentSize! : metrics.contentSize;
        const viewport = useCss ? metrics.cssVisualViewport! : metrics.visualViewport;
        const dimensions = [content.width, content.height, viewport.clientWidth, viewport.clientHeight];
        if (!dimensions.every((value) => Number.isFinite(value) && value > 0)) {
          throw new Error('screenshot layout metrics are invalid');
        }
        const viewportWidth = Math.floor(viewport.clientWidth);
        const viewportHeight = Math.floor(viewport.clientHeight);
        const fullWidth = Math.max(viewportWidth, Math.ceil(content.width));
        const fullHeight = Math.max(1, Math.min(Math.ceil(content.height), MAX_HEIGHT_CSS_PX));
        if (fullWidth > MAX_WIDTH_CSS_PX) {
          throw new Error(`screenshot width exceeds ${MAX_WIDTH_CSS_PX} CSS pixels`);
        }
        if (fullWidth * fullHeight > MAX_OUTPUT_PIXELS) {
          throw new Error(`screenshot output exceeds ${MAX_OUTPUT_PIXELS} pixels`);
        }
        const xTileCount = fullWidth <= viewportWidth
          ? 1
          : Math.ceil((fullWidth - viewportWidth) / viewportWidth) + 1;
        const yTileCount = fullHeight <= viewportHeight
          ? 1
          : Math.ceil((fullHeight - viewportHeight) / viewportHeight) + 1;
        if (xTileCount * yTileCount > MAX_TILES) {
          throw new Error(`screenshot requires more than ${MAX_TILES} tiles`);
        }
        const offsets = (total: number, size: number): number[] => {
          const last = Math.max(0, total - size);
          const values: number[] = [];
          for (let value = 0; value < last; value += size) values.push(value);
          values.push(last);
          return [...new Set(values.map(Math.round))];
        };
        const xOffsets = offsets(fullWidth, viewportWidth);
        const yOffsets = offsets(fullHeight, viewportHeight);
        scrollSessionAttempted = true;
        const setup = await withCaptureDeadline(send<{ result?: {
          value?: { x?: number; y?: number; dpr?: number };
        } }>('Runtime.evaluate', {
          expression: `(() => {
            const style = document.createElement('style');
            style.id = ${JSON.stringify(scrollStyleId)};
            style.dataset.originalX = String(window.scrollX);
            style.dataset.originalY = String(window.scrollY);
            style.textContent = 'html,body{scroll-behavior:auto!important;scroll-snap-type:none!important}' +
              'html::-webkit-scrollbar,body::-webkit-scrollbar{display:none!important}html,body{scrollbar-width:none!important}';
            (document.head || document.documentElement).appendChild(style);
            return { x: window.scrollX, y: window.scrollY, dpr: window.devicePixelRatio };
          })()`,
          returnByValue: true,
        }), SCREENSHOT_CDP_COMMAND_TIMEOUT_MS, 'screenshot scroll setup timed out');
        originalX = setup.result?.value?.x ?? 0;
        originalY = setup.result?.value?.y ?? 0;
        const dpr = setup.result?.value?.dpr ?? 1;
        if (!Number.isFinite(dpr) || dpr <= 0 ||
          Math.ceil(fullWidth * dpr) * Math.ceil(fullHeight * dpr) > MAX_OUTPUT_PIXELS) {
          throw new Error(`screenshot output exceeds ${MAX_OUTPUT_PIXELS} pixels`);
        }
        let bitmap: Buffer | undefined;
        let outputWidth = 0, outputHeight = 0, scaleX = 0, scaleY = 0;
        for (const y of yOffsets) for (const x of xOffsets) {
          const position = await withCaptureDeadline(send<{ result?: { value?: {
            x?: number; y?: number; width?: number; height?: number;
          } } }>('Runtime.evaluate', {
            expression: `(async () => {
              window.scrollTo(${x}, ${y});
              await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
              return { x: window.scrollX, y: window.scrollY, width: window.innerWidth, height: window.innerHeight };
            })()`,
            awaitPromise: true,
            returnByValue: true,
          }), SCREENSHOT_CDP_COMMAND_TIMEOUT_MS, 'screenshot scroll timed out');
          const positionValue = position.result?.value;
          if (!positionValue || ![positionValue.x, positionValue.y, positionValue.width, positionValue.height]
            .every((value) => Number.isFinite(value))
            || (positionValue.width ?? 0) <= 0 || (positionValue.height ?? 0) <= 0) {
            throw new Error('screenshot scroll position is invalid');
          }
          if (Math.abs((positionValue.x ?? 0) - x) > 1 || Math.abs((positionValue.y ?? 0) - y) > 1) {
            throw new Error('screenshot page did not reach the requested tile position');
          }
          const tileResult = await withCaptureDeadline(send<{ data: string }>('Page.captureScreenshot', {
            format: 'png', fromSurface: true,
          }), SCREENSHOT_CAPTURE_TIMEOUT_MS, 'screenshot capture timed out');
          const tile = nativeImage.createFromBuffer(Buffer.from(tileResult.data, 'base64'), { scaleFactor: 1 });
          const size = tile.getSize();
          const tileBitmap = tile.getBitmap();
          if (size.width < 1 || size.height < 1 || tileBitmap.length < size.width * size.height * 4) {
            throw new Error('screenshot tile is empty');
          }
          if (!bitmap) {
            scaleX = size.width / Math.max(1, positionValue?.width ?? viewportWidth);
            scaleY = size.height / Math.max(1, positionValue?.height ?? viewportHeight);
            if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) {
              throw new Error('screenshot tile scale is invalid');
            }
            outputWidth = Math.ceil(fullWidth * scaleX);
            outputHeight = Math.ceil(fullHeight * scaleY);
            if (outputWidth * outputHeight > MAX_OUTPUT_PIXELS) {
              throw new Error(`screenshot output exceeds ${MAX_OUTPUT_PIXELS} pixels`);
            }
            bitmap = Buffer.alloc(outputWidth * outputHeight * 4);
          }
          const destX = Math.max(0, Math.round((positionValue?.x ?? x) * scaleX));
          const destY = Math.max(0, Math.round((positionValue?.y ?? y) * scaleY));
          const copyWidth = Math.min(size.width, outputWidth - destX);
          const copyHeight = Math.min(size.height, outputHeight - destY);
          for (let row = 0; row < copyHeight; row += 1) {
            const sourceStart = row * size.width * 4;
            const targetStart = ((destY + row) * outputWidth + destX) * 4;
            tileBitmap.copy(bitmap, targetStart, sourceStart, sourceStart + copyWidth * 4);
          }
        }
        if (!bitmap) throw new Error('screenshot produced no tiles');
        return nativeImage.createFromBitmap(bitmap, {
          width: outputWidth, height: outputHeight, scaleFactor: 1,
        }).toPNG();
      } finally {
        let cleanupError: Error | undefined;
        if (scrollSessionAttempted) try {
          await withTimeout(send('Runtime.evaluate', {
            expression: `(async () => {
              const style = document.getElementById(${JSON.stringify(scrollStyleId)});
              const x = Number(style?.dataset.originalX ?? ${originalX});
              const y = Number(style?.dataset.originalY ?? ${originalY});
              style?.remove();
              window.scrollTo(x, y);
              await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
              return true;
            })()`,
            awaitPromise: true,
            returnByValue: true,
          }), SCREENSHOT_CLEANUP_TIMEOUT_MS, 'screenshot scroll restore timed out');
        } catch (error) {
          cleanupError = error instanceof Error ? error : new Error(String(error));
        }
        // Keep temporary host geometry inside the per-guest mutex.
        const hostRestored = await restoreWebviewHostAfterCapture(wc);
        if (!hostRestored && !cleanupError) {
          cleanupError = new Error('webview host restore failed');
        }
        if (cleanupError) throw cleanupError;
      }
    });
    const imagePath = `${tmpdir()}/pulse-screenshot-${randomUUID()}.png`;
    await fs.writeFile(imagePath, result);
    return { ok: true, imagePath };
  } catch (err) {
    return { ok: false, imagePath: '', error: err instanceof Error ? err.message : String(err) };
  }
}

export async function captureScreenshot(
  wc: AnyWebContents,
): Promise<{ ok: boolean; imagePath: string; error?: string }> {
  return withScreenshotCaptureSlot(() => captureScreenshotExclusive(wc));
}
