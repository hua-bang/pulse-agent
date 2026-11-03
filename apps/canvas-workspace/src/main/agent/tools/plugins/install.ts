/**
 * `canvas_plugin_install`: the last step of the `create-canvas-plugin` skill.
 * The agent writes a plugin directory with its file tools, then calls this
 * tool to register it through the plugin market and read back diagnostics.
 *
 * Installation never enables native code. The chat card for this tool's
 * result gives the user the "Enable and open" button; the agent cannot
 * press it.
 */

import { BrowserWindow } from 'electron';
import { isAbsolute } from 'path';
import { z } from 'zod';
import {
  CANVAS_PLUGIN_INSTALL_TOOL,
  type CanvasPluginInstallReport,
  type NormalizedPluginPackage,
  type PluginPackageDiagnostic,
  type PulseCanvasPluginRenderer,
} from '../../../../shared/plugin-market';
import { getCanvasPluginLoadError } from '../../../../plugins/main';
import { readPluginPackage } from '../../../plugin-market/package-reader/reader';
import { getPluginMarketService } from '../../../plugin-market/service';
import type { CanvasTool } from '../types';

function rendererWarnings(
  renderer: PulseCanvasPluginRenderer | undefined,
  componentId: string,
): PluginPackageDiagnostic[] {
  if (!renderer) return [];
  const missing = [
    !renderer.entry && '`entry`',
    !(renderer.remoteName ?? renderer.name)?.trim() && '`remoteName`',
  ].filter(Boolean);
  if (missing.length === 0) return [];
  return [{
    severity: 'error',
    scope: 'pulse-extension',
    code: 'renderer.incomplete',
    message: `Renderer has no ${missing.join(' or ')}, so the host will not load it.`,
    componentId,
  }];
}

/** Problems the package reader accepts but that stop the renderer from loading. */
function loadWarnings(plugin: NormalizedPluginPackage): PluginPackageDiagnostic[] {
  const extension = plugin.pulseExtension;
  if (!extension) return [];
  return [
    ...rendererWarnings(extension.renderer, 'renderer'),
    ...extension.nodes.flatMap((node) => rendererWarnings(node.renderer, node.type)),
  ];
}

/** An enabled plugin whose main.mjs failed to load registers no handlers or tools. */
function mainLoadDiagnostics(plugin: NormalizedPluginPackage, nativeEnabled: boolean): PluginPackageDiagnostic[] {
  if (!nativeEnabled || !plugin.pulseExtension?.main) return [];
  const error = getCanvasPluginLoadError(plugin.name);
  if (!error) return [];
  return [{
    severity: 'error',
    scope: 'pulse-extension',
    code: 'main.load-failed',
    message: `main.mjs did not load, so its handlers and tools are missing: ${error}`,
    componentId: 'main',
  }];
}

/** The chat card already shows install status, so the reply only adds what the card cannot. */
const REPLY_GUIDE = ' Keep your reply to two or three sentences: what the plugin does, and the one thing the user '
  + 'should do next. Do not repeat the install status or list every feature.';

function nextStep(report: Omit<CanvasPluginInstallReport, 'nextStep'>): string {
  if (!report.ok) return 'Fix the errors in the diagnostics, then call canvas_plugin_install again.';
  if (!report.hasNativeCode) {
    return `Installed. The package has only skills or MCP servers, so it is active now.${REPLY_GUIDE}`;
  }
  if (!report.nativeEnabled) {
    return 'Installed with native code off. Tell the user to press "Enable and open" on the install card '
      + `in this chat. Do not ask them to open settings, and do not claim the plugin is running yet.${REPLY_GUIDE}`;
  }
  return 'Installed and already enabled: the card shows an Open button, so do not ask the user to enable it. '
    + 'The open app reloaded the changed plugin files. Tools from registerCanvasTool are live now, so you can '
    + `call them in this turn.${REPLY_GUIDE}`;
}

/** Tells every window to sync its renderer plugins, which hot-reloads changed ones. */
function notifyPluginsChanged(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('canvas-plugins:changed');
  }
}

async function installPluginDirectory(dir: string): Promise<CanvasPluginInstallReport> {
  const root = dir.trim();
  const base = { root, hasNativeCode: false, nativeEnabled: false };
  if (!isAbsolute(root)) {
    const report = { ...base, ok: false, diagnostics: [], error: 'dir must be an absolute path' };
    return { ...report, nextStep: nextStep(report) };
  }

  const read = await readPluginPackage(root);
  if (!read.package) {
    const report = { ...base, ok: false, diagnostics: read.diagnostics, error: 'Not an installable plugin package' };
    return { ...report, nextStep: nextStep(report) };
  }
  const plugin = read.package;
  const extension = plugin.pulseExtension;
  const result = await getPluginMarketService().installDirectory(plugin.root);
  if (result.ok) notifyPluginsChanged();
  const listing = result.snapshot?.listings.find(
    (entry) => entry.name === plugin.name && entry.installState === 'installed',
  );
  const extra = [...loadWarnings(plugin), ...mainLoadDiagnostics(plugin, listing?.nativeEnabled === true)];
  const report: Omit<CanvasPluginInstallReport, 'nextStep'> = {
    ok: result.ok && extra.length === 0,
    root: plugin.root,
    listingId: listing?.id,
    name: plugin.name,
    version: plugin.version,
    ...(plugin.description ? { description: plugin.description } : {}),
    hasNativeCode: Boolean(extension?.main || extension?.renderer || extension?.nodes.length),
    nativeEnabled: listing?.nativeEnabled === true,
    contents: {
      renderer: Boolean(extension?.renderer),
      main: Boolean(extension?.main),
      nodeTypes: extension?.nodes.map((node) => node.type) ?? [],
      skills: plugin.skills.map((skill) => skill.name),
      mcpServers: plugin.mcp?.servers.map((server) => server.name) ?? [],
    },
    diagnostics: [...(result.diagnostics ?? read.diagnostics), ...extra],
    ...(result.error ? { error: result.error } : {}),
  };
  return { ...report, nextStep: nextStep(report) };
}

export function createPluginInstallTools(): Record<string, CanvasTool> {
  return {
    [CANVAS_PLUGIN_INSTALL_TOOL]: {
      name: CANVAS_PLUGIN_INSTALL_TOOL,
      defer_loading: true,
      description:
        'Install or re-register a local Pulse Canvas plugin directory (a folder with plugin.json) and '
        + 'return JSON diagnostics: whether the package is valid, what it contains, and errors. '
        + 'Load the create-canvas-plugin skill before writing a plugin. Native code stays off until the '
        + 'user presses "Enable and open" on the card this tool shows in chat.',
      inputSchema: z.object({
        dir: z.string().min(1).describe('Absolute path of the plugin directory that holds plugin.json.'),
      }),
      execute: async (input: { dir: string }) => JSON.stringify(await installPluginDirectory(input.dir)),
    },
  };
}
