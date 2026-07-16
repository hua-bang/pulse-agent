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
import { promises as fs, readFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import {
  EXPERIMENTAL_FEATURES,
  EXPERIMENTAL_FLAG_AGENT_TEAMS,
  EXPERIMENTAL_FLAG_DEFAULT_BROWSER,
  resolveFeatureValues,
} from '../../shared/experimental-features';
import { runInstall } from '../files/skill-installer';
import { setDefaultBrowser } from '../default-browser/register';

function getPath(): string {
  const envPath = process.env.PULSE_CANVAS_EXPERIMENTAL_FEATURES?.trim();
  return envPath || join(homedir(), '.pulse-coder', 'canvas', 'experimental-features.json');
}

function normaliseOverrides(parsed: unknown): Record<string, boolean> {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}

async function readOverrides(): Promise<Record<string, boolean>> {
  try {
    const raw = await fs.readFile(getPath(), 'utf8');
    return normaliseOverrides(JSON.parse(raw));
  } catch (err: any) {
    if (err?.code === 'ENOENT') return {};
    throw err;
  }
}

// Synchronous variant used by the sandboxed preload via ipcRenderer.sendSync.
// Preload can't import `fs` itself in sandbox mode, so the file read has to
// happen here. Errors swallow to defaults — preload bootstrap must never
// throw or the renderer loses access to the entire canvasWorkspace bridge.
export function readOverridesSync(): Record<string, boolean> {
  try {
    const raw = readFileSync(getPath(), 'utf8');
    return normaliseOverrides(JSON.parse(raw));
  } catch {
    return {};
  }
}

/**
 * Synchronously resolve a single experimental flag from the persisted
 * overrides file, falling back to the registered default. Use this from
 * main-side modules that need to gate behaviour on a flag the user
 * toggled in Settings, without going through the renderer.
 *
 * Cheap (small JSON read, swallowed on error), so callers may invoke it
 * per-event without caching. That keeps the flag reactive to Settings
 * toggles + window reloads, where the main process keeps running.
 */
export function getExperimentalFlagSync(id: string): boolean {
  return resolveFeatureValues(readOverridesSync())[id] === true;
}

async function writeOverrides(overrides: Record<string, boolean>): Promise<void> {
  const p = getPath();
  await fs.mkdir(dirname(p), { recursive: true });
  await fs.writeFile(p, `${JSON.stringify(overrides, null, 2)}\n`, 'utf8');
}

export function setupExperimentalIpc(): void {
  // Sync channel for preload — must be `ipcMain.on` with event.returnValue
  // (not ipcMain.handle, which is async-only). Returns the resolved flag
  // map; preload exposes it as `window.canvasWorkspace.pluginFlags`.
  ipcMain.on('experimental:read-sync', (event) => {
    event.returnValue = resolveFeatureValues(readOverridesSync());
  });

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
    async (event, payload: { id: string; enabled: boolean }) => {
      try {
        if (!payload || typeof payload.id !== 'string') {
          return { ok: false, error: 'Missing flag id' };
        }
        if (!EXPERIMENTAL_FEATURES.some((f) => f.id === payload.id)) {
          return { ok: false, error: `Unknown experimental feature: ${payload.id}` };
        }
        const overrides = await readOverrides();
        const wasEnabled = resolveFeatureValues(overrides)[payload.id] === true;
        overrides[payload.id] = !!payload.enabled;
        await writeOverrides(overrides);

        // Default-browser is a live OS registration, not a load-time gate:
        // apply it immediately on toggle (the OS may still prompt the user to
        // confirm the switch in System Settings).
        if (payload.id === EXPERIMENTAL_FLAG_DEFAULT_BROWSER) {
          try {
            const status = setDefaultBrowser(!!payload.enabled);
            console.log(
              `[experimental] default-browser ${payload.enabled ? 'register' : 'unregister'} requested (isDefault=${status.isDefault})`,
            );
          } catch (err) {
            console.warn('[experimental] default-browser registration failed', err);
          }
        }

        // When Agent Teams is turned on (off→on), install the latest canvas
        // skill + CLI in the background. Experimental/dev-only: skill files
        // land in the global skill dirs and the CLI is built + `pnpm link`-ed.
        // Fire-and-forget so the toggle stays responsive; the manual
        // Settings → Agent button re-runs the same routine with full feedback.
        if (
          payload.id === EXPERIMENTAL_FLAG_AGENT_TEAMS &&
          payload.enabled &&
          !wasEnabled
        ) {
          const sender = event.sender;
          const pushStatus = (status: {
            ok: boolean;
            skillsInstalled: boolean;
            cliInstalled: boolean;
            cliError?: string | null;
            manualCommand?: string | null;
          }) => {
            if (!sender.isDestroyed()) {
              sender.send('experimental:tooling-status', { feature: payload.id, ...status });
            }
          };
          void runInstall()
            .then((result) => {
              if (!result.skillsInstalled) {
                console.warn('[experimental] agent-teams skill install incomplete', result.results);
              }
              if (!result.cliInstalled) {
                console.warn(
                  `[experimental] agent-teams CLI install skipped/failed: ${result.cliError ?? 'unknown'}. Run manually: ${result.manualCommand}`,
                );
              } else {
                console.log('[experimental] agent-teams skill + CLI installed');
              }
              pushStatus({
                ok: result.ok,
                skillsInstalled: result.skillsInstalled,
                cliInstalled: result.cliInstalled,
                cliError: result.cliError,
                manualCommand: result.manualCommand,
              });
            })
            .catch((err) => {
              console.error('[experimental] agent-teams tooling install errored', err);
              pushStatus({
                ok: false,
                skillsInstalled: false,
                cliInstalled: false,
                cliError: err instanceof Error ? err.message : String(err),
                manualCommand: null,
              });
            });
        }

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
