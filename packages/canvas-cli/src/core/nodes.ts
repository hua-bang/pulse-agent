import { promises as fs } from 'fs';
import { join, resolve, relative, isAbsolute } from 'path';
import { NODE_CAPABILITIES, DEFAULT_NODE_DIMENSIONS } from './constants';
import { loadCanvas, saveCanvas, ensureWorkspaceDir, getWorkspaceDir, commitNodeMutation } from './store';
import { notifyCanvasUpdated } from './notifier';
import type {
  NodeType,
  NodeCapability,
  CanvasNode,
  CanvasSaveData,
  MindmapTopic,
  NodeReadResult,
  Result,
} from './types';

// ─── Mindmap helpers ───────────────────────────────────────────────

interface RawMindmapTopic {
  id?: string;
  text?: string;
  children?: RawMindmapTopic[];
  color?: string;
  collapsed?: boolean;
}

let topicIdCounter = 0;
function genTopicId(): string {
  return `topic-${Date.now()}-${++topicIdCounter}`;
}

/**
 * Normalize a topic tree supplied by the agent (via `--data` JSON) into
 * the canonical `MindmapTopic` shape: every topic gets a stable id, a
 * string `text`, and a real `children` array. Recursively walks the tree
 * so the entire subtree is renderer-ready before it lands on disk.
 */
function normalizeMindmapTopic(raw: RawMindmapTopic | null | undefined): MindmapTopic {
  const safe = raw ?? {};
  const topic: MindmapTopic = {
    id: typeof safe.id === 'string' && safe.id ? safe.id : genTopicId(),
    text: typeof safe.text === 'string' ? safe.text : '',
    children: Array.isArray(safe.children) ? safe.children.map(normalizeMindmapTopic) : [],
  };
  if (typeof safe.color === 'string') topic.color = safe.color;
  if (safe.collapsed) topic.collapsed = true;
  return topic;
}

/** Indent a topic tree as a bullet list. Used by `node read` output. */
function flattenMindmapTopics(topic: MindmapTopic | undefined, depth = 0): string {
  if (!topic) return '';
  const lines: string[] = [];
  const indent = '  '.repeat(depth);
  const text = topic.text?.trim() || '(empty topic)';
  const collapsedHint = topic.collapsed ? ' [collapsed in UI]' : '';
  lines.push(`${indent}- ${text}${collapsedHint}`);
  for (const child of topic.children ?? []) {
    lines.push(flattenMindmapTopics(child, depth + 1));
  }
  return lines.join('\n');
}

export function getNodeCapabilities(type: NodeType): NodeCapability[] {
  // Cast to a string index so an unrecognized (future) node type falls back to
  // read-only instead of tripping the closed key set.
  return (NODE_CAPABILITIES as Record<string, NodeCapability[]>)[type] ?? ['read'];
}

/** True if `child` resolves to a path at or under `parent`. */
export function isPathInside(child: string, parent: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export interface ReadNodeOptions {
  /**
   * When set, a `file` node whose `filePath` escapes this directory is NOT
   * read from disk — the in-memory content is returned instead and the result
   * is flagged `pathConfined: true`. Guards against a crafted/untrusted
   * canvas.json turning `node read` into arbitrary file read.
   */
  confineToDir?: string;
}

/**
 * Pull a small set of keys off a node's `data`, keeping only the ones that
 * are actually present. Used by the read cases below so the result carries a
 * node type's persisted metadata without inventing empty fields.
 */
function pick(data: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (data[key] !== undefined) out[key] = data[key];
  }
  return out;
}

export interface NodeSearchHit {
  id: string;
  type: NodeType;
  title: string;
  /** Short excerpt around the match (title or in-memory content). */
  snippet: string;
}

export interface NodeSearchOptions {
  type?: string;
  limit?: number;
}

