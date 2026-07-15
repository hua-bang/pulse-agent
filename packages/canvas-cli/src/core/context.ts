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

/** Max characters of a text node's body included inline in context. */
const TEXT_EXCERPT_LEN = 200;

/**
 * Collapse a (possibly long, possibly multi-line) string to a single-line
 * excerpt for context. Keeps prompts turning into `pulse-canvas context`
 * output from ballooning an agent's prompt — the full body stays reachable
 * via `pulse-canvas node read <id> --format json`.
 */
function excerpt(text: string, max = TEXT_EXCERPT_LEN): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

export interface GenerateContextOptions {
  /** Restrict file-node disk reads to the workspace dir (see readNode confineToDir). */
  confineToWorkspace?: boolean;
}

export async function generateContext(
  workspaceId: string,
  storeDir?: string,
  opts: GenerateContextOptions = {},
): Promise<CanvasContext | null> {
  const canvas = await loadCanvas(workspaceId, storeDir);
  if (!canvas) return null;

  const manifest = await loadWorkspaceManifest(storeDir);
  const entry = (manifest.workspaces ?? []).find(e => e.id === workspaceId);
  const workspaceName = entry?.name ?? workspaceId;
  const canvasDir = getWorkspaceDir(workspaceId, storeDir);
  const confineToDir = opts.confineToWorkspace ? canvasDir : undefined;

  const nodes: ContextNode[] = [];

  for (const node of canvas.nodes) {
    const readResult = await readNode(node, { confineToDir });
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
      case 'text': {
        // Excerpt only — the full markdown stays behind `node read`.
        const content = (readResult as NodeReadResult & { content?: string }).content ?? '';
        base.excerpt = excerpt(content);
        break;
      }
      case 'iframe': {
        // Persisted metadata only — never the inlined `html`/`prompt`, which
        // can be huge and would blow up an agent's prompt.
        const r = readResult as NodeReadResult & { mode?: string; url?: string; pageTitle?: string };
        if (r.mode !== undefined) base.mode = r.mode;
        if (r.url !== undefined) base.url = r.url;
        if (r.pageTitle !== undefined) base.pageTitle = r.pageTitle;
        break;
      }
      case 'image': {
        const r = readResult as NodeReadResult & { filePath?: string; src?: string };
        base.path = r.filePath ?? r.src ?? '';
        break;
      }
      case 'shape': {
        const r = readResult as NodeReadResult & { shape?: string; shapeType?: string; text?: string };
        base.shape = r.shape ?? r.shapeType ?? '';
        if (r.text) base.text = excerpt(String(r.text), 80);
        break;
      }
      case 'dynamic-app': {
        const r = readResult as NodeReadResult & { url?: string; dynamicAppId?: string };
        if (r.url !== undefined) base.url = r.url;
        if (r.dynamicAppId !== undefined) base.dynamicAppId = r.dynamicAppId;
        break;
      }
      case 'plugin': {
        // pluginId/nodeType/version identify it; the free-form `payload` is
        // omitted from context (fetch it with `node read` if needed).
        const r = readResult as NodeReadResult & { pluginId?: string; nodeType?: string; version?: string };
        if (r.pluginId !== undefined) base.pluginId = r.pluginId;
        if (r.nodeType !== undefined) base.pluginNodeType = r.nodeType;
        if (r.version !== undefined) base.version = r.version;
        break;
      }
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

  const textNodes = ctx.nodes.filter(n => n.type === 'text');
  if (textNodes.length > 0) {
    lines.push('', '## Text', '');
    for (const node of textNodes) {
      const ex = node.excerpt ? ` — ${node.excerpt}` : '';
      lines.push(`- **${node.title}**${ex}`);
    }
  }

  const iframeNodes = ctx.nodes.filter(n => n.type === 'iframe');
  if (iframeNodes.length > 0) {
    lines.push('', '## Embeds (iframe)', '');
    for (const node of iframeNodes) {
      const where = node.url ? ` \`${node.url}\`` : node.mode ? ` (${node.mode})` : '';
      const page = node.pageTitle ? ` — ${node.pageTitle}` : '';
      lines.push(`- **${node.title}**${where}${page}`);
    }
  }

  // Any node type not rendered above (image, shape, dynamic-app, plugin,
  // reference, or a future type this CLI has never seen) still gets listed so
  // an agent knows it exists.
  const shownTypes = new Set(['file', 'frame', 'group', 'terminal', 'agent', 'text', 'iframe']);
  const otherNodes = ctx.nodes.filter(n => !shownTypes.has(n.type));
  if (otherNodes.length > 0) {
    lines.push('', '## Other nodes', '');
    for (const node of otherNodes) {
      const hint = String(node.url ?? node.path ?? node.pluginId ?? node.shape ?? '');
      const hintStr = hint ? ` — ${hint}` : '';
      lines.push(`- **${node.title}** [${node.type}]${hintStr}`);
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
