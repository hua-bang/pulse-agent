import type { App } from '@modelcontextprotocol/ext-apps';
import type { CanvasNode } from '../../../types';
import {
  applyLocalPatch,
  mergeUpdateOperations,
  toUpdateOperation,
  type NodeUpdateOperation,
} from './nodePatch';

const SAVE_DELAY_MS = 400;
const POLL_INTERVAL_MS = 4_000;

export interface NodeSummary {
  id: string;
  type: string;
  title: string;
  description?: string;
}

export interface NodeViewState {
  phase: 'connecting' | 'loading' | 'ready' | 'picker' | 'error';
  workspaceId?: string;
  workspaceName?: string;
  node?: CanvasNode;
  editable: boolean;
  saving: boolean;
  error?: string;
  candidates: NodeSummary[];
}

interface NodeResult {
  workspaceId: string;
  workspaceName: string;
  node: CanvasNode;
  version: string;
  writableFields: string[];
}

class ToolError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

async function callTool<T>(app: App, name: string, args: Record<string, unknown>): Promise<T> {
  const result = await app.callServerTool({ name, arguments: args });
  if (result.isError) {
    const structured = result.structuredContent as { code?: string; error?: string } | undefined;
    const text = result.content?.find(block => block.type === 'text');
    throw new ToolError(
      structured?.code ?? 'error',
      structured?.error ?? (text && 'text' in text ? text.text : 'Pulse Canvas tool call failed.'),
    );
  }
  return (result.structuredContent ?? {}) as T;
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** The user is typing in a node body: never swap the node under them. */
const isEditingInPlace = (): boolean => {
  const active = document.activeElement as HTMLElement | null;
  return Boolean(active && (active.isContentEditable || active.tagName === 'INPUT' || active.tagName === 'TEXTAREA'));
};

/**
 * Talks to the pulse-canvas MCP server for one node: loads it, persists the
 * node body's own `onUpdate` patches through `canvas_apply`, and polls for
 * edits made elsewhere (app, CLI, agent).
 */
export class NodeViewHost {
  private state: NodeViewState = { phase: 'connecting', editable: false, saving: false, candidates: [] };
  private listeners = new Set<(state: NodeViewState) => void>();
  private version?: string;
  private writableFields: string[] = [];
  private queue: NodeUpdateOperation[] = [];
  private saveTimer?: ReturnType<typeof setTimeout>;
  private saving: Promise<void> | null = null;
  private pollTimer?: ReturnType<typeof setInterval>;

  constructor(private readonly app: App) {}

  get snapshot(): NodeViewState {
    return this.state;
  }

  subscribe(listener: (state: NodeViewState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(patch: Partial<NodeViewState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }

  async open(target: { workspaceId?: string; nodeId?: string }): Promise<void> {
    await this.flush();
    if (!target.nodeId) {
      await this.showPicker(target.workspaceId);
      return;
    }
    this.set({ phase: 'loading', error: undefined });
    try {
      await this.load(target.workspaceId, target.nodeId);
      this.startPolling();
    } catch (err) {
      this.set({ phase: 'error', error: message(err) });
    }
  }

  private async load(workspaceId: string | undefined, nodeId: string): Promise<void> {
    const result = await callTool<NodeResult>(this.app, 'canvas_ui_node', { workspaceId, nodeId });
    this.version = result.version;
    this.writableFields = result.writableFields ?? [];
    this.set({
      phase: 'ready',
      workspaceId: result.workspaceId,
      workspaceName: result.workspaceName,
      node: result.node,
      editable: this.writableFields.length > 0,
    });
  }

  private async showPicker(workspaceId?: string): Promise<void> {
    this.set({ phase: 'loading', error: undefined });
    try {
      const context = await callTool<{ workspaceId: string; workspaceName: string; nodes: NodeSummary[] }>(
        this.app,
        'canvas_context',
        { workspaceId, types: ['mindmap', 'text', 'file'] },
      );
      this.set({
        phase: 'picker',
        workspaceId: context.workspaceId,
        workspaceName: context.workspaceName,
        candidates: context.nodes,
        node: undefined,
      });
    } catch (err) {
      this.set({ phase: 'error', error: message(err) });
    }
  }

  /** Node body `onUpdate`: render the change now, persist it shortly. */
  update(id: string, patch: Partial<CanvasNode>): void {
    const node = this.state.node;
    if (!node || node.id !== id) return;
    const operation = this.state.editable ? toUpdateOperation(node, patch, this.writableFields) : null;
    this.set({ node: applyLocalPatch(node, patch) });
    if (!operation) return;
    this.queue.push(operation);
    this.set({ saving: true });
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flush(), SAVE_DELAY_MS);
  }

  async flush(): Promise<void> {
    clearTimeout(this.saveTimer);
    while (this.saving) await this.saving;
    if (this.queue.length === 0 || !this.state.workspaceId) return;
    const operations = mergeUpdateOperations(this.queue.splice(0));
    const workspaceId = this.state.workspaceId;
    this.saving = this.send(workspaceId, operations).finally(() => {
      this.saving = null;
    });
    await this.saving;
    if (this.queue.length > 0) await this.flush();
  }

  private async send(workspaceId: string, operations: NodeUpdateOperation[]): Promise<void> {
    const nodeId = operations[0].id;
    try {
      await callTool(this.app, 'canvas_apply', { workspaceId, operations });
      const fresh = await callTool<NodeResult>(this.app, 'canvas_ui_node', { workspaceId, nodeId });
      this.version = fresh.version;
      this.set({ saving: this.queue.length > 0, error: undefined });
    } catch (err) {
      this.queue = [];
      this.set({ saving: false, error: `Could not save: ${message(err)}` });
      await this.load(workspaceId, nodeId).catch(() => undefined);
    }
  }

  private startPolling(): void {
    clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => void this.poll(), POLL_INTERVAL_MS);
  }

  stop(): void {
    clearInterval(this.pollTimer);
  }

  private async poll(): Promise<void> {
    const { node, workspaceId } = this.state;
    if (!node || !workspaceId || this.saving || this.queue.length > 0 || isEditingInPlace()) return;
    if (document.visibilityState === 'hidden') return;
    try {
      const fresh = await callTool<NodeResult>(this.app, 'canvas_ui_node', { workspaceId, nodeId: node.id });
      if (fresh.version !== this.version && this.queue.length === 0 && !this.saving && !isEditingInPlace()) {
        this.version = fresh.version;
        this.set({ node: fresh.node, workspaceName: fresh.workspaceName });
      }
    } catch (err) {
      if (err instanceof ToolError && err.code === 'node_not_found') {
        this.stop();
        this.set({ phase: 'error', error: 'This node was deleted from the canvas.' });
      }
    }
  }
}