/**
 * Case-insensitive substring search over node titles and their in-memory
 * `data.content` (file/text nodes). Pure and offline: it does NOT read backing
 * files from disk, so a file node's on-disk-only body won't match its content
 * — its title still will. Lets an agent locate nodes without N `node read`
 * round-trips.
 */
export function searchNodes(nodes: CanvasNode[], query: string, opts: NodeSearchOptions = {}): NodeSearchHit[] {
  const q = query.toLowerCase();
  const hits: NodeSearchHit[] = [];
  for (const n of nodes) {
    if (opts.type && n.type !== opts.type) continue;
    const title = n.title ?? '';
    const content = typeof n.data.content === 'string' ? n.data.content : '';
    const hay = `${title}\n${content}`;
    const idx = hay.toLowerCase().indexOf(q);
    if (idx < 0) continue;
    const start = Math.max(0, idx - 30);
    const snippet = hay.slice(start, idx + q.length + 60).replace(/\s+/g, ' ').trim();
    hits.push({ id: n.id, type: n.type, title, snippet });
    if (opts.limit && hits.length >= opts.limit) break;
  }
  return hits;
}

export async function readNode(node: CanvasNode, opts: ReadNodeOptions = {}): Promise<NodeReadResult> {
  const capabilities = getNodeCapabilities(node.type);

  switch (node.type) {
    case 'file': {
      let content = node.data.content ?? '';
      const filePath = node.data.filePath;
      let pathConfined = false;
      if (filePath) {
        if (opts.confineToDir && !isPathInside(filePath, opts.confineToDir)) {
          // Escaping path under confinement: never touch disk, use whatever
          // content the canvas already holds.
          pathConfined = true;
        } else {
          try {
            content = await fs.readFile(filePath, 'utf-8');
          } catch {
            // fall through to in-memory content
          }
        }
      }
      const ext = filePath?.split('.').pop() ?? '';
      const result: NodeReadResult = { type: 'file', capabilities, path: filePath ?? '', content, language: ext };
      if (pathConfined) result.pathConfined = true;
      return result;
    }
    case 'terminal':
      return {
        type: 'terminal',
        capabilities,
        cwd: node.data.cwd ?? '',
        scrollback: node.data.scrollback ?? '',
      };
    case 'frame':
    case 'group': {
      const detail: Record<string, unknown> = {
        type: node.type,
        capabilities,
        label: node.data.label ?? '',
        color: node.data.color ?? '',
      };
      if (node.type === 'group') detail.childIds = node.data.childIds ?? [];
      return detail as NodeReadResult;
    }
    case 'agent':
      return {
        type: 'agent',
        capabilities,
        cwd: node.data.cwd ?? '',
        scrollback: node.data.scrollback ?? '',
        agentType: node.data.agentType ?? 'claude-code',
        status: node.data.status ?? 'idle',
      };
    case 'mindmap': {
      const root = node.data.root as MindmapTopic | undefined;
      return {
        type: 'mindmap',
        capabilities,
        root,
        text: flattenMindmapTopics(root),
      };
    }
    case 'text':
      // Persisted markdown plus its display styling. `content` is the full
      // body — `node read` returns it in full; `context` only excerpts it.
      return {
        type: 'text',
        capabilities,
        content: (node.data.content as string) ?? (node.data.text as string) ?? '',
        ...pick(node.data, ['fontSize', 'fontFamily', 'color', 'textAlign', 'markdown']),
      };
    case 'iframe':
      // Everything the store holds about an embedded page: how it's sourced
      // (`mode`), where (`url`), any inlined `html`/`prompt`, and the linked
      // artifact. The live page body is NOT here — see the note in the
      // package README about a future `webview read`.
      return {
        type: 'iframe',
        capabilities,
        ...pick(node.data, ['mode', 'url', 'html', 'prompt', 'artifactId', 'pageTitle']),
      };
    case 'image':
      // Only the local file path is persisted; the CLI does not read image
      // bytes.
      return {
        type: 'image',
        capabilities,
        ...pick(node.data, ['filePath', 'src', 'alt', 'width', 'height']),
      };
    case 'shape':
      return {
        type: 'shape',
        capabilities,
        ...pick(node.data, ['shape', 'shapeType', 'text', 'style', 'fill', 'stroke', 'color']),
      };
    case 'dynamic-app':
      return {
        type: 'dynamic-app',
        capabilities,
        ...pick(node.data, ['url', 'dynamicAppId']),
      };
    case 'plugin':
      return {
        type: 'plugin',
        capabilities,
        ...pick(node.data, ['pluginId', 'nodeType', 'version', 'payload']),
      };
    default:
      // Unknown/future node type: surface its raw data so an agent can still
      // reason about it, rather than dropping everything.
      return { type: node.type, capabilities, data: node.data };
  }
}

