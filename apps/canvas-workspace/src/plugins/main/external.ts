import { pathToFileURL } from 'node:url';
import type { CanvasPluginEntry } from '../../shared/settings-config';
import { getCanvasPluginsStatus } from '../../main/settings/canvas-plugins-config';
import type { MainCanvasPlugin } from '../types';
import { deactivateCanvasPlugin, setupCanvasPlugins } from './registry';

type PluginModule = Record<string, unknown>;

const activeExternalPluginIds = new Set<string>();

export async function loadConfiguredExternalMainPlugins(): Promise<MainCanvasPlugin[]> {
  const status = await getCanvasPluginsStatus();
  return loadExternalMainPluginEntries(status.plugins);
}

export async function reloadConfiguredExternalMainPlugins(): Promise<void> {
  const status = await getCanvasPluginsStatus();
  const plugins = await loadExternalMainPluginEntries(status.plugins);
  const expectedIds = new Set(plugins.map((plugin) => plugin.id));
  for (const id of Array.from(activeExternalPluginIds)) {
    if (!expectedIds.has(id)) {
      await deactivateCanvasPlugin(id);
      activeExternalPluginIds.delete(id);
    }
  }

  const activated = await setupCanvasPlugins(plugins);
  for (const id of activated) activeExternalPluginIds.add(id);
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
      const moduleUrl = pathToFileURL(entry.main.entry).href;
      const mod = await import(moduleUrl) as PluginModule;
      const plugin = pickMainPluginExport(mod);
      if (!plugin) {
        console.warn(
          `[canvas-plugins] skipping ${entry.id}: main entry did not export a valid plugin`,
        );
        continue;
      }
      if (plugin.id !== entry.id) {
        console.warn(
          `[canvas-plugins] skipping ${entry.id}: main export id "${plugin.id}" does not match manifest id`,
        );
        continue;
      }
      plugins.push(plugin);
    } catch (err) {
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
