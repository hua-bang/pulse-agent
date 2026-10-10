import { BrowserWindow, dialog, type OpenDialogOptions } from 'electron';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { basename, isAbsolute, join, relative, resolve } from 'path';
import type {
  NormalizedPluginPackage,
  PluginMarketListing,
  PluginMarketMutationResult,
  PluginMarketSnapshot,
  PluginMarketSource,
  PluginPackageDiagnostic,
} from '../../shared/plugin-market';
import {
  addCanvasPluginDirectoryWithNativePolicy,
  addCanvasPluginDirectoryWithoutNativePolicy,
  getCanvasPluginExplicitNativePolicySync,
  getCanvasPluginNativePolicySync,
  getCanvasPluginsStatus,
  removeCanvasPluginDirectory,
  setCanvasPluginNativePolicy,
} from './config';
import { getPluginMarketAgentPort } from './agent-port';
import { connectPackageMcp, packageMcpAuthState } from './mcp/mcp-connection';
import { reloadConfiguredExternalMainPlugins } from '../../plugins/main';
import { PUBLIC_PLUGIN_CATALOG } from './catalog';
import { writePluginMcpAdapter } from './mcp/mcp-adapter';
import { readPluginPackage } from './package-reader/reader';
import {
  type InstalledPluginRecord,
  pluginMarketPackagesDir,
  readPluginMarketState,
  runPluginMarketMutation,
  writePluginMarketState,
} from './store';
import { installGitSource } from './git/git-install';
import { replaceInstalledPackage } from './package-update';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function safeDirectoryName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'plugin';
}
function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 10);
}
function linkedListingId(root: string): string {
  return `linked:${shortHash(resolve(root))}`;
}
function personalListingId(plugin: NormalizedPluginPackage, source: PluginMarketSource): string {
  return `personal:${plugin.name}:${shortHash(JSON.stringify(source))}`;
}

function isContained(root: string, target: string): boolean {
  const child = relative(root, target);
  return child === '' || (!child.startsWith('..') && !isAbsolute(child));
}

async function refreshRuntime(): Promise<void> {
  await reloadConfiguredExternalMainPlugins();
  await getPluginMarketAgentPort().reloadMcp();
}

