import { z } from 'zod';

// ─── Types mirrored from canvas-cli ────────────────────────────────

export type NodeType = 'file' | 'terminal' | 'frame' | 'group' | 'agent' | 'text' | 'iframe' | 'image' | 'shape' | 'mindmap' | 'plugin';

export interface MindmapTopic {
  id: string;
  text: string;
  children: MindmapTopic[];
  color?: string;
  collapsed?: boolean;
}

export interface RawMindmapTopic {
  id?: string;
  text?: string;
  children?: RawMindmapTopic[];
  color?: string;
  collapsed?: boolean;
}

export interface CanvasNode {
  id: string;
  type: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  data: Record<string, unknown>;
  updatedAt?: number;
}

export type EdgeAnchor = 'top' | 'right' | 'bottom' | 'left' | 'auto';

export type EdgeEndpoint =
  | { kind: 'node'; nodeId: string; anchor?: EdgeAnchor }
  | { kind: 'point'; x: number; y: number };

export type EdgeArrowCap = 'none' | 'triangle' | 'arrow' | 'dot' | 'bar';

export interface EdgeStroke {
  color?: string;
  width?: number;
  style?: 'solid' | 'dashed' | 'dotted';
}

export interface CanvasEdge {
  id: string;
  source: EdgeEndpoint;
  target: EdgeEndpoint;
  bend?: number;
  arrowHead?: EdgeArrowCap;
  arrowTail?: EdgeArrowCap;
  stroke?: EdgeStroke;
  label?: string;
  kind?: string;
  payload?: Record<string, unknown>;
  updatedAt?: number;
}

export interface CanvasSaveData {
  nodes: CanvasNode[];
  edges?: CanvasEdge[];
  transform: { x: number; y: number; scale: number };
  savedAt: string;
}

// ─── Canvas Tool type (matches Engine's Tool interface) ────────────

/**
 * Subset of pulse-coder-engine's ToolExecutionContext that canvas tools may
 * use. Kept loose so the shim (engine.d.ts) does not need to export this type.
 */
export interface CanvasToolExecutionContext {
  /** Called when a tool needs to ask the user a clarifying question. */
  onClarificationRequest?: (request: {
    id: string;
    question: string;
    context?: string;
    defaultAnswer?: string;
    timeout: number;
  }) => Promise<string>;
  /** Abort signal for the current engine run. */
  abortSignal?: AbortSignal;
  /** Per-turn metadata supplied by CanvasAgent (for example ask/auto mode). */
  runContext?: Record<string, unknown>;
  /**
   * The AI SDK's id for the in-flight tool call (forwarded by the engine
   * tool wrapper from `ToolExecutionOptions.toolCallId`). Tools that
   * stream side-channel content to the renderer (e.g. `visual_render`)
   * use this id to address messages to the correct tool-call frame.
   */
  toolCallId?: string;
}

export interface CanvasTool {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  /**
   * When true the tool is hidden from the immediate tool list passed to the
   * LLM and only surfaces after `tool_search_tool_bm25` / `_regex` discovers
   * it. Engine-side this is consumed by the built-in tool-search plugin
   * (`packages/engine/src/built-in/tool-search-plugin`).
   */
  defer_loading?: boolean;
  execute: (input: any, ctx?: CanvasToolExecutionContext) => Promise<string>;
}
