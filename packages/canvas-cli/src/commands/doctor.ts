import type { Command } from 'commander';
import { runDoctor, type DoctorReport } from '../core/doctor';
import { getWorkspaceCommandOptions } from './options';
import { output, errorOutput } from '../output';

function formatDoctorText(data: unknown): string {
  const { data: report } = data as { data: DoctorReport };
  const lines: string[] = [];
  lines.push(
    `Workspace ${report.workspaceId} (v${report.schemaVersion}): ` +
    `${report.checkedNodes} nodes, ${report.checkedEdges} edges checked`,
  );
  if (report.findings.length === 0) {
    lines.push('No inconsistencies found.');
    return lines.join('\n');
  }
  for (const f of report.findings) {
    const status = f.repaired ? 'repaired' : f.repairable ? 'repairable' : 'report-only';
    lines.push(`- [${f.kind}] (${status}) ${f.detail}`);
  }
  lines.push(
    `${report.findings.length} finding(s): ${report.repairedCount} repaired, ` +
    `${report.repairableCount - report.repairedCount} repairable, ` +
    `${report.findings.length - report.repairableCount} report-only.`,
  );
  if (report.repairedCount === 0 && report.repairableCount > 0) {
    lines.push('Run again with --repair to apply fixes (markdown wins on content drift).');
  }
  return lines.join('\n');
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description(
      'Check a workspace for storage inconsistencies: markdown vs data.content drift, '
      + 'missing/orphan/unreadable per-node files, dangling edges, empty bodies, stale tmp '
      + 'artifacts. With --repair, applies safe fixes: markdown wins on drift, orphan node '
      + 'files are adopted back onto the canvas (never deleted), dangling edges are removed.',
    )
    .option('--repair', 'apply safe repairs (default is report-only)')
    .action(async (opts: { repair?: boolean }, cmd: Command) => {
      const wopts = await getWorkspaceCommandOptions(cmd);
      try {
        const report = await runDoctor(wopts.workspace, {
          repair: opts.repair === true,
          storeDir: wopts.storeDir,
        });
        output({ ok: true, data: report }, wopts.format, formatDoctorText);
      } catch (err) {
        errorOutput(`doctor failed: ${(err as Error).message}`, { code: 'io_error' });
      }
    });
}
