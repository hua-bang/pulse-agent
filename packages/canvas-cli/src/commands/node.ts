import { promises as fs } from 'fs';
import { Command } from 'commander';
import { loadCanvas, getWorkspaceDir } from '../core/store';
import {
  getNodeCapabilities,
  readNode,
  writeNode,
  createNode,
  deleteNode,
  updateNode,
  searchNodes,
} from '../core/nodes';
import { output, errorOutput } from '../output';
import { getWorkspaceCommandOptions } from './options';
import type { CreatableNodeType } from '../core/types';

/**
 * Interpret common escape sequences in a CLI --content argument.
 *
 * Shells and agent tool invocations deliver `\n`, `\t`, etc. as literal
 * backslash-letter pairs in argv. Writing those verbatim into a file node
 * yields content like `# Title\n\n## Section` instead of real line breaks.
 * This helper unescapes the standard sequences so `--content "a\nb"` behaves
 * the way users expect. Pass `--raw` to opt out.
 */
export function unescapeContentArg(s: string): string {
  return s.replace(/\\(n|r|t|\\|"|'|`)/g, (_, c: string) => {
    switch (c) {
      case 'n': return '\n';
      case 'r': return '\r';
      case 't': return '\t';
      case '\\': return '\\';
      case '"': return '"';
      case "'": return "'";
      case '`': return '`';
      default: return c;
    }
  });
}

/** Human-readable rendering of a single `readNode` result (text format). */
function renderNodeText(d: Record<string, unknown>): string {
  if (d.type === 'file') return String(d.content ?? '');
  if (d.type === 'text') return String(d.content ?? '');
  if (d.type === 'terminal') return `Terminal (cwd: ${d.cwd ?? 'unknown'})\n${d.scrollback ?? ''}`;
  if (d.type === 'frame' || d.type === 'group') {
    const label = d.type === 'frame' ? 'Frame' : 'Group';
    return `${label}: ${d.label || '(no label)'}  color: ${d.color ?? ''}`;
  }
  if (d.type === 'agent') {
    return `Agent [${d.agentType ?? 'unknown'}] (${d.status ?? 'idle'})\ncwd: ${d.cwd ?? 'unknown'}\n${d.scrollback ?? ''}`;
  }
  return JSON.stringify(d, null, 2);
}

