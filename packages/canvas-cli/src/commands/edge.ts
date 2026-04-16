import { Command } from 'commander';
import { loadCanvas } from '../core/store';
import { createEdge, deleteEdge, listEdges } from '../core/edges';
import { output, errorOutput, type OutputFormat } from '../output';
import type { EdgeAnchor, EdgeArrowCap, EdgeStroke } from '../core/types';

function getOpts(cmd: Command): { format: OutputFormat; storeDir?: string; workspace: string } {
  const root = cmd.parent?.parent ?? cmd.parent;
  const opts = root?.opts() ?? {};
  const workspace = opts.workspace as string | undefined;
  if (!workspace) {
    errorOutput('Workspace ID required. Use --workspace <id> or set $PULSE_CANVAS_WORKSPACE_ID');
  }
  return { format: opts.format ?? 'text', storeDir: opts.storeDir, workspace: workspace! };
}

export function registerEdgeCommands(program: Command): void {
  const edge = program
    .command('edge')
    .description('Manage canvas edges (connections between nodes)');

  edge.command('list')
    .description('List all edges in the workspace')
    .action(async function (this: Command) {
      const { format, storeDir, workspace } = getOpts(this);

      const edges = await listEdges(workspace, storeDir);

      output(edges, format, (data) => {
        const items = data as typeof edges;
        if (items.length === 0) return 'No edges found.';
        const lines = items.map(e => {
          const src = e.source.kind === 'node' ? e.source.nodeId : `(${e.source.x},${e.source.y})`;
          const tgt = e.target.kind === 'node' ? e.target.nodeId : `(${e.target.x},${e.target.y})`;
          const label = e.label ? ` "${e.label}"` : '';
          const kind = e.kind ? ` [${e.kind}]` : '';
          return `  ${e.id}  ${src} → ${tgt}${label}${kind}`;
        });
        return `Edges:\n${lines.join('\n')}`;
      });
    });

  edge.command('create')
    .requiredOption('--from <nodeId>', 'Source node ID')
    .requiredOption('--to <nodeId>', 'Target node ID')
    .option('--label <text>', 'Edge label')
    .option('--kind <kind>', 'Semantic tag (e.g. dependency, flow, context)')
    .option('--from-anchor <anchor>', 'Source anchor: top, right, bottom, left, auto')
    .option('--to-anchor <anchor>', 'Target anchor: top, right, bottom, left, auto')
    .option('--arrow-head <cap>', 'Arrow head: none, triangle, arrow, dot, bar')
    .option('--arrow-tail <cap>', 'Arrow tail: none, triangle, arrow, dot, bar')
    .option('--color <hex>', 'Stroke color (hex)')
    .option('--width <n>', 'Stroke width in pixels', parseFloat)
    .option('--style <style>', 'Stroke style: solid, dashed, dotted')
    .option('--bend <n>', 'Curve offset in pixels (0 = straight)', parseFloat)
    .description('Create a new edge between two nodes')
    .action(async function (this: Command, cmdOpts: {
      from: string;
      to: string;
      label?: string;
      kind?: string;
      fromAnchor?: string;
      toAnchor?: string;
      arrowHead?: string;
      arrowTail?: string;
      color?: string;
      width?: number;
      style?: string;
      bend?: number;
    }) {
      const { format, storeDir, workspace } = getOpts(this);

      const validAnchors: EdgeAnchor[] = ['top', 'right', 'bottom', 'left', 'auto'];
      if (cmdOpts.fromAnchor && !validAnchors.includes(cmdOpts.fromAnchor as EdgeAnchor)) {
        errorOutput(`Invalid --from-anchor "${cmdOpts.fromAnchor}". Must be: ${validAnchors.join(', ')}`);
      }
      if (cmdOpts.toAnchor && !validAnchors.includes(cmdOpts.toAnchor as EdgeAnchor)) {
        errorOutput(`Invalid --to-anchor "${cmdOpts.toAnchor}". Must be: ${validAnchors.join(', ')}`);
      }

      const validCaps: EdgeArrowCap[] = ['none', 'triangle', 'arrow', 'dot', 'bar'];
      if (cmdOpts.arrowHead && !validCaps.includes(cmdOpts.arrowHead as EdgeArrowCap)) {
        errorOutput(`Invalid --arrow-head "${cmdOpts.arrowHead}". Must be: ${validCaps.join(', ')}`);
      }
      if (cmdOpts.arrowTail && !validCaps.includes(cmdOpts.arrowTail as EdgeArrowCap)) {
        errorOutput(`Invalid --arrow-tail "${cmdOpts.arrowTail}". Must be: ${validCaps.join(', ')}`);
      }

      const validStyles = ['solid', 'dashed', 'dotted'] as const;
      if (cmdOpts.style && !validStyles.includes(cmdOpts.style as typeof validStyles[number])) {
        errorOutput(`Invalid --style "${cmdOpts.style}". Must be: ${validStyles.join(', ')}`);
      }

      const stroke: EdgeStroke | undefined =
        (cmdOpts.color || cmdOpts.width || cmdOpts.style)
          ? {
              color: cmdOpts.color,
              width: cmdOpts.width,
              style: cmdOpts.style as EdgeStroke['style'],
            }
          : undefined;

      const result = await createEdge(workspace, {
        sourceNodeId: cmdOpts.from,
        targetNodeId: cmdOpts.to,
        sourceAnchor: cmdOpts.fromAnchor as EdgeAnchor | undefined,
        targetAnchor: cmdOpts.toAnchor as EdgeAnchor | undefined,
        label: cmdOpts.label,
        kind: cmdOpts.kind,
        arrowHead: cmdOpts.arrowHead as EdgeArrowCap | undefined,
        arrowTail: cmdOpts.arrowTail as EdgeArrowCap | undefined,
        stroke,
        bend: cmdOpts.bend,
      }, storeDir);

      if (!result.ok) errorOutput(result.error);

      output(result.data, format, (d) => {
        const r = d as { edgeId: string };
        return `Created edge: ${r.edgeId}  (${cmdOpts.from} → ${cmdOpts.to})`;
      });
    });

  edge.command('delete')
    .argument('<edgeId>', 'Edge ID')
    .description('Delete a canvas edge')
    .action(async function (this: Command, edgeId: string) {
      const { format, storeDir, workspace } = getOpts(this);

      const result = await deleteEdge(workspace, edgeId, storeDir);
      if (!result.ok) errorOutput(result.error);

      output({ deleted: edgeId }, format, () => `Deleted edge: ${edgeId}`);
    });
}
