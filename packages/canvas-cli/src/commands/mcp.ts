import type { Command } from 'commander';
import { runCanvasMcpStdio } from '../mcp/server';
import { errorOutput } from '../output';
import { getRootOptions } from './options';

export function registerMcpCommand(program: Command): void {
  program
    .command('mcp')
    .description('Run the Pulse Canvas MCP server (with the canvas MCP App view) over stdio')
    .option('--plugin-api <version>', 'Plugin API version the launching agent plugin expects')
    .action(async function (this: Command, opts: { pluginApi?: string }) {
      const { storeDir } = getRootOptions(this);
      const pluginApi = opts.pluginApi === undefined ? undefined : Number(opts.pluginApi);
      if (pluginApi !== undefined && (!Number.isInteger(pluginApi) || pluginApi < 1)) {
        errorOutput(`Invalid --plugin-api: ${opts.pluginApi}`, { code: 'invalid_argument' });
      }
      let root: Command = this;
      while (root.parent) root = root.parent;
      // stdout carries the MCP protocol; diagnostics must only go to stderr.
      await runCanvasMcpStdio({ storeDir, pluginApi, version: root.version() ?? '0.0.0' });
    });
}
