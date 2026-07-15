import { promises as fs } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cdp = vi.hoisted(() => ({
  withCdp: vi.fn(),
}));
const electron = vi.hoisted(() => ({
  createFromBuffer: vi.fn(),
  createFromBitmap: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  nativeImage: electron,
}));

vi.mock('./cdp-session', () => ({
  withCdp: cdp.withCdp,
}));

import {
  captureScreenshot,
  wakeWebviewHostForCapture,
} from './screenshot-capture';

const layoutMetrics = {
  contentSize: { width: 800, height: 600 },
  visualViewport: { clientWidth: 800, clientHeight: 600 },
};

beforeEach(() => {
  vi.useFakeTimers();
  cdp.withCdp.mockReset();
  electron.createFromBuffer.mockReset();
  electron.createFromBitmap.mockReset();
  electron.createFromBuffer.mockImplementation(() => ({
    getSize: () => ({ width: 800, height: 600 }),
    getBitmap: () => Buffer.alloc(800 * 600 * 4, 1),
  }));
  electron.createFromBitmap.mockImplementation((_bitmap, options) => ({
    toPNG: () => Buffer.from(`stitched:${options.width}x${options.height}`),
  }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('offscreen WebView screenshot lifecycle', () => {
  it('renews the wake lease and settles only after entering the per-guest CDP queue', async () => {
    const order: string[] = [];
    let wakeScript = '';
    let restoreScript = '';
    let hostScriptCalls = 0;
    const wc = {
      id: 42,
      hostWebContents: {
        isDestroyed: () => false,
        executeJavaScript: vi.fn(async (script: string) => {
          hostScriptCalls += 1;
          if (hostScriptCalls === 1) {
            order.push('wake');
            wakeScript = script;
          } else {
            order.push('restore-host');
            restoreScript = script;
          }
          return true;
        }),
      },
    };
    let runtimeCalls = 0;
    const send = vi.fn(async (method: string, _params?: unknown) => {
      order.push(method);
      if (method === 'Page.getLayoutMetrics') return layoutMetrics;
      if (method === 'Runtime.evaluate') {
        runtimeCalls += 1;
        return runtimeCalls === 1
          ? { result: { value: { x: 0, y: 0, dpr: 1 } } }
          : { result: { value: { x: 0, y: 0, width: 800, height: 600 } } };
      }
      if (method === 'Page.captureScreenshot') {
        return { data: Buffer.from('png').toString('base64') };
      }
      return {};
    });
    cdp.withCdp.mockImplementation(async (_wc, operation) => {
      order.push('lock');
      return operation(send);
    });

    const capture = captureScreenshot(wc as never);
    await vi.advanceTimersByTimeAsync(349);
    expect(order).toEqual(['lock', 'wake']);
    await vi.advanceTimersByTimeAsync(1);
    const result = await capture;

    expect(result.ok).toBe(true);
    expect(order).toEqual([
      'lock',
      'wake',
      'Page.getLayoutMetrics',
      'Runtime.evaluate',
      'Runtime.evaluate',
      'Page.captureScreenshot',
      'Runtime.evaluate',
      'restore-host',
    ]);
    expect(wakeScript).not.toContain('window.dispatchEvent');
    expect(wakeScript).toContain("node.style.translate = ((targetLeft - rect.left) / scaleX)");
    expect(wakeScript).toContain("node.style.zIndex = '2147483646'");
    expect(wakeScript).toContain("node.style.opacity = '0.001'");
    expect(restoreScript).toContain("node.removeAttribute('data-webview-capture-translate')");
    expect(restoreScript).toContain("node.removeAttribute('data-webview-capture-z-index')");
    expect(send).toHaveBeenCalledWith('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
    });
    if (result.ok) await fs.rm(result.imagePath, { force: true });
  });

  it('renews and settles even when the host was already awake', async () => {
    const executeJavaScript = vi.fn().mockResolvedValue(true);
    const wc = {
      id: 7,
      hostWebContents: {
        isDestroyed: () => false,
        executeJavaScript,
      },
    };

    const first = wakeWebviewHostForCapture(wc as never);
    await vi.advanceTimersByTimeAsync(350);
    await expect(first).resolves.toBe(true);
    const second = wakeWebviewHostForCapture(wc as never);
    await vi.advanceTimersByTimeAsync(350);
    await expect(second).resolves.toBe(true);

    expect(executeJavaScript).toHaveBeenCalledTimes(2);
  });

  it('bounds a capture that never produces a painted surface', async () => {
    const wc = {
      id: 99,
      hostWebContents: {
        isDestroyed: () => false,
        executeJavaScript: vi.fn().mockResolvedValue(true),
      },
    };
    let runtimeCalls = 0;
    const send = vi.fn((method: string) => {
      if (method === 'Page.getLayoutMetrics') return Promise.resolve(layoutMetrics);
      if (method === 'Runtime.evaluate') {
        runtimeCalls += 1;
        return Promise.resolve(runtimeCalls === 1
          ? { result: { value: { x: 0, y: 0, dpr: 1 } } }
          : { result: { value: { x: 0, y: 0, width: 800, height: 600 } } });
      }
      if (method === 'Page.captureScreenshot') return new Promise(() => undefined);
      return Promise.resolve({});
    });
    cdp.withCdp.mockImplementation(async (_wc, operation) => operation(send));

    const capture = captureScreenshot(wc as never);
    await vi.advanceTimersByTimeAsync(350);
    await vi.advanceTimersByTimeAsync(20_000);

    await expect(capture).resolves.toMatchObject({
      ok: false,
      error: 'screenshot capture timed out',
    });
  });

  it('releases the operation when host wake or layout metrics never settle', async () => {
    const wakeHung = {
      id: 100,
      hostWebContents: {
        isDestroyed: () => false,
        executeJavaScript: vi.fn(() => new Promise(() => undefined)),
      },
    };
    let runtimeCalls = 0;
    const successfulSend = vi.fn(async (method: string) => {
      if (method === 'Page.getLayoutMetrics') return layoutMetrics;
      if (method === 'Runtime.evaluate') {
        runtimeCalls += 1;
        return runtimeCalls === 1
          ? { result: { value: { x: 0, y: 0, dpr: 1 } } }
          : { result: { value: { x: 0, y: 0, width: 800, height: 600 } } };
      }
      if (method === 'Page.captureScreenshot') {
        return { data: Buffer.from('png').toString('base64') };
      }
      return {};
    });
    cdp.withCdp.mockImplementationOnce(async (_wc, operation) => operation(successfulSend));

    const wakeBounded = captureScreenshot(wakeHung as never);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(wakeBounded).resolves.toMatchObject({
      ok: false,
      error: 'webview host restore failed',
    });

    const metricsHung = {
      id: 101,
      hostWebContents: {
        isDestroyed: () => false,
        executeJavaScript: vi.fn().mockResolvedValue(true),
      },
    };
    const hungMetricsSend = vi.fn((method: string) => (
      method === 'Page.getLayoutMetrics'
        ? new Promise(() => undefined)
        : Promise.resolve({})
    ));
    cdp.withCdp.mockImplementationOnce(async (_wc, operation) => operation(hungMetricsSend));

    const metricsBounded = captureScreenshot(metricsHung as never);
    await vi.advanceTimersByTimeAsync(350);
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(metricsBounded).resolves.toMatchObject({
      ok: false,
      error: 'screenshot layout metrics timed out',
    });
  });

  it('scrolls a CSS-pixel grid, stitches bitmap rows, and restores page state', async () => {
    const wc = {
      id: 104,
      hostWebContents: {
        isDestroyed: () => false,
        executeJavaScript: vi.fn().mockResolvedValue(true),
      },
    };
    let tileNumber = 0;
    electron.createFromBuffer.mockImplementation(() => {
      tileNumber += 1;
      return {
        getSize: () => ({ width: 1_036, height: 670 }),
        getBitmap: () => Buffer.alloc(1_036 * 670 * 4, tileNumber),
      };
    });
    const scrollOffsets: Array<[number, number]> = [];
    const runtimeScripts: string[] = [];
    const send = vi.fn(async (method: string, params?: unknown) => {
      if (method === 'Page.getLayoutMetrics') {
        return {
          contentSize: { width: 1_800, height: 2_004 },
          visualViewport: { clientWidth: 1_036, clientHeight: 670 },
          cssContentSize: { width: 900, height: 1_002 },
          cssVisualViewport: { clientWidth: 518, clientHeight: 335 },
        };
      }
      if (method === 'Runtime.evaluate') {
        const expression = (params as { expression: string }).expression;
        runtimeScripts.push(expression);
        if (expression.includes("document.createElement('style')")) {
          return { result: { value: { x: 17, y: 23, dpr: 2 } } };
        }
        const match = expression.match(/window\.scrollTo\((\d+), (\d+)\)/);
        if (match) {
          const offset: [number, number] = [Number(match[1]), Number(match[2])];
          scrollOffsets.push(offset);
          return { result: { value: {
            x: offset[0], y: offset[1], width: 518, height: 335,
          } } };
        }
        return { result: { value: true } };
      }
      if (method === 'Page.captureScreenshot') {
        return { data: Buffer.from('png').toString('base64') };
      }
      return {};
    });
    cdp.withCdp.mockImplementation(async (_wc, operation) => operation(send));

    const capture = captureScreenshot(wc as never);
    await vi.advanceTimersByTimeAsync(350);
    const result = await capture;

    expect(result.ok).toBe(true);
    expect(scrollOffsets).toEqual([
      [0, 0], [382, 0], [0, 335], [382, 335], [0, 667], [382, 667],
    ]);
    expect(send.mock.calls.filter(([method]) => method === 'Page.captureScreenshot')).toHaveLength(6);
    expect(send.mock.calls.some(([method]) => method.startsWith('Emulation.'))).toBe(false);
    expect(runtimeScripts[0]).toContain('scroll-snap-type:none');
    expect(runtimeScripts[0]).toContain('::-webkit-scrollbar');
    expect(runtimeScripts.at(-1)).toContain('style?.remove()');
    expect(runtimeScripts.at(-1)).toContain('window.scrollTo(x, y)');
    expect(electron.createFromBitmap).toHaveBeenCalledTimes(1);
    const [bitmap, options] = electron.createFromBitmap.mock.calls[0];
    expect(options).toEqual({ width: 1_800, height: 2_004, scaleFactor: 1 });
    expect(bitmap[(0 * 1_800 + 0) * 4]).toBe(1);
    expect(bitmap[(0 * 1_800 + 800) * 4]).toBe(2);
    expect(bitmap[(700 * 1_800 + 0) * 4]).toBe(3);
    expect(bitmap[(1_900 * 1_800 + 1_000) * 4]).toBe(6);
    if (result.ok) await fs.rm(result.imagePath, { force: true });
  });

  it('restores scroll and injected style when a later tile fails', async () => {
    const wc = {
      id: 103,
      hostWebContents: {
        isDestroyed: () => false,
        executeJavaScript: vi.fn().mockResolvedValue(true),
      },
    };
    let runtimeCalls = 0;
    let captureCalls = 0;
    const runtimeScripts: string[] = [];
    const send = vi.fn(async (method: string, params?: unknown) => {
      if (method === 'Page.getLayoutMetrics') {
        return {
          contentSize: { width: 800, height: 1_200 },
          visualViewport: { clientWidth: 800, clientHeight: 600 },
        };
      }
      if (method === 'Runtime.evaluate') {
        runtimeCalls += 1;
        const expression = (params as { expression: string }).expression;
        runtimeScripts.push(expression);
        if (runtimeCalls === 1) return { result: { value: { x: 19, y: 29, dpr: 1 } } };
        return { result: { value: { x: 0, y: runtimeCalls === 2 ? 0 : 600,
          width: 800, height: 600 } } };
      }
      if (method === 'Page.captureScreenshot') {
        captureCalls += 1;
        if (captureCalls === 2) throw new Error('second tile failed');
        return { data: Buffer.from('png').toString('base64') };
      }
      return {};
    });
    cdp.withCdp.mockImplementation(async (_wc, operation) => operation(send));

    const capture = captureScreenshot(wc as never);
    await vi.advanceTimersByTimeAsync(350);
    await expect(capture).resolves.toMatchObject({
      ok: false,
      error: 'second tile failed',
    });
    expect(runtimeScripts.at(-1)).toContain('style?.remove()');
    expect(runtimeScripts.at(-1)).toContain('19');
    expect(runtimeScripts.at(-1)).toContain('29');
  });

  it('rejects an unbounded tile grid before mutating page state', async () => {
    const wc = {
      id: 105,
      hostWebContents: {
        isDestroyed: () => false,
        executeJavaScript: vi.fn().mockResolvedValue(true),
      },
    };
    const send = vi.fn(async (method: string) => {
      if (method === 'Page.getLayoutMetrics') return {
        contentSize: { width: 800, height: 8_000 },
        visualViewport: { clientWidth: 100, clientHeight: 100 },
      };
      return {};
    });
    cdp.withCdp.mockImplementation(async (_wc, operation) => operation(send));

    const capture = captureScreenshot(wc as never);
    await vi.advanceTimersByTimeAsync(350);
    await expect(capture).resolves.toMatchObject({
      ok: false,
      error: 'screenshot requires more than 16 tiles',
    });
    expect(send).not.toHaveBeenCalledWith('Runtime.evaluate', expect.anything());
  });

  it('rejects an extreme remote-page width without materializing an offset array', async () => {
    const wc = {
      id: 106,
      hostWebContents: {
        isDestroyed: () => false,
        executeJavaScript: vi.fn().mockResolvedValue(true),
      },
    };
    const send = vi.fn(async (method: string) => {
      if (method === 'Page.getLayoutMetrics') return {
        contentSize: { width: 1_000_000_000_000, height: 600 },
        visualViewport: { clientWidth: 800, clientHeight: 600 },
      };
      return {};
    });
    cdp.withCdp.mockImplementation(async (_wc, operation) => operation(send));

    const capture = captureScreenshot(wc as never);
    await vi.advanceTimersByTimeAsync(350);
    await expect(capture).resolves.toMatchObject({
      ok: false,
      error: 'screenshot width exceeds 4096 CSS pixels',
    });
    expect(send.mock.calls.map(([method]) => method)).toEqual(['Page.getLayoutMetrics']);
  });

  it('fails closed when page scrolling is clamped and would leave uncovered output', async () => {
    const wc = {
      id: 107,
      hostWebContents: {
        isDestroyed: () => false,
        executeJavaScript: vi.fn().mockResolvedValue(true),
      },
    };
    let runtimeCalls = 0;
    const send = vi.fn(async (method: string) => {
      if (method === 'Page.getLayoutMetrics') return {
        contentSize: { width: 800, height: 1_200 },
        visualViewport: { clientWidth: 800, clientHeight: 600 },
      };
      if (method === 'Runtime.evaluate') {
        runtimeCalls += 1;
        if (runtimeCalls === 1) return { result: { value: { x: 0, y: 0, dpr: 1 } } };
        if (runtimeCalls === 2) return { result: { value: { x: 0, y: 0, width: 800, height: 600 } } };
        if (runtimeCalls === 3) return { result: { value: { x: 0, y: 0, width: 800, height: 600 } } };
        return { result: { value: true } };
      }
      if (method === 'Page.captureScreenshot') {
        return { data: Buffer.from('png').toString('base64') };
      }
      return {};
    });
    cdp.withCdp.mockImplementation(async (_wc, operation) => operation(send));

    const capture = captureScreenshot(wc as never);
    await vi.advanceTimersByTimeAsync(350);
    await expect(capture).resolves.toMatchObject({
      ok: false,
      error: 'screenshot page did not reach the requested tile position',
    });
  });

  it('does not report success when host state cannot be restored', async () => {
    let hostCalls = 0;
    const wc = {
      id: 108,
      hostWebContents: {
        isDestroyed: () => false,
        executeJavaScript: vi.fn(async () => {
          hostCalls += 1;
          return hostCalls === 1;
        }),
      },
    };
    let runtimeCalls = 0;
    const send = vi.fn(async (method: string) => {
      if (method === 'Page.getLayoutMetrics') return layoutMetrics;
      if (method === 'Runtime.evaluate') {
        runtimeCalls += 1;
        return runtimeCalls === 1
          ? { result: { value: { x: 0, y: 0, dpr: 1 } } }
          : { result: { value: { x: 0, y: 0, width: 800, height: 600 } } };
      }
      if (method === 'Page.captureScreenshot') {
        return { data: Buffer.from('png').toString('base64') };
      }
      return {};
    });
    cdp.withCdp.mockImplementation(async (_wc, operation) => operation(send));

    const capture = captureScreenshot(wc as never);
    await vi.advanceTimersByTimeAsync(350);
    await expect(capture).resolves.toMatchObject({
      ok: false,
      error: 'webview host restore failed',
    });
  });
});
