import { loadCanvas, loadWorkspaceManifest, getWorkspaceDir } from './store';
import { getNodeCapabilities, readNode } from './nodes';
import type { CanvasNode, CanvasEdge, NodeReadResult } from './types';

interface ContextNode {
  id: string;
  type: string;
  title: string;
  capabilities: string[];
  childIds?: string[];
  [key: string]: unknown;
}

interface ContextEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  kind?: string;
}

interface CanvasContext {
  workspaceId: string;
  workspaceName: string;
  canvasDir: string;
  nodes: ContextNode[];
  edges: ContextEdge[];
}

function extractDescription(content: string): string {
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    const heading = line.match(/^#{1,3}\s+(.+)/);
    if (heading) return heading[1];
    if (/^[-*_]{3,}$/.test(line)) continue;
    return line.replace(/[*_`#>]/g, '').trim().slice(0, 80);
  }
  return '';
}

export async function generateContext(
  workspaceId: string,
  storeDir?: string,
): Promise<CanvasContext | null> {
  const canvas = await loadCanvas(workspaceId, storeDir);
  if (!canvas) return null;

  const manifest = await loadWorkspaceManifest(storeDir);
  const entry = (manifest.workspaces ?? []).find(e => e.id === workspaceId);
  const workspaceName = entry?.name ?? workspaceId;
  const canvasDir = getWorkspaceDir(workspaceId, storeDir);

  const nodes: ContextNode[] = [];

  for (const node of canvas.nodes) {
    const readResult = await readNode(node);
    const base: ContextNode = {
      id: node.id,
      type: node.type,
      title: node.title,
      capabilities: getNodeCapabilities(node.type),
    };

    switch (node.type) {
      case 'file': {
        const content = (readResult as NodeReadResult & { content?: string }).content ?? '';
        base.path = (readResult as NodeReadResult & { path?: string }).path ?? '';
        base.language = (readResult as NodeReadResult & { language?: string }).language ?? '';
        base.description = extractDescription(content);
        break;
      }
      case 'terminal':
        base.cwd = (readResult as NodeReadResult & { cwd?: string }).cwd ?? '';
        break;
      case 'frame':
      case 'group':
        base.label = (readResult as NodeReadResult & { label?: string }).label ?? '';
        base.color = (readResult as NodeReadResult & { color?: string }).color ?? '';
        if (node.type === 'group') {
          base.childIds = (readResult as NodeReadResult & { childIds?: string[] }).childIds ?? [];
        }
        break;
      case 'agent':
        base.agentType = (readResult as NodeReadResult & { agentType?: string }).agentType ?? 'claude-code';
        base.status = (readResult as NodeReadResult & { status?: string }).status ?? 'idle';
        base.cwd = (readResult as NodeReadResult & { cwd?: string }).cwd ?? '';
        break;
    }

    nodes.push(base);
  }

  // Build a node-id → title map for readable edge descriptions
  const nodeTitleById = new Map<string, string>();
  for (const n of canvas.nodes) nodeTitleById.set(n.id, n.title);

  const edges: ContextEdge[] = (canvas.edges ?? []).map(e => {
    const src = e.source.kind === 'node'
      ? (nodeTitleById.get(e.source.nodeId) ?? e.source.nodeId)
      : `(${e.source.x},${e.source.y})`;
    const tgt = e.target.kind === 'node'
      ? (nodeTitleById.get(e.target.nodeId) ?? e.target.nodeId)
      : `(${e.target.x},${e.target.y})`;
    return {
      id: e.id,
      source: src,
      target: tgt,
      label: e.label,
      kind: e.kind,
    };
  });

  return { workspaceId, workspaceName, canvasDir, nodes, edges };
}

export function formatContextAsText(ctx: CanvasContext): string {
  const lines: string[] = [
    '# Pulse Canvas Context',
    '',
    `Workspace: ${ctx.workspaceName} (${ctx.workspaceId})`,
    `Canvas dir: ${ctx.canvasDir}`,
  ];

  const fileNodes = ctx.nodes.filter(n => n.type === 'file');
  const terminalNodes = ctx.nodes.filter(n => n.type === 'terminal');
  const frameNodes = ctx.nodes.filter(n => n.type === 'frame');
  const groupNodes = ctx.nodes.filter(n => n.type === 'group');
  const agentNodes = ctx.nodes.filter(n => n.type === 'agent');

  if (fileNodes.length > 0) {
    lines.push('', '## Files', '');
    for (const node of fileNodes) {
      const pathHint = node.path ? `\`${node.path}\`` : '(unsaved)';
      const desc = node.description ? ` — ${node.description}` : '';
      lines.push(`- **${node.title}** ${pathHint}${desc}`);
    }
  }

  if (frameNodes.length > 0) {
    lines.push('', '## Frames', '');
    for (const node of frameNodes) {
      const label = node.label ? ` — ${node.label}` : '';
      lines.push(`- **${node.title}**${label}`);
    }
  }

  if (groupNodes.length > 0) {
    lines.push('', '## Groups', '');
    for (const node of groupNodes) {
      const label = node.label ? ` — ${node.label}` : '';
      const children = node.childIds?.length ? ` (${node.childIds.length} members)` : '';
      lines.push(`- **${node.title}**${label}${children}`);
    }
  }

  if (terminalNodes.length > 0) {
    lines.push('', '## Terminals', '');
    for (const node of terminalNodes) {
      const cwd = node.cwd ? ` (cwd: \`${node.cwd}\`)` : '';
      lines.push(`- **${node.title}**${cwd}`);
    }
  }

  if (agentNodes.length > 0) {
    lines.push('', '## Agents', '');
    for (const node of agentNodes) {
      const info = `${node.agentType ?? 'unknown'}, ${node.status ?? 'idle'}`;
      const cwd = node.cwd ? `, cwd: \`${node.cwd}\`` : '';
      lines.push(`- **${node.title}** (${info}${cwd})`);
    }
  }

  if (ctx.edges.length > 0) {
    lines.push('', '## Connections', '');
    for (const edge of ctx.edges) {
      const label = edge.label ? ` "${edge.label}"` : '';
      const kind = edge.kind ? ` [${edge.kind}]` : '';
      lines.push(`- **${edge.source}** → **${edge.target}**${label}${kind}`);
    }
  }

  lines.push('', '> Use file paths above to read content as needed.', '');
  return lines.join('\n');
}