async function listingFromPackage(
  record: InstalledPluginRecord,
  plugin: NormalizedPluginPackage,
): Promise<PluginMarketListing> {
  return {
    id: record.listingId,
    name: plugin.name,
    description: plugin.description ?? 'Installed Agent Plugin package.',
    version: plugin.version,
    author: plugin.author,
    license: plugin.license,
    category: 'Installed',
    featured: false,
    visibility: 'personal',
    sourceFormat: plugin.format,
    source: record.source,
    iconKey: plugin.pulseExtension ? 'pulse' : plugin.format === 'agent-plugin' ? 'plugin' : 'puzzle',
    capabilities: {
      skillCount: plugin.skills.length,
      mcpServerCount: plugin.mcp?.servers.length ?? 0,
      hasPulseExtension: Boolean(plugin.pulseExtension),
    },
    installState: 'installed',
    mcpAuthState: await packageMcpAuthState(plugin),
    nativeEnabled: getCanvasPluginNativePolicySync(record.root, record.format),
  };
}
async function snapshot(): Promise<PluginMarketSnapshot> {
  const [state, canvasStatus] = await Promise.all([
    readPluginMarketState(),
    getCanvasPluginsStatus(),
  ]);
  const recordsByListing = new Map(state.plugins.map((record) => [record.listingId, record]));
  const registeredRoots = new Set(canvasStatus.pluginDirs.map((root) => resolve(root)));
  const listings: PluginMarketListing[] = await Promise.all(PUBLIC_PLUGIN_CATALOG.map(async (entry) => {
    const record = recordsByListing.get(entry.id);
    let installed: PluginMarketListing | undefined;
    if (record && registeredRoots.has(record.root)) {
      const result = await readPluginPackage(record.root);
      if (result.package) installed = await listingFromPackage(record, result.package);
    }
    return {
      ...entry,
      ...(installed ? {
        version: installed.version,
        source: installed.source,
        capabilities: installed.capabilities,
      } : {}),
      installState: record && registeredRoots.has(record.root) ? 'installed' : entry.installState,
      mcpAuthState: installed?.mcpAuthState,
      nativeEnabled: record
        ? getCanvasPluginNativePolicySync(record.root, record.format)
        : undefined,
    };
  }));

  const publicIds = new Set(PUBLIC_PLUGIN_CATALOG.map((entry) => entry.id));
  const recordedRoots = new Set(state.plugins.map((record) => record.root));
  for (const record of state.plugins) {
    if (publicIds.has(record.listingId)) continue;
    const result = await readPluginPackage(record.root);
    if (result.package) {
      listings.push(await listingFromPackage(record, result.package));
    } else {
      listings.push({
        id: record.listingId,
        name: record.packageName,
        description: 'The installed package could not be read.',
        category: 'Installed',
        featured: false,
        visibility: 'personal',
        sourceFormat: record.format,
        source: record.source,
        iconKey: 'warning',
        capabilities: { skillCount: 0, mcpServerCount: 0, hasPulseExtension: false },
        installState: 'installed',
        nativeEnabled: getCanvasPluginNativePolicySync(record.root, record.format),
        error: result.diagnostics.map((item) => item.message).join('; '),
      });
    }
  }

  for (const plugin of canvasStatus.plugins) {
    if (recordedRoots.has(resolve(plugin.dir))) continue;
    const format = plugin.manifestPath.endsWith('plugin.json')
      ? 'agent-plugin'
      : 'legacy-canvas';
    listings.push({
      id: linkedListingId(plugin.dir),
      name: plugin.id === 'unknown' ? basename(plugin.dir) : plugin.id,
      description: plugin.error ?? 'Linked from the advanced Canvas plugin settings.',
      version: plugin.version,
      category: 'Installed',
      featured: false,
      visibility: 'personal',
      sourceFormat: format,
      source: { kind: 'directory', path: plugin.dir },
      iconKey: 'puzzle',
      capabilities: {
        skillCount: plugin.skills?.length ?? 0,
        mcpServerCount: 0,
        hasPulseExtension: Boolean(plugin.main || plugin.nodes.length > 0),
      },
      installState: 'installed',
      nativeEnabled: getCanvasPluginNativePolicySync(plugin.dir, format),
      error: plugin.error,
    });
  }
  return { listings, updatedAt: Date.now() };
}
function operationWarning(code: string, message: string): PluginPackageDiagnostic {
  return { severity: 'warning', scope: 'package', code, message };
}
async function committedResult(
  diagnostics: PluginPackageDiagnostic[] = [],
): Promise<PluginMarketMutationResult> {
  const combined = [...diagnostics];
  try {
    await refreshRuntime();
  } catch (error) {
    const message = `Plugin change was saved, but runtime refresh failed: ${errorMessage(error)}`;
    console.warn('[plugin-market]', message);
    combined.push(operationWarning('runtime.refresh-failed', message));
  }
  try {
    return {
      ok: true,
      snapshot: await snapshot(),
      ...(combined.length > 0 ? { diagnostics: combined } : {}),
    };
  } catch (error) {
    const message = `Plugin change was saved, but the market snapshot failed: ${errorMessage(error)}`;
    combined.push(operationWarning('snapshot.refresh-failed', message));
    return { ok: true, diagnostics: combined, error: message };
  }
}
async function restoreCanvasRegistration(
  root: string,
  registered: boolean,
  explicitPolicy: boolean | undefined,
): Promise<void> {
  if (!registered) {
    await removeCanvasPluginDirectory(root);
  } else if (explicitPolicy === undefined) {
    await addCanvasPluginDirectoryWithoutNativePolicy(root);
  } else {
    await addCanvasPluginDirectoryWithNativePolicy(root, explicitPolicy);
  }
}
async function persistPackage(
  listingId: string,
  source: PluginMarketSource,
  plugin: NormalizedPluginPackage,
  managed: boolean,
  diagnostics: PluginPackageDiagnostic[] = [],
): Promise<PluginMarketMutationResult> {
  const state = await readPluginMarketState();
  const listingRecord = state.plugins.find((record) => record.listingId === listingId);
  if (listingRecord && listingRecord.root !== plugin.root) {
    return { ok: false, diagnostics, error: 'Plugin listing is already installed from another location' };
  }
  const existing = state.plugins.find((record) => record.root === plugin.root);
  const canvasStatus = await getCanvasPluginsStatus();
  const duplicateName = state.plugins.some(
    (record) => record.packageName === plugin.name && record.root !== plugin.root,
  ) || canvasStatus.plugins.some(
    (entry) => entry.id === plugin.name && resolve(entry.dir) !== plugin.root,
  );
  if (duplicateName) {
    return {
      ok: false,
      diagnostics,
      error: `A plugin named ${plugin.name} is already installed from another location`,
    };
  }
  if (existing) {
    await addCanvasPluginDirectoryWithNativePolicy(existing.root, existing.nativeEnabled);
    return committedResult(diagnostics);
  }
  const registered = canvasStatus.pluginDirs.some((root) => resolve(root) === plugin.root);
  const previousPolicy = getCanvasPluginExplicitNativePolicySync(plugin.root);
  const runtimeMcpPath = await writePluginMcpAdapter(listingId, plugin);
  const record: InstalledPluginRecord = {
    listingId,
    packageName: plugin.name,
    root: plugin.root,
    source,
    format: plugin.format,
    managed,
    nativeEnabled: false,
    installedAt: Date.now(),
    runtimeMcpPath,
  };
  try {
    // Config is the execution SSOT: registration and fail-closed policy land atomically.
    await addCanvasPluginDirectoryWithNativePolicy(plugin.root, false);
    await writePluginMarketState({ version: 1, plugins: [...state.plugins, record] });
  } catch (error) {
    await restoreCanvasRegistration(plugin.root, registered, previousPolicy).catch((rollbackError) => {
      console.error('[plugin-market] failed to restore Canvas plugin config:', rollbackError);
    });
    if (runtimeMcpPath) await fs.rm(runtimeMcpPath, { force: true }).catch(() => undefined);
    throw error;
  }
  return committedResult(diagnostics);
}
function mutate(
  operation: () => Promise<PluginMarketMutationResult>,
): Promise<PluginMarketMutationResult> {
  return runPluginMarketMutation(async () => {
    try {
      return await operation();
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  });
}
export class PluginMarketService {
  async list(): Promise<PluginMarketSnapshot> {
    return snapshot();
  }

  async refresh(): Promise<PluginMarketSnapshot> {
    return snapshot();
  }
  async install(listingId: string): Promise<PluginMarketMutationResult> {
    return mutate(async () => {
      const listing = PUBLIC_PLUGIN_CATALOG.find((entry) => entry.id === listingId);
      if (!listing) return { ok: false, error: 'Plugin listing was not found' };
      if (listing.installState === 'unsupported') {
        return { ok: false, source: listing.source, error: 'This source needs a client-format adapter before installation' };
      }
      return installGitSource(listing.source, () => listing.id, persistPackage);
    });
  }
  async chooseDirectory(): Promise<PluginMarketMutationResult> {
    return mutate(async () => {
      const options: OpenDialogOptions = {
        title: 'Select Agent Plugin Directory',
        properties: ['openDirectory'],
      };
      const window = BrowserWindow.getFocusedWindow();
      const result = window
        ? await dialog.showOpenDialog(window, options)
        : await dialog.showOpenDialog(options);
      if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true };
      const root = result.filePaths[0];
      const read = await readPluginPackage(root);
      if (!read.package) {
        return { ok: false, diagnostics: read.diagnostics, error: 'Selected directory is not an installable plugin package' };
      }
      const source: PluginMarketSource = { kind: 'directory', path: read.package.root };
      return persistPackage(
        personalListingId(read.package, source), source, read.package, false, read.diagnostics,
      );
    });
  }
  async addGit(source: PluginMarketSource): Promise<PluginMarketMutationResult> {
    return mutate(() => installGitSource(source, personalListingId, persistPackage));
  }
  async update(listingId: string): Promise<PluginMarketMutationResult> {
    return mutate(async () => {
      const state = await readPluginMarketState();
      const record = state.plugins.find((entry) => entry.listingId === listingId);
      if (!record || !record.managed || record.source.kind !== 'git') {
        return { ok: false, error: 'Only installed Git plugins can be updated' };
      }
      return installGitSource(record.source, () => record.listingId, async (
        _id, _source, plugin, _managed, diagnostics,
      ) => {
        if (diagnostics.some((item) => item.severity === 'error')) {
          return { ok: false, diagnostics, error: 'Updated plugin package failed validation' };
        }
        if (plugin.name !== record.packageName || plugin.format !== record.format) {
          return { ok: false, error: 'Updated plugin identity does not match the installed package' };
        }
        if (plugin.root === record.root) {
          return { ok: true, updateStatus: 'unchanged', snapshot: await snapshot() };
        }
        const nativeDisabled = Boolean(plugin.pulseExtension)
          && getCanvasPluginNativePolicySync(record.root, record.format);
        await replaceInstalledPackage(record, plugin);
        return { ...await committedResult(diagnostics), updateStatus: 'updated', nativeDisabled };
      });
    });
  }
  async uninstall(listingId: string): Promise<PluginMarketMutationResult> {
    return mutate(async () => {
      const state = await readPluginMarketState();
      const record = state.plugins.find((entry) => entry.listingId === listingId);
      if (!record) {
        const status = await getCanvasPluginsStatus();
        const linked = status.plugins.find((plugin) => linkedListingId(plugin.dir) === listingId);
        if (!linked) return { ok: false, error: 'Installed plugin was not found' };
        await removeCanvasPluginDirectory(linked.dir);
        return committedResult();
      }
      const status = await getCanvasPluginsStatus();
      const registered = status.pluginDirs.some((root) => resolve(root) === record.root);
      const previousPolicy = getCanvasPluginExplicitNativePolicySync(record.root);
      try {
        await removeCanvasPluginDirectory(record.root);
        await writePluginMarketState({
          version: 1,
          plugins: state.plugins.filter((entry) => entry.listingId !== listingId),
        });
      } catch (error) {
        await restoreCanvasRegistration(record.root, registered, previousPolicy).catch((rollbackError) => {
          console.error('[plugin-market] failed to restore Canvas plugin config:', rollbackError);
        });
        throw error;
      }
      const diagnostics: PluginPackageDiagnostic[] = [];
      if (record.managed) {
        const packagesRoot = resolve(pluginMarketPackagesDir());
        const target = resolve(record.root);
        if (target !== packagesRoot && isContained(packagesRoot, target)) {
          try {
            await fs.rm(target, { recursive: true, force: true });
          } catch (error) {
            diagnostics.push(operationWarning(
              'package.cleanup-failed',
              `Plugin was uninstalled, but managed files remain: ${errorMessage(error)}`,
            ));
          }
        }
      }
      return committedResult(diagnostics);
    });
  }
  async connectMcp(listingId: string): Promise<PluginMarketMutationResult> {
    return mutate(async () => {
      const state = await readPluginMarketState();
      const record = state.plugins.find((entry) => entry.listingId === listingId);
      if (!record) return { ok: false, error: 'Installed plugin was not found' };
      const result = await readPluginPackage(record.root);
      if (!result.package) {
        return { ok: false, diagnostics: result.diagnostics, error: 'Installed plugin package is invalid' };
      }
      await connectPackageMcp(result.package);
      return committedResult(result.diagnostics);
    });
  }
  async setNativeEnabled(listingId: string, enabled: boolean): Promise<PluginMarketMutationResult> {
    return mutate(async () => {
      const state = await readPluginMarketState();
      const index = state.plugins.findIndex((entry) => entry.listingId === listingId);
      if (index < 0) return { ok: false, error: 'Installed plugin was not found' };
      const record = state.plugins[index];
      const previousPolicy = getCanvasPluginNativePolicySync(record.root, record.format);
      const plugins = [...state.plugins];
      plugins[index] = { ...record, nativeEnabled: enabled };
      try {
        await setCanvasPluginNativePolicy(record.root, enabled);
        await writePluginMarketState({ version: 1, plugins });
      } catch (error) {
        await setCanvasPluginNativePolicy(record.root, previousPolicy).catch((rollbackError) => {
          console.error('[plugin-market] failed to restore native policy:', rollbackError);
        });
        throw error;
      }
      return committedResult();
    });
  }
}
let service: PluginMarketService | undefined;
export function getPluginMarketService(): PluginMarketService {
  service ??= new PluginMarketService();
  return service;
}

export { assertManagedPackageTree, normalizedGitSource } from './git/git-source';
