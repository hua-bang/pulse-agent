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
  updatedAt?: number;
}

export interface PluginNodeData {
  pluginId?: string;
  nodeType?: string;
  payload?: unknown;
  version?: string;
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

export interface PluginNodeWriteInput {
  title?: string;
  data?: Record<string, unknown>;
  payload?: Record<string, unknown>;
}

export interface PluginNodePatch extends PluginNodeWriteInput {}

export interface PluginNodeActionResult {
  result?: unknown;
  patch?: PluginNodePatch;
}

export type PluginNodeActionHandler = (
  ref: PluginNodeRef,
  input: Record<string, unknown>,
) => PluginNodePatch | PluginNodeActionResult | void | Promise<PluginNodePatch | PluginNodeActionResult | void>;

export interface PluginNodeCapabilities {
  read?(ref: PluginNodeRef): unknown | Promise<unknown>;
  write?(ref: PluginNodeRef, input: PluginNodeWriteInput): unknown | Promise<unknown>;
  actions?: Record<string, PluginNodeActionHandler>;
}

export type CanvasToolFactory = (workspaceId: string) => Record<string, unknown>;

export interface MainCtx {
  registerNodeCapabilities(nodeType: string, capabilities: PluginNodeCapabilities): void;
  registerCanvasTool(factory: CanvasToolFactory): void;
}

export type ExcalidrawElementRecord = Record<string, unknown>;

export interface ExcalidrawBoardPayload extends Record<string, unknown> {
  title?: string;
  elements?: ExcalidrawElementRecord[];
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
  updatedAt?: string;
}

export interface ExcalidrawBoardScene {
  title: string;
  elements: ExcalidrawElementRecord[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
  updatedAt?: string;
}

export type ExcalidrawSkeletonType =
  | 'rectangle'
  | 'ellipse'
  | 'diamond'
  | 'text'
  | 'arrow'
  | 'line';

export interface ExcalidrawSkeletonElement {
  id?: string;
  type: ExcalidrawSkeletonType;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  text?: string;
  strokeColor?: string;
  backgroundColor?: string;
  fontSize?: number;
  strokeWidth?: number;
  roughness?: number;
  opacity?: number;
}

export interface ExcalidrawSceneSummary {
  title: string;
  elementCount: number;
  textCount: number;
  texts: string[];
  countsByType: Record<string, number>;
}
