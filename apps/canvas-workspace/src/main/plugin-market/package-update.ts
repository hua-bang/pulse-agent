import { promises as fs } from 'fs';
import { basename } from 'path';
import type { NormalizedPluginPackage } from '../../shared/plugin-market';
import { getCanvasPluginExplicitNativePolicySync, getCanvasPluginsStatus, updateCanvasPluginsConfig } from './config';
import { writePluginMcpAdapter } from './mcp/mcp-adapter';
import { RetainedGitPackageError } from './git/git-install';
import { readPluginMarketState, writePluginMarketState, type InstalledPluginRecord } from './store';

/** Commit a validated snapshot without deleting the old package or its data. */
export async function replaceInstalledPackage(
  record: InstalledPluginRecord,
  plugin: NormalizedPluginPackage,
): Promise<void> {
  const state = await readPluginMarketState();
  const status = await getCanvasPluginsStatus();
  if (status.plugins.some((entry) => entry.id === plugin.name && entry.dir !== record.root)) {
    throw new Error(`A plugin named ${plugin.name} is already installed from another location`);
  }
  const wasRegistered = status.pluginDirs.includes(record.root);
  let oldPolicy = getCanvasPluginExplicitNativePolicySync(record.root);
  const runtimeMcpPath = await writePluginMcpAdapter(record.listingId, plugin, basename(plugin.root));
  try {
    // New native code requires an explicit enable action. Config and data retain
    // their package/listing keys, while the adapter uses a separate revision.
    await updateCanvasPluginsConfig((config) => {
      const policy = { ...config.pluginNativePolicy };
      oldPolicy = policy[record.root];
      delete policy[record.root];
      return {
        ...config,
        pluginDirs: [...(config.pluginDirs ?? []).filter((root) => root !== record.root), plugin.root],
        pluginNativePolicy: { ...policy, [plugin.root]: false },
      };
    });
    await writePluginMarketState({
      ...state,
      plugins: state.plugins.map((entry) => entry.listingId === record.listingId
        ? { ...entry, root: plugin.root, nativeEnabled: false, runtimeMcpPath }
        : entry),
    });
  } catch (error) {
    // Restore registration before the caller discards the failed new snapshot.
    try {
      await updateCanvasPluginsConfig((config) => {
        const policy = { ...config.pluginNativePolicy };
        delete policy[plugin.root];
        if (oldPolicy !== undefined) policy[record.root] = oldPolicy;
        return {
          ...config,
          pluginDirs: [
            ...(config.pluginDirs ?? []).filter((root) => root !== plugin.root && root !== record.root),
            ...(wasRegistered ? [record.root] : []),
          ],
          pluginNativePolicy: policy,
        };
      });
    } catch (rollbackError) {
      throw new RetainedGitPackageError(
        `Plugin update failed (${String(error)}); registration could not be restored (${String(rollbackError)}). Both snapshots were retained.`,
      );
    }
    if (runtimeMcpPath) await fs.rm(runtimeMcpPath, { force: true });
    throw error;
  }
}
