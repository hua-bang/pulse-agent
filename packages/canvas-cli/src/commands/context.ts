import { Command } from 'commander';
import { generateContext, formatContextAsText } from '../core/context';
import { output, errorOutput } from '../output';
import { getWorkspaceCommandOptions } from './options';

export function registerContextCommand(program: Command): void {
  program
    .command('context')
    .option('--types <list>', 'Comma-separated node types to include (e.g. file,text,iframe)')
    .description('Generate canvas context for agent consumption')
    .action(async function (this: Command, cmdOpts: { types?: string }) {
      const { format, storeDir, workspace, confineToWorkspace } = await getWorkspaceCommandOptions(this);

      const types = cmdOpts.types
        ? cmdOpts.types.split(',').map(t => t.trim()).filter(Boolean)
        : undefined;

      const ctx = await generateContext(workspace, storeDir, { confineToWorkspace, types });
      if (!ctx) errorOutput(`Workspace not found: ${workspace}`, { code: 'workspace_not_found' });

      output(ctx, format, (data) => formatContextAsText(data as NonNullable<typeof ctx>));
    });
}