export interface WriteNodeOptions {
  /**
   * Refuse to write a `file` node whose `filePath` escapes the workspace
   * directory. Guards against a crafted/untrusted canvas.json turning
   * `node write` into an arbitrary-file overwrite.
   */
  confineToWorkspace?: boolean;
}

export async function writeNode(
  workspaceId: string,
  nodeId: string,
  content: string,
  storeDir?: string,
  opts: WriteNodeOptions = {},
): Promise<Result> {
  const canvas = await loadCanvas(workspaceId, storeDir);
  if (!canvas) return { ok: false, error: `Workspace not found: ${workspaceId}`, code: 'workspace_not_found' };

  const node = canvas.nodes.find(n => n.id === nodeId);
  if (!node) return { ok: false, error: `Node not found: ${nodeId}`, code: 'node_not_found' };

  switch (node.type) {
    case 'file': {
      if (node.data.filePath) {
        if (opts.confineToWorkspace) {
          const wsDir = getWorkspaceDir(workspaceId, storeDir);
          if (!isPathInside(node.data.filePath, wsDir)) {
            return {
              ok: false,
              error: `Refusing to write file node: its filePath "${node.data.filePath}" is outside the workspace directory (--confine-to-workspace).`,
              code: 'path_confined',
            };
          }
        }
        await fs.writeFile(node.data.filePath, content, 'utf-8');
      }
      node.data.content = content;
      node.updatedAt = Date.now();
      // Re-read canvas.json just before writing so concurrent changes
      // from the Electron renderer (or other canvas-cli invocations) to
      // other nodes are preserved. Only our target node is replaced.
      await commitNodeMutation(workspaceId, { upsert: node }, storeDir);
      await notifyCanvasUpdated({ workspaceId, nodeIds: [nodeId], kind: 'update' });
      return { ok: true, data: undefined };
    }
    case 'text': {
      // Text cards hold their markdown inline in `data.content`; writing is
      // symmetric with reading them (unlike file nodes there is no backing
      // file on disk to update).
      node.data.content = content;
      node.updatedAt = Date.now();
      await commitNodeMutation(workspaceId, { upsert: node }, storeDir);
      await notifyCanvasUpdated({ workspaceId, nodeIds: [nodeId], kind: 'update' });
      return { ok: true, data: undefined };
    }
    case 'frame':
    case 'group': {
      try {
        const patch = JSON.parse(content) as { label?: string; color?: string; childIds?: string[] };
        if (patch.label !== undefined) node.data.label = patch.label;
        if (patch.color !== undefined) node.data.color = patch.color;
        if (node.type === 'group' && Array.isArray(patch.childIds)) {
          node.data.childIds = patch.childIds.filter((id): id is string => typeof id === 'string');
        }
        node.updatedAt = Date.now();
        await commitNodeMutation(workspaceId, { upsert: node }, storeDir);
        await notifyCanvasUpdated({ workspaceId, nodeIds: [nodeId], kind: 'update' });
        return { ok: true, data: undefined };
      } catch {
        return { ok: false, error: 'Container write expects JSON: { label?: string, color?: string, childIds?: string[] }', code: 'invalid_argument' };
      }
    }
    case 'terminal':
      return { ok: false, error: 'Terminal nodes do not support write. Use canvas_exec to send commands.', code: 'unsupported' };
    case 'agent':
      return { ok: false, error: 'Agent nodes do not support write. Use canvas_exec to send commands.', code: 'unsupported' };
    default:
      return { ok: false, error: `Node type "${node.type}" does not support write from the CLI.`, code: 'unsupported' };
  }
}

