/**
 * IPC for the experimental-features registry.
 *
 * Persists user overrides at
 * `~/.pulse-coder/canvas/experimental-features.json` (override the path
 * with `PULSE_CANVAS_EXPERIMENTAL_FEATURES`). The renderer reads the
 * registered defs + the current resolved values via `experimental:list`,
 * toggles via `experimental:set`, and asks the host to reload after a
 * change via `experimental:reload-window` (changes only take effect on
 * the next preload run).
 */

import { BrowserWindow, ipcMain } from 'electron';
import { promises as fs } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import {
  EXPERIMENTAL_FEATURES,
  resolveFeatureValues,
} from '../shared/experimental-features';

function getPath(): string {
  const envPath = process.env.PULSE_CANVAS_EXPERIMENTAL_FEATURES?.trim();
  return envPath || join(homedir(), '.pulse-coder', 'canvas', 'experimental-features.json');
}

async function readOverrides(): Promise<Record<string, boolean>> {
  try {
    const raw = await fs.readFile(getPath(), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'boolean') out[k] = v;
    }
    return out;
  } catch (err: any) {
    if (err?.code === 'ENOENT') return {};
    throw err;
  }
}

async function writeOverrides(overrides: Record<string, boolean>): Promise<void> {
  const p = getPath();
  await fs.mkdir(dirname(p), { recursive: true });
  await fs.writeFile(p, `${JSON.stringify(overrides, null, 2)}\n`, 'utf8');
}

export function setupExperimentalIpc(): void {
  ipcMain.handle('experimental:list', async () => {
    try {
      const overrides = await readOverrides();
      return {
        ok: true,
        features: EXPERIMENTAL_FEATURES,
        values: resolveFeatureValues(overrides),
        path: getPath(),
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(
    'experimental:set',
    async (_event, payload: { id: string; enabled: boolean }) => {
      try {
        if (!payload || typeof payload.id !== 'string') {
          return { ok: false, error: 'Missing flag id' };
        }
        if (!EXPERIMENTAL_FEATURES.some((f) => f.id === payload.id)) {
          return { ok: false, error: `Unknown experimental feature: ${payload.id}` };
        }
        const overrides = await readOverrides();
        overrides[payload.id] = !!payload.enabled;
        await writeOverrides(overrides);
        return { ok: true, values: resolveFeatureValues(overrides) };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle('experimental:reset', async () => {
    try {
      await writeOverrides({});
      return { ok: true, values: resolveFeatureValues({}) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Trigger a hard reload of the renderer that originated the call.
  // Preload re-runs on reload, so the new flag values flow into
  // `pluginFlags` and plugin `enabledWhen` re-evaluates.
  ipcMain.handle('experimental:reload-window', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      win.webContents.reloadIgnoringCache();
      return { ok: true };
    }
    return { ok: false, error: 'No window to reload' };
  });
}
