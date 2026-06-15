import type { ComponentType } from 'react';

export interface CanvasNode {
  id: string;
  type: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  data?: unknown;
}

export interface PluginNodeData {
  pluginId?: string;
  nodeType?: string;
  payload?: unknown;
}

export interface NotePayload {
  title?: string;
  body?: string;
  accent?: string;
  pinned?: boolean;
}

export interface PluginNodeViewProps {
  node: CanvasNode;
  workspaceId?: string;
  workspaceName?: string;
  readOnly?: boolean;
  selected?: boolean;
  updateNode(patch: Partial<CanvasNode>): void;
  invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T>;
}

export interface RendererCtx {
  registerNodeView(nodeType: string, Component: ComponentType<PluginNodeViewProps>): void;
}

export interface RendererCanvasPlugin {
  id: string;
  activate(ctx: RendererCtx): void;
}

export interface PluginNodeRef {
  workspaceId: string;
  node: CanvasNode;
}

export interface PluginNodeReadResult {
  content?: string;
  summary?: string;
  payload?: unknown;
  data?: unknown;
  availableActions?: string[];
}

export interface PluginNodeWriteInput {
  title?: string;
  payload?: unknown;
}

export interface PluginNodeWritePatch {
  title?: string;
  payload?: unknown;
}

export interface PluginNodeActionResult {
  result?: unknown;
  patch?: PluginNodeWritePatch;
}

export interface PluginNodeCapabilities {
  read?(ref: PluginNodeRef): PluginNodeReadResult | Promise<PluginNodeReadResult>;
  write?(
    ref: PluginNodeRef,
    input: PluginNodeWriteInput,
  ): PluginNodeWritePatch | Promise<PluginNodeWritePatch>;
  actions?: Record<
    string,
    (ref: PluginNodeRef, input?: unknown) => PluginNodeActionResult | Promise<PluginNodeActionResult>
  >;
}

export interface MainCtx {
  registerNodeCapabilities(nodeType: string, capabilities: PluginNodeCapabilities): void;
}

export interface MainCanvasPlugin {
  id: string;
  activate(ctx: MainCtx): void | Promise<void>;
}