function autoPlace(nodes: Array<{ x?: number; y?: number; width?: number; height?: number }>): { x: number; y: number } {
  if (nodes.length === 0) return { x: 100, y: 100 };
  let maxRight = 0;
  let bestY = 100;
  for (const n of nodes) {
    const right = (n.x ?? 0) + (n.width ?? 400);
    if (right > maxRight) {
      maxRight = right;
      bestY = n.y ?? 100;
    }
  }
  return { x: maxRight + 40, y: bestY };
}

export interface CreateNodeOptions {
  type: NodeType;
  title?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  data?: Record<string, unknown>;
}

export async function createNode(
  workspaceId: string,
  opts: CreateNodeOptions,
  storeDir?: string,
): Promise<Result<{ nodeId: string; type: NodeType; title: string; capabilities: NodeCapability[] }>> {
  // Auto-create canvas if it doesn't exist yet
  let canvas = await loadCanvas(workspaceId, storeDir);
  if (!canvas) {
    await ensureWorkspaceDir(workspaceId, storeDir);
    canvas = {
      nodes: [],
      transform: { x: 0, y: 0, scale: 1 },
      savedAt: new Date().toISOString(),
    } satisfies CanvasSaveData;
    // Bootstrap an empty canvas for a brand-new workspace. `loadCanvas`
    // just returned null, so nothing is at risk; opt in to the wipe guard
    // for intent-clarity.
    await saveCanvas(workspaceId, canvas, storeDir, { allowEmpty: true });
  }

  const nodeId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const def = (DEFAULT_NODE_DIMENSIONS as Record<string, { title: string; width: number; height: number }>)[opts.type];
  if (!def) return { ok: false, error: `Unsupported node type: ${opts.type}`, code: 'unsupported' };

  const auto = autoPlace(canvas.nodes);
  const x = opts.x ?? auto.x;
  const y = opts.y ?? auto.y;

  const inputData = opts.data ?? {};
  // Defaults to `{}` for defensive completeness — `def` above already rejects
  // any non-creatable type before we reach this switch.
  let nodeData: Record<string, unknown> = {};
  switch (opts.type) {
    case 'file':
      nodeData = { filePath: '', content: (inputData as Record<string, string>).content ?? '', saved: false, modified: false };
      break;
    case 'terminal':
      nodeData = { sessionId: '', cwd: (inputData as Record<string, string>).cwd ?? '' };
      break;
    case 'frame':
      nodeData = { color: (inputData as Record<string, string>).color ?? '#9575d4', label: (inputData as Record<string, string>).label ?? '' };
      break;
    case 'group':
      nodeData = {
        color: (inputData as Record<string, string>).color ?? '#A594E0',
        label: (inputData as Record<string, string>).label ?? '',
        childIds: Array.isArray((inputData as { childIds?: unknown }).childIds)
          ? ((inputData as { childIds: unknown[] }).childIds).filter((id): id is string => typeof id === 'string')
          : [],
      };
      break;
    case 'agent':
      nodeData = { sessionId: '', cwd: (inputData as Record<string, string>).cwd ?? '', agentType: (inputData as Record<string, string>).agentType ?? 'claude-code', status: 'idle' };
      break;
    case 'mindmap': {
      const rawRoot = (inputData as { root?: RawMindmapTopic }).root;
      const root = rawRoot
        ? normalizeMindmapTopic(rawRoot)
        : {
            id: genTopicId(),
            text: opts.title ?? 'Central topic',
            children: [],
          };
      nodeData = { root, layout: 'right', rev: 0 };
      break;
    }
  }

  // For file nodes, always create a notes file so the node has a valid filePath
  if (opts.type === 'file') {
    const notesDir = join(getWorkspaceDir(workspaceId, storeDir), 'notes');
    await fs.mkdir(notesDir, { recursive: true });
    const title = opts.title ?? def.title;
    const safeTitle = title.replace(/[^a-zA-Z0-9_-]/g, '_');
    const noteFile = join(notesDir, `${safeTitle}-${nodeId}.md`);
    await fs.writeFile(noteFile, String(nodeData.content ?? ''), 'utf-8');
    nodeData.filePath = noteFile;
    nodeData.saved = true;
    nodeData.modified = false;
  }

  const newNode: CanvasNode = {
    id: nodeId,
    type: opts.type,
    title: opts.title ?? def.title,
    x,
    y,
    width: opts.width ?? def.width,
    height: opts.height ?? def.height,
    data: nodeData,
    updatedAt: Date.now(),
  };

  // Re-read canvas.json and append our new node so any nodes added by
  // the renderer (or another CLI call) between our initial loadCanvas and
  // this write are preserved.
  await commitNodeMutation(workspaceId, { upsert: newNode }, storeDir);
  await notifyCanvasUpdated({ workspaceId, nodeIds: [nodeId], kind: 'create' });

  return {
    ok: true,
    data: {
      nodeId,
      type: opts.type,
      title: newNode.title,
      capabilities: getNodeCapabilities(opts.type),
    },
  };
}

