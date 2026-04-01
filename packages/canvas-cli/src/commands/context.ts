import { Command } from 'commander';
import { generateContext, formatContextAsText } from '../core/context';
import { output, errorOutput, type OutputFormat } from '../output';

export function registerContextCommand(program: Command): void {
  program
    .command('context')
    .argument('<workspaceId>', 'Workspace ID')
    .description('Generate canvas context for agent consumption')
    .action(async function (this: Command, workspaceId: string) {
      const root = this.parent;
      const opts = root?.opts() ?? {};
      const format: OutputFormat = opts.format ?? 'text';
      const storeDir: string | undefined = opts.storeDir;

      const ctx = await generateContext(workspaceId, storeDir);
      if (!ctx) errorOutput(`Workspace not found: ${workspaceId}`);

      output(ctx, format, (data) => formatContextAsText(data as NonNullable<typeof ctx>));
    });
}
