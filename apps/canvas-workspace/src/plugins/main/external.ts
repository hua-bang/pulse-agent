import { statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { CanvasPluginEntry } from '../../shared/settings-config';
import { getCanvasPluginsStatus } from '../../main/plugin-market/config';
import type { MainCanvasPlugin } from '../types';
import { deactivateCanvasPlugin, recordCanvasPluginLoadError, setupCanvasPlugins } from './registry';

type PluginModule = Record<string, unknown>;

/** Active external plugin id -> version of the main entry it loaded. */
const activeExternalPlugins = new Map<string, string>();

/**
 * The entry file's mtime. It goes into the import URL so a changed file
 * loads as a new module instead of the cached one. Only the entry file is
 * versioned: modules it imports stay cached until restart.
 */
function mainEntryVersion(entry: CanvasPluginEntry): string {
  if (!entry.main) return '';
  try {
    return String(statSync(entry.main.entry).mtimeMs);
  } catch {
    return '';
  }
}

/**
 * Bring the active main plugins in line with the plugin config. A plugin
 * whose main entry changed on disk is deactivated and loaded again, so an
 * edit takes effect without an app restart.
 */
export async function reloadConfiguredExternalMainPlugins(): Promise<void> {
  const status = await getCanvasPluginsStatus();
  const versions = new Map(
    status.plugins.filter((entry) => entry.main).map((entry) => [entry.id, mainEntryVersion(entry)]),
  );
  for (const [id, version] of Array.from(activeExternalPlugins)) {
    if (versions.get(id) !== version) {
      await deactivateCanvasPlugin(id);
      activeExternalPlugins.delete(id);
    }
  }

  const plugins = await loadExternalMainPluginEntries(
    status.plugins.filter((entry) => !activeExternalPlugins.has(entry.id)),
  );
  const activated = await setupCanvasPlugins(plugins);
  for (const id of activated) activeExternalPlugins.set(id, versions.get(id) ?? '');
}

export async function loadExternalMainPluginEntries(
  entries: CanvasPluginEntry[],
): Promise<MainCanvasPlugin[]> {
  const plugins: MainCanvasPlugin[] = [];

  for (const entry of entries) {
    if (!entry.main) continue;
    if (entry.main.runtime && entry.main.runtime !== 'electron-main') {
      console.warn(
        `[canvas-plugins] skipping ${entry.id}: unsupported main runtime "${entry.main.runtime}"`,
      );
      continue;
    }
    if (entry.main.format && entry.main.format !== 'esm') {
      console.warn(
        `[canvas-plugins] skipping ${entry.id}: unsupported main format "${entry.main.format}"`,
      );
      continue;
    }

    try {
      const version = mainEntryVersion(entry);
      const moduleUrl = `${pathToFileURL(entry.main.entry).href}${version ? `?v=${version}` : ''}`;
      const mod = await import(moduleUrl) as PluginModule;
      const plugin = pickMainPluginExport(mod);
      if (!plugin) {
        recordCanvasPluginLoadError(entry.id, 'main entry did not export a plugin with an id and an activate function');
        console.warn(
          `[canvas-plugins] skipping ${entry.id}: main entry did not export a valid plugin`,
        );
        continue;
      }
      if (plugin.id !== entry.id) {
        recordCanvasPluginLoadError(entry.id, `main export id "${plugin.id}" does not match the plugin name "${entry.id}"`);
        console.warn(
          `[canvas-plugins] skipping ${entry.id}: main export id "${plugin.id}" does not match manifest id`,
        );
        continue;
      }
      plugins.push(plugin);
    } catch (err) {
      recordCanvasPluginLoadError(entry.id, err);
      console.error(`[canvas-plugins] failed to load external main plugin ${entry.id}`, err);
    }
  }

  return plugins;
}

function pickMainPluginExport(mod: PluginModule): MainCanvasPlugin | null {
  for (const candidate of [
    mod.default,
    mod.plugin,
    mod.main,
    mod.MainPlugin,
  ]) {
    if (isMainCanvasPlugin(candidate)) return candidate;
  }
  return null;
}

function isMainCanvasPlugin(value: unknown): value is MainCanvasPlugin {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as MainCanvasPlugin).id === 'string' &&
    typeof (value as MainCanvasPlugin).activate === 'function'
  );
}
