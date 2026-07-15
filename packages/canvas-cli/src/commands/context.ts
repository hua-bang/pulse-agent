import { Command } from 'commander';
import { generateContext, formatContextAsText } from '../core/context';
import { output, errorOutput } from '../output';
import { getWorkspaceCommandOptions } from './options';

export function registerContextCommand(program: Command): void {
  program
    .command('context')
    .description('Generate canvas context for agent consumption')
    .action(async function (this: Command) {
      const { format, storeDir, workspace } = await getWorkspaceCommandOptions(this);

      const ctx = await generateContext(workspace, storeDir);
      if (!ctx) errorOutput(`Workspace not found: ${workspace}`);

      output(ctx, format, (data) => formatContextAsText(data as NonNullable<typeof ctx>));
    });
}