export interface UpdateNodePatch {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  title?: string;
}

/**
 * Update a node's layout (position/size) and/or title without touching its
 * `data`. Lets an agent reposition or rename nodes — the one mutation `node
 * write` (which owns `data`) doesn't cover.
 */
export async function updateNode(
  workspaceId: string,
  nodeId: string,
  patch: UpdateNodePatch,
  storeDir?: string,
): Promise<Result> {
  const canvas = await loadCanvas(workspaceId, storeDir);
  if (!canvas) return { ok: false, error: `Workspace not found: ${workspaceId}`, code: 'workspace_not_found' };

  const node = canvas.nodes.find(n => n.id === nodeId);
  if (!node) return { ok: false, error: `Node not found: ${nodeId}`, code: 'node_not_found' };

  if (patch.x !== undefined) node.x = patch.x;
  if (patch.y !== undefined) node.y = patch.y;
  if (patch.width !== undefined) node.width = patch.width;
  if (patch.height !== undefined) node.height = patch.height;
  if (patch.title !== undefined) node.title = patch.title;
  node.updatedAt = Date.now();

  await commitNodeMutation(workspaceId, { upsert: node }, storeDir);
  await notifyCanvasUpdated({ workspaceId, nodeIds: [nodeId], kind: 'update' });
  return { ok: true, data: undefined };
}

export async function deleteNode(
  workspaceId: string,
  nodeId: string,
  storeDir?: string,
): Promise<Result> {
  const canvas = await loadCanvas(workspaceId, storeDir);
  if (!canvas) return { ok: false, error: `Workspace not found: ${workspaceId}`, code: 'workspace_not_found' };

  const exists = canvas.nodes.some(n => n.id === nodeId);
  if (!exists) return { ok: false, error: `Node not found: ${nodeId}`, code: 'node_not_found' };

  // Re-read canvas.json just before writing to preserve concurrent changes
  // to other nodes from the renderer or other canvas-cli invocations.
  const result = await commitNodeMutation(workspaceId, { removeId: nodeId }, storeDir);
  if (!result) return { ok: false, error: `Node not found: ${nodeId}`, code: 'node_not_found' };
  await notifyCanvasUpdated({ workspaceId, nodeIds: [nodeId], kind: 'delete' });

  return { ok: true, data: undefined };
}
