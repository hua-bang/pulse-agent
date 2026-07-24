import type { Command } from 'commander';
import {
  readLayout,
  validateLayout,
  applyFrameGrid,
  type LayoutSummary,
  type LayoutValidation,
  type FrameGridResult,
} from '../core/layout';
import { getWorkspaceCommandOptions } from './options';
import { output, errorOutput } from '../output';
import type { Result } from '../core/types';

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) errorOutput(result.error, { code: result.code ?? 'error' });
  return result.data;
}

function formatReadText(data: unknown): string {
  const { data: s } = data as { data: LayoutSummary };
  const lines: string[] = [];
  const b = s.bounds;
  lines.push(
    `Workspace ${s.workspaceId}: ${s.nodeCount} nodes, ${s.edgeCount} edges` +
    (b ? `, bounds ${Math.round(b.width)}x${Math.round(b.height)} at (${Math.round(b.x)}, ${Math.round(b.y)}), ratio ${s.aspectRatio}` : ' (empty)'),
  );
  for (const f of s.frames) {
    lines.push(`- frame ${f.id} "${f.title}" ${Math.round(f.width)}x${Math.round(f.height)} at (${Math.round(f.x)}, ${Math.round(f.y)}): ${f.childIds.length} children [${f.childIds.join(', ')}]`);
  }
  if (s.freeNodes.length > 0) {
    lines.push(`- free nodes: ${s.freeNodes.map(n => `${n.id} (${n.type})`).join(', ')}`);
  }
  return lines.join('\n');
}

function formatValidateText(data: unknown): string {
  const { data: v } = data as { data: LayoutValidation };
  if (v.ok) return `Workspace ${v.workspaceId}: layout OK (${v.checkedNodes} nodes checked).`;
  const lines = [`Workspace ${v.workspaceId}: ${v.issues.length} layout issue(s)` + (v.truncated ? ' (overlap list truncated)' : '')];
  for (const issue of v.issues) lines.push(`- [${issue.kind}] ${issue.detail}`);
  lines.push('Fix with `layout frame-grid --frame <id>` per frame, or move the listed nodes, then validate again.');
  return lines.join('\n');
}

function formatFrameGridText(data: unknown): string {
  const { data: r } = data as { data: FrameGridResult };
  return `Arranged ${r.movedCount} node(s) in frame ${r.frameId}; frame is now ${Math.round(r.frame.width)}x${Math.round(r.frame.height)}.`;
}

export function registerLayoutCommands(program: Command): void {
  const layout = program
    .command('layout')
    .description('Read, validate, and arrange canvas geometry (agent-friendly layout toolset)');

  layout
    .command('read')
    .description('Summarize board geometry: bounds, aspect ratio, frames with their contained children, free nodes')
    .action(async (_opts: Record<string, never>, cmd: Command) => {
      const wopts = await getWorkspaceCommandOptions(cmd);
      const data = unwrap(await readLayout(wopts.workspace, wopts.storeDir));
      output({ ok: true, data }, wopts.format, formatReadText);
    });

  layout
    .command('validate')
    .description('Check for stacked nodes, frame straddling/overflow, unreadably narrow cards, and extreme board aspect ratio')
    .action(async (_opts: Record<string, never>, cmd: Command) => {
      const wopts = await getWorkspaceCommandOptions(cmd);
      const data = unwrap(await validateLayout(wopts.workspace, wopts.storeDir));
      output({ ok: true, data }, wopts.format, formatValidateText);
    });

  layout
    .command('frame-grid')
    .description('Arrange a frame\'s children into a row-wrapped grid (children keep their sizes) and fit the frame around them')
    .requiredOption('--frame <id>', 'frame node id to arrange')
    .option('--columns <n>', 'grid columns (default: ceil(sqrt(children)))', v => parseInt(v, 10))
    .option('--gap <px>', 'gap between children (default 16)', v => parseInt(v, 10))
    .option('--padding <px>', 'inner frame padding (default 24)', v => parseInt(v, 10))
    .option('--no-fit-frame', 'keep the frame\'s current size instead of hugging the grid')
    .action(
      async (
        opts: { frame: string; columns?: number; gap?: number; padding?: number; fitFrame?: boolean },
        cmd: Command,
      ) => {
        const wopts = await getWorkspaceCommandOptions(cmd);
        const data = unwrap(
          await applyFrameGrid(
            wopts.workspace,
            opts.frame,
            {
              columns: opts.columns,
              gap: opts.gap,
              padding: opts.padding,
              fitFrame: opts.fitFrame,
            },
            wopts.storeDir,
          ),
        );
        output({ ok: true, data }, wopts.format, formatFrameGridText);
      },
    );
}
