import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', setName: () => {} },
  ipcMain: { handle: () => {} },
  BrowserWindow: class {},
  nativeTheme: { shouldUseDarkColors: false },
  screen: { getAllDisplays: () => [] },
  shell: {},
}));

import { resolveWindowPlacement } from '../window';

const display = { x: 0, y: 0, width: 1920, height: 1080 };

describe('resolveWindowPlacement', () => {
  it('uses the 1200×800 default when nothing usable was saved', () => {
    expect(resolveWindowPlacement(null, [display])).toEqual({ width: 1200, height: 800, maximized: false });
    expect(resolveWindowPlacement({ width: 'wide', x: Number.NaN }, [display])).toEqual({
      width: 1200,
      height: 800,
      maximized: false,
    });
  });

  it('restores a saved frame that is on a display, with its maximized state', () => {
    expect(resolveWindowPlacement({ x: 100, y: 50, width: 1400, height: 900, maximized: true }, [display])).toEqual({
      x: 100,
      y: 50,
      width: 1400,
      height: 900,
      maximized: true,
    });
  });

  it('centres a frame left on a display that is gone, and fits the size', () => {
    expect(resolveWindowPlacement({ x: 2500, y: 100, width: 3000, height: 400 }, [display])).toEqual({
      width: 1920,
      height: 600,
      maximized: false,
    });
  });

  it('keeps a frame that is mostly off screen when enough of it is visible', () => {
    const placement = resolveWindowPlacement({ x: 1700, y: 900, width: 1200, height: 800 }, [display]);
    expect(placement).toMatchObject({ x: 1700, y: 900 });
    expect(resolveWindowPlacement({ x: 1850, y: 1060, width: 1200, height: 800 }, [display]).x).toBeUndefined();
  });
});
