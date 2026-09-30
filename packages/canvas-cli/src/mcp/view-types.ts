/**
 * Wire types shared by the MCP server (`snapshot.ts`) and the MCP App view
 * (`mcp-app/`). Pure types only: the view compiles against the DOM and must
 * not pull Node modules through this file.
 */

export type ViewEditMode = 'content' | 'label' | 'none';

export interface ViewNode {
  id: string;
  type: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  editable: ViewEditMode;
  content?: string;
  /** True when `content` was capped; the view must not write it back. */
  contentTruncated?: boolean;
  label?: string;
  color?: string;
  /** One-line hint for read-only node types (url, file name, plugin id). */
  meta?: string;
  /** Indented outline for mindmap nodes. */
  outline?: string;
}

export type ViewEdgeEndpoint =
  | { kind: 'node'; nodeId: string; anchor?: string }
  | { kind: 'point'; x: number; y: number };

export interface ViewEdge {
  id: string;
  source: ViewEdgeEndpoint;
  target: ViewEdgeEndpoint;
  label?: string;
  color?: string;
  width?: number;
  style?: 'solid' | 'dashed' | 'dotted';
  arrowHead?: string;
  arrowTail?: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  active: boolean;
}

export interface CanvasSnapshot {
  workspaceId: string;
  workspaceName: string;
  /** Opaque change token; compare with `canvas_ui_version` to detect edits. */
  version: string;
  /** Store revision, when the store has one. */
  revision: number | null;
  nodes: ViewNode[];
  edges: ViewEdge[];
}

/** One `canvas_apply` operation as the view sends it. */
export type ViewOperation =
  | {
    action: 'create';
    type: string;
    id: string;
    title?: string;
    x: number;
    y: number;
    width?: number;
    height?: number;
    content?: string;
    data?: Record<string, unknown>;
  }
  | {
    action: 'update';
    id: string;
    title?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    content?: string;
  }
  | { action: 'delete'; id: string }
  | { action: 'createEdge'; id: string; from: string; to: string; label?: string }
  | { action: 'deleteEdge'; id: string };
