import { resolve } from 'path';
import { Command } from 'commander';

import { callRuntimeCapability } from '../core/runtime-capabilities';
import { errorOutput, output } from '../output';
import { getWorkspaceCommandOptions } from './options';

/** Installing reads the package and may write an MCP adapter; allow more than a page read. */
const INSTALL_TIMEOUT_MS = 30_000;

/**
 * Plugin authoring for coding agents outside Pulse Canvas. Both commands are
 * thin adapters over the running app's `plugins.guide` and `plugins.install`
 * capabilities, so the guide and the install path stay the app's own.
 */
export function registerPluginCommands(program: Command): void {
  const plugin = program
    .command('plugin')
    .description('Write and install Pulse Canvas plugins (needs the running app)');

  plugin.command('guide')
    .description('Print the guide for writing a Pulse Canvas plugin')
    .action(async function (this: Command) {
      const { format, workspace } = await getWorkspaceCommandOptions(this, { requireReadableCanvas: false });
      const result = await callRuntimeCapability({ workspaceId: workspace, name: 'plugins.guide', input: {} });
      if (!result.ok) errorOutput(result.error.message, { code: result.error.code });
      output(result.value, format, (data) => (data as { guide: string }).guide);
    });

  plugin.command('install')
    .argument('[dir]', 'Plugin folder that holds plugin.json', '.')
    .description('Install or reload a local plugin folder and print its diagnostics')
    .action(async function (this: Command, dir: string) {
      const { format, workspace } = await getWorkspaceCommandOptions(this, { requireReadableCanvas: false });
      const result = await callRuntimeCapability({
        workspaceId: workspace,
        name: 'plugins.install',
        input: { dir: resolve(dir) },
        transportTimeoutMs: INSTALL_TIMEOUT_MS,
      });
      if (!result.ok) errorOutput(result.error.message, { code: result.error.code });
      output(result.value, format, (data) => JSON.stringify(data, null, 2));
    });
}
