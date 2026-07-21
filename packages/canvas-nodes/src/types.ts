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

export interface PluginIpcInvokeEvent {
  sender: unknown;
  frameId: number;
}

export type PluginIpcHandler = (
  event: PluginIpcInvokeEvent,
  ...args: unknown[]
) => unknown;

export interface MainCtx {
  registerNodeCapabilities(nodeType: string, capabilities: PluginNodeCapabilities): void;
  registerCanvasTool(factory: CanvasToolFactory): void;
  // Mirror of the host's MainCtx.handle (channel auto-prefixed `plugin:<id>:`,
  // callable from the renderer view via `invoke`). Optional so the plugin
  // degrades gracefully on hosts that predate plugin IPC.
  handle?(channel: string, handler: PluginIpcHandler): void;
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

export interface PdfSource {
  path: string;
  name: string;
  size?: number;
  addedAt?: string;
}

export interface PdfDocumentPayload extends Record<string, unknown> {
  title?: string;
  source?: PdfSource | null;
  pageCount?: number | null;
  currentPage?: number;
  updatedAt?: string;
}

export interface PdfDocumentState {
  title: string;
  source: PdfSource | null;
  pageCount: number | null;
  currentPage: number;
  updatedAt?: string;
}

export interface PdfDocumentSummary {
  title: string;
  fileName: string | null;
  path: string | null;
  pageCount: number | null;
  currentPage: number;
  hasSource: boolean;
}

export interface PdfPageText {
  page: number;
  text: string;
}

export interface PdfExtractResult {
  pageCount: number;
  pages: PdfPageText[];
}

export interface PdfExtractor {
  probe(path: string): Promise<{ pageCount: number }>;
  extract(path: string, pages?: number[]): Promise<PdfExtractResult>;
}

export interface ExcalidrawSceneSummary {
  title: string;
  elementCount: number;
  textCount: number;
  texts: string[];
  countsByType: Record<string, number>;
}
