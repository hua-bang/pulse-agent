import { promises as fs } from 'fs';
import type { Command } from 'commander';
import { applyPlan, type ApplyReport, type CanvasPlan } from '../core/apply';
import { getWorkspaceCommandOptions } from './options';
import { output, errorOutput } from '../output';

async function readPlanSource(file: string): Promise<string> {
  if (file === '-') {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString('utf-8');
  }
  return fs.readFile(file, 'utf-8');
}

function formatApplyText(data: unknown): string {
  const { data: r } = data as { data: ApplyReport };
  const lines: string[] = [];
  lines.push(
    `${r.dryRun ? '[dry-run] ' : ''}Workspace ${r.workspaceId}: ` +
    `${r.created.length} created, ${r.updated.length} updated, ${r.deleted.length} deleted, ` +
    `${r.edgesCreated.length} edge(s) created, ${r.edgesDeleted.length + r.prunedEdges.length} edge(s) removed.`,
  );
  if (r.created.length) lines.push(`- created: ${r.created.join(', ')}`);
  if (r.deleted.length) lines.push(`- deleted: ${r.deleted.join(', ')}`);
  if (r.prunedEdges.length) lines.push(`- edges pruned with deleted nodes: ${r.prunedEdges.join(', ')}`);
  lines.push(r.dryRun
    ? `Nothing written. Current revision: ${r.revision ?? 'none'}.`
    : `Saved atomically. Revision is now ${r.revision ?? 'unknown'}.`);
  return lines.join('\n');
}

export function registerApplyCommand(program: Command): void {
  program
    .command('apply')
    .description(
      'Apply a batch of canvas mutations atomically from a plan file: one lock, one save, '
      + 'all-or-nothing. Plan JSON: { workspace?, baseRevision?, operations: [{action: '
      + '"create"|"update"|"delete"|"createEdge"|"deleteEdge", ...}] }. baseRevision enables '
      + 'optimistic concurrency against other CLI writers; --dry-run validates without writing.',
    )
    .requiredOption('--file <path>', 'plan JSON file, or "-" for stdin')
    .option('--dry-run', 'validate the whole plan and report without writing')
    .action(async (opts: { file: string; dryRun?: boolean }, cmd: Command) => {
      const wopts = await getWorkspaceCommandOptions(cmd);
      let plan: CanvasPlan;
      try {
        plan = JSON.parse(await readPlanSource(opts.file)) as CanvasPlan;
      } catch (err) {
        errorOutput(`Cannot read plan: ${(err as Error).message}`, { code: 'invalid_argument' });
      }
      const result = await applyPlan(wopts.workspace, plan, {
        dryRun: opts.dryRun === true,
        storeDir: wopts.storeDir,
        confineToWorkspace: wopts.confineToWorkspace,
      });
      if (!result.ok) errorOutput(result.error, { code: result.code ?? 'error' });
      output({ ok: true, data: result.data }, wopts.format, formatApplyText);
    });
}