export function registerNodeCommands(program: Command): void {
  const node = program
    .command('node')
    .description('Manage canvas nodes');

  node.command('list')
    .option('--type <type>', 'Only list nodes of this type')
    .description('List all nodes in the workspace')
    .action(async function (this: Command, cmdOpts: { type?: string }) {
      const { format, storeDir, workspace } = await getWorkspaceCommandOptions(this);
      const canvas = await loadCanvas(workspace, storeDir);
      if (!canvas) errorOutput(`Workspace not found: ${workspace}`, { code: 'workspace_not_found' });

      const selected = cmdOpts.type
        ? canvas!.nodes.filter(n => n.type === cmdOpts.type)
        : canvas!.nodes;

      const rows = selected.map(n => ({
        id: n.id,
        type: n.type,
        title: n.title,
        capabilities: getNodeCapabilities(n.type),
      }));

      output(rows, format, (data) => {
        const items = data as typeof rows;
        if (items.length === 0) return 'No nodes found.';
        const lines = items.map(r =>
          `  ${r.id}  [${r.type}]  ${r.title}  (${r.capabilities.join(', ')})`
        );
        return `Nodes:\n${lines.join('\n')}`;
      });
    });

  node.command('search')
    .argument('<query>', 'Case-insensitive text to find in node titles and content')
    .option('--type <type>', 'Restrict to a node type')
    .option('--limit <n>', 'Max results', (v) => parseInt(v, 10))
    .description('Find nodes by title/content without reading each one')
    .action(async function (this: Command, query: string, cmdOpts: { type?: string; limit?: number }) {
      const { format, storeDir, workspace } = await getWorkspaceCommandOptions(this);
      const canvas = await loadCanvas(workspace, storeDir);
      if (!canvas) errorOutput(`Workspace not found: ${workspace}`, { code: 'workspace_not_found' });

      const hits = searchNodes(canvas!.nodes, query, { type: cmdOpts.type, limit: cmdOpts.limit });

      output(hits, format, (data) => {
        const items = data as typeof hits;
        if (items.length === 0) return `No nodes match "${query}".`;
        const lines = items.map(h => `  ${h.id}  [${h.type}]  ${h.title}\n    …${h.snippet}…`);
        return `Matches for "${query}":\n${lines.join('\n')}`;
      });
    });

  node.command('read')
    .argument('<nodeId...>', 'Node ID(s) — pass several to batch-read')
    .description('Read one or more canvas nodes (single id → object, multiple → array)')
    .action(async function (this: Command, nodeIds: string[]) {
      const { format, storeDir, workspace, confineToWorkspace } = await getWorkspaceCommandOptions(this);
      const canvas = await loadCanvas(workspace, storeDir);
      if (!canvas) errorOutput(`Workspace not found: ${workspace}`, { code: 'workspace_not_found' });

      const confineToDir = confineToWorkspace ? getWorkspaceDir(workspace, storeDir) : undefined;

      // Single id keeps the historical single-object shape (and hard-errors on
      // a miss). Multiple ids return an array; a missing id becomes a per-entry
      // error so a batch caller still gets every node it can.
      if (nodeIds.length === 1) {
        const canvasNode = canvas!.nodes.find(n => n.id === nodeIds[0]);
        if (!canvasNode) errorOutput(`Node not found: ${nodeIds[0]}`, { code: 'node_not_found' });
        const result = await readNode(canvasNode!, { confineToDir });
        output(result, format, (data) => renderNodeText(data as Record<string, unknown>));
        return;
      }

      const results = await Promise.all(nodeIds.map(async (id) => {
        const n = canvas!.nodes.find(x => x.id === id);
        if (!n) return { id, error: `Node not found: ${id}`, code: 'node_not_found' as const };
        return { id, ...(await readNode(n, { confineToDir })) };
      }));

      output(results, format, (data) => {
        const items = data as Array<Record<string, unknown>>;
        return items
          .map(d => `## ${d.id}\n${d.error ? `(error: ${d.error})` : renderNodeText(d)}`)
          .join('\n\n');
      });
    });

  node.command('write')
    .argument('<nodeId>', 'Node ID')
    .option('--content <text>', 'Content to write (interprets \\n, \\r, \\t, \\\\ escape sequences; use --raw to disable, or --file/stdin for literal content)')
    .option('--file <path>', 'Read content from file')
    .option('--raw', 'Treat --content verbatim without interpreting escape sequences', false)
    .description('Write content to a canvas node')
    .action(async function (this: Command, nodeId: string, cmdOpts: { content?: string; file?: string; raw?: boolean }) {
      const { format, storeDir, workspace, confineToWorkspace } = await getWorkspaceCommandOptions(this);

      let content: string;
      if (cmdOpts.content !== undefined) {
        content = cmdOpts.raw ? cmdOpts.content : unescapeContentArg(cmdOpts.content);
      } else if (cmdOpts.file) {
        try {
          content = await fs.readFile(cmdOpts.file, 'utf-8');
        } catch (err) {
          errorOutput(`Cannot read file: ${cmdOpts.file} — ${String(err)}`, { code: 'io_error' });
        }
      } else if (!process.stdin.isTTY) {
        // Read from stdin
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) {
          chunks.push(chunk as Buffer);
        }
        content = Buffer.concat(chunks).toString('utf-8');
      } else {
        errorOutput('Provide content via --content, --file, or stdin', { code: 'invalid_argument' });
      }

      const result = await writeNode(workspace, nodeId, content!, storeDir, { confineToWorkspace });
      if (!result.ok) errorOutput(result.error, { code: result.code ?? 'error' });

      output({ ok: true }, format, () => 'OK');
    });

  node.command('create')
    .requiredOption('--type <type>', 'Node type: file, terminal, frame, group, agent, mindmap')
    .option('--title <title>', 'Node title')
    .option('--x <n>', 'X position on canvas', parseFloat)
    .option('--y <n>', 'Y position on canvas', parseFloat)
    .option('--width <n>', 'Node width', parseFloat)
    .option('--height <n>', 'Node height', parseFloat)
    .option('--data <json>', 'Initial data as JSON')
    .description('Create a new canvas node')
    .action(async function (this: Command, cmdOpts: { type: string; title?: string; x?: number; y?: number; width?: number; height?: number; data?: string }) {
      const { format, storeDir, workspace } = await getWorkspaceCommandOptions(this);

      const validTypes: CreatableNodeType[] = ['file', 'terminal', 'frame', 'group', 'agent', 'mindmap'];
      if (!validTypes.includes(cmdOpts.type as CreatableNodeType)) {
        errorOutput(`Invalid type "${cmdOpts.type}". Must be: ${validTypes.join(', ')}`, { code: 'invalid_argument' });
      }

      let data: Record<string, unknown> | undefined;
      if (cmdOpts.data) {
        try {
          data = JSON.parse(cmdOpts.data) as Record<string, unknown>;
        } catch {
          errorOutput('--data must be valid JSON', { code: 'invalid_argument' });
        }
      }

      const result = await createNode(workspace, {
        type: cmdOpts.type as CreatableNodeType,
        title: cmdOpts.title,
        x: cmdOpts.x,
        y: cmdOpts.y,
        width: cmdOpts.width,
        height: cmdOpts.height,
        data,
      }, storeDir);

      if (!result.ok) errorOutput(result.error, { code: result.code ?? 'error' });

      if (cmdOpts.type === 'terminal') {
        console.error('Note: Terminal nodes created via CLI have no active PTY session.');
      }
      if (cmdOpts.type === 'agent') {
        console.error('Note: Agent nodes created via CLI have no active PTY session.');
      }

      output(result.data, format, (d) => {
        const r = d as { nodeId: string; type: string; title: string };
        return `Created ${r.type} node: ${r.nodeId} (${r.title})`;
      });
    });

  node.command('update')
    .argument('<nodeId>', 'Node ID')
    .option('--x <n>', 'New X position', parseFloat)
    .option('--y <n>', 'New Y position', parseFloat)
    .option('--width <n>', 'New width', parseFloat)
    .option('--height <n>', 'New height', parseFloat)
    .option('--title <title>', 'New title')
    .description('Move, resize, or rename a node (layout/title only; use `node write` for content)')
    .action(async function (this: Command, nodeId: string, cmdOpts: { x?: number; y?: number; width?: number; height?: number; title?: string }) {
      const { format, storeDir, workspace } = await getWorkspaceCommandOptions(this);

      const patch = {
        x: cmdOpts.x,
        y: cmdOpts.y,
        width: cmdOpts.width,
        height: cmdOpts.height,
        title: cmdOpts.title,
      };
      if (Object.values(patch).every(v => v === undefined)) {
        errorOutput('Provide at least one of --x, --y, --width, --height, --title', { code: 'invalid_argument' });
      }

      const result = await updateNode(workspace, nodeId, patch, storeDir);
      if (!result.ok) errorOutput(result.error, { code: result.code ?? 'error' });

      output({ ok: true, nodeId }, format, () => `Updated node: ${nodeId}`);
    });

  node.command('delete')
    .argument('<nodeId>', 'Node ID')
    .description('Delete a canvas node')
    .action(async function (this: Command, nodeId: string) {
      const { format, storeDir, workspace } = await getWorkspaceCommandOptions(this);

      const result = await deleteNode(workspace, nodeId, storeDir);
      if (!result.ok) errorOutput(result.error, { code: result.code ?? 'error' });

      output({ deleted: nodeId }, format, () => `Deleted node: ${nodeId}`);
    });
}
