import { describe, it, expect, afterAll, vi } from 'vitest';
import { promises as fs } from 'fs';

// Shared mutable state for the electron mock. `vi.hoisted` runs above the
// imports that `vi.mock` factories close over, so the mock reads live values
// each test can set.
const h = vi.hoisted(() => {
  const base = process.env.TMPDIR || process.env.TEMP || '/tmp';
  const trailing = base.endsWith('/') ? '' : '/';
  return {
    storeDir: `${base}${trailing}canvas-screenshot-test-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`,
    state: {
      win: null as any,
      windowSources: [] as any[],
      screenSources: [] as any[],
      displays: [{ id: 'D1', size: { width: 100, height: 100 }, scaleFactor: 1 }] as any[],
      screenStatus: 'granted' as string,
    },
  };
});

vi.mock('electron', () => ({
  desktopCapturer: {
    getSources: async (opts: { types?: string[] }) =>
      opts.types?.includes('window') ? h.state.windowSources : h.state.screenSources,
  },
  screen: {
    getPrimaryDisplay: () => h.state.displays[0],
    getAllDisplays: () => h.state.displays,
  },
  systemPreferences: {
    getMediaAccessStatus: () => h.state.screenStatus,
  },
  // window-manager.getCanvasWindow() reaches for these.
  BrowserWindow: {
    getFocusedWindow: () => h.state.win,
    getAllWindows: () => (h.state.win ? [h.state.win] : []),
  },
}));

// Isolate from the real ~/.pulse-coder/canvas tree; the tool only needs STORE_DIR.
vi.mock('../_shared/canvas-io', () => ({ STORE_DIR: h.storeDir }));

import { createScreenshotTools } from '../screenshot';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // "‰PNG" header bytes

function nativeImage(png: Buffer, width = 8, height = 8) {
  return {
    toPNG: () => png,
    getSize: () => ({ width, height }),
    isEmpty: () => png.length === 0,
  };
}

function run(input: Record<string, unknown>): Promise<string> {
  return createScreenshotTools('ws-1').canvas_screenshot.execute(input);
}

afterAll(async () => {
  await fs.rm(h.storeDir, { recursive: true, force: true }).catch(() => undefined);
});

describe('canvas_screenshot', () => {
  it('captures this app window (target: "app") via capturePage and writes a PNG', async () => {
    let shown = false;
    h.state.win = {
      isVisible: () => true,
      isMinimized: () => false,
      isDestroyed: () => false,
      showInactive: () => {
        shown = true;
      },
      getTitle: () => 'Pulse Canvas',
      webContents: { capturePage: async () => nativeImage(PNG, 800, 600) },
    };

    const payload = JSON.parse(await run({ target: 'app' }));
    expect(payload).toMatchObject({
      ok: true,
      type: 'screenshot',
      target: 'app',
      title: 'Pulse Canvas',
      mimeType: 'image/png',
      width: 800,
      height: 600,
    });
    expect(payload.outputPath).toMatch(/canvas-window-\d+\.png$/);
    expect(shown).toBe(false); // already visible → not re-shown
    await expect(fs.readFile(payload.outputPath)).resolves.toEqual(PNG);
  });

  it('shows a hidden window before capturing it', async () => {
    let shown = false;
    h.state.win = {
      isVisible: () => false,
      isMinimized: () => true,
      isDestroyed: () => false,
      showInactive: () => {
        shown = true;
      },
      getTitle: () => 'Pulse Canvas',
      webContents: { capturePage: async () => nativeImage(PNG) },
    };
    const payload = JSON.parse(await run({ target: 'app' }));
    expect(payload.ok).toBe(true);
    expect(shown).toBe(true);
  });

  it('errors clearly when no canvas window is open', async () => {
    h.state.win = null;
    const out = await run({ target: 'app' });
    expect(out).toMatch(/Error:.*window is not open/);
  });

  it('captures a display (target: "screen", the default)', async () => {
    h.state.displays = [{ id: 'D7', size: { width: 120, height: 90 }, scaleFactor: 2 }];
    h.state.screenSources = [
      { id: 'screen:0:0', name: 'Entire Screen', display_id: 'D7', thumbnail: nativeImage(PNG, 240, 180) },
    ];
    const payload = JSON.parse(await run({}));
    expect(payload).toMatchObject({
      ok: true,
      type: 'screenshot',
      target: 'screen',
      title: 'Entire Screen',
      display: 0,
      mimeType: 'image/png',
    });
    expect(payload.outputPath).toMatch(/screen-\d+\.png$/);
  });

  it('lists open windows when target "window" is given without a match', async () => {
    h.state.windowSources = [
      { id: 'w1', name: 'Figma — Untitled', thumbnail: nativeImage(PNG) },
      { id: 'w2', name: 'Google Chrome', thumbnail: nativeImage(PNG) },
    ];
    const out = await run({ target: 'window' });
    expect(out).toContain('pass "match"');
    expect(out).toContain('Figma — Untitled');
    expect(out).toContain('Google Chrome');
  });

  it('captures the window whose title matches (case-insensitive)', async () => {
    h.state.windowSources = [
      { id: 'w1', name: 'Figma — Untitled', thumbnail: nativeImage(PNG, 50, 40) },
      { id: 'w2', name: 'Google Chrome', thumbnail: nativeImage(PNG, 50, 40) },
    ];
    const payload = JSON.parse(await run({ target: 'window', match: 'chrome' }));
    expect(payload).toMatchObject({ ok: true, target: 'window', title: 'Google Chrome', mimeType: 'image/png' });
  });

  it('errors with the window list when nothing matches', async () => {
    h.state.windowSources = [{ id: 'w1', name: 'Figma', thumbnail: nativeImage(PNG) }];
    const out = await run({ target: 'window', match: 'no-such-window' });
    expect(out).toMatch(/no open window title contains "no-such-window"/);
    expect(out).toContain('Figma');
  });
});
