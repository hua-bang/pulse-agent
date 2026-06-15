export interface CanvasNode {
  id: string;
  type:
    | 'file'
    | 'terminal'
    | 'frame'
    | 'group'
    | 'agent'
    | 'text'
    | 'iframe'
    | 'image'
    | 'shape'
    | 'mindmap'
    | 'reference'
    | 'dynamic-app';
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  ref?: CanvasNodeRef;
  properties?: Record<string, WorkspaceNodePropertyValue>;
  links?: WorkspaceNodeLink[];
  data:
    | FileNodeData
    | TerminalNodeData
    | FrameNodeData
    | GroupNodeData
    | AgentNodeData
    | TextNodeData
    | IframeNodeData
    | ImageNodeData
    | ShapeNodeData
    | MindmapNodeData
    | ReferenceNodeData
    | DynamicAppNodeData;
  /** Epoch millis of last mutation; used for cross-process merge. */
  updatedAt?: number;
}

/**
 * Backing data for a `type: 'dynamic-app'` canvas node. The
 * dynamic-app plugin owns the runner and the URL; we persist enough to
 * find the right runner and render the iframe.
 */
export interface DynamicAppNodeData {
  /** Full loopback URL the iframe should load on the plugin's shared HTTP server. */
  url: string;
  /** Identity hook for persisted spec/state files and plugin IPC channels. */
  dynamicAppId: string;
}

export type WorkspaceNodePropertyValue =
  | string
  | number
  | boolean
  | null
  | string[]
  | number[]
  | { type: 'date'; value: string }
  | { type: 'url'; value: string }
  | { type: 'file'; path: string }
  | { type: 'node'; nodeId: string }
  | { type: 'workspace-node'; workspaceId: string; nodeId: string };

export interface WorkspaceNodeLink {
  relation: string;
  target: {
    workspaceId?: string;
    nodeId: string;
  };
  title?: string;
  properties?: Record<string, WorkspaceNodePropertyValue>;
}

export interface WorkspaceNodeRecord {
  schemaVersion: 1;
  id: string;
  type: string;
  title?: string;
  data: Record<string, unknown>;
  properties?: Record<string, WorkspaceNodePropertyValue>;
  links?: WorkspaceNodeLink[];
  updatedAt?: number;
  createdAt?: number;
}

export interface WorkspaceNodeListItem {
  workspaceId?: string;
  workspaceName?: string;
  id: string;
  type: string;
  title?: string;
  /** Friendlier label derived from the canvas node (text preview, mindmap root, ...). */
  displayTitle?: string;
  summary?: string;
  tags: string[];
  links?: WorkspaceNodeLink[];
  updatedAt?: number;
  createdAt?: number;
  hasData: boolean;
  linkCount: number;
  /** Whether a canvas node with this id currently exists in the workspace. Undefined when not computed. */
  onCanvas?: boolean;
}

export interface KnowledgeTagDefinition {
  id: string;
  name: string;
  description?: string;
  createdAt?: number;
  updatedAt?: number;
}

export type CanvasNodeRef =
  | {
      kind: 'workspace-node';
      workspaceId: string;
      nodeId: string;
    }
  | {
      kind: 'global-node';
      nodeId: string;
    };

export interface FileNodeData {
  filePath: string;
  content: string;
  saved?: boolean;
  modified?: boolean;
}

export interface TerminalNodeData {
  sessionId: string;
  scrollback?: string;
  cwd?: string;
  /** Shell command to execute automatically after the terminal spawns. */
  initialCommand?: string;
}

export interface FrameNodeData {
  color: string;
  label?: string;
  /** When true, descendants are kept in the canvas data but hidden from view. */
  childrenCollapsed?: boolean;
  agentTeamId?: string;
  agentTeamName?: string;
  agentTeamGoal?: string;
  agentTeamPanelHeight?: number;
}

export interface GroupNodeData {
  color?: string;
  label?: string;
  childIds?: string[];
}

export interface AgentNodeData {
  sessionId: string;
  scrollback?: string;
  cwd?: string;
  agentType: string;
  status?: 'idle' | 'running' | 'done' | 'error';
  agentArgs?: string;
  /**
   * When true, launch the agent in unrestricted mode:
   * - claude-code adds `--dangerously-skip-permissions`
   * - codex adds `--dangerously-bypass-approvals-and-sandbox`
   * Other agent types ignore this flag.
   */
  dangerousMode?: boolean;
  /** Short prompt passed directly as a CLI argument. */
  inlinePrompt?: string;
  /** Relative path to a prompt file in cwd for long prompts. */
  promptFile?: string;
  /**
   * Snapshot of the prompt the user supplied at launch time. `inlinePrompt`
   * is cleared after being sent to the CLI to prevent re-sending on the
   * next spawn, but the Restart view needs the original text to show what
   * the previous session was started with.
   */
  lastInitPrompt?: string;
  /**
   * Current AgentNodeBody view ('setup' | 'running' | 'restart'). Persisted
   * so the outer `CanvasNodeView` header can render the status pill that
   * matches the body and so a cold reload mid-running session can be
   * distinguished from an active live PTY.
   */
  viewMode?: 'setup' | 'running' | 'restart';
  /**
   * Caller-supplied session id for Claude Code. Claude accepts this on first
   * spawn via `--session-id <uuid>` and later via `--resume <uuid>`.
   */
  cliSessionId?: string;
  /**
   * Codex session id captured after first launch from Codex's local session
   * index. Codex does not accept caller-supplied ids on first spawn, but it
   * does support `codex resume <id>` once the created id is known.
   */
  codexSessionId?: string;
  /**
   * Short host marker appended to the initial Codex prompt so the renderer can
   * bind the created Codex thread id from local metadata after launch.
   */
  codexSessionMarker?: string;
  agentTeamAutoResume?: {
    sessionKey?: string;
    attempts?: number;
    lastAttemptAt?: number;
  };
  /** Team-managed node should launch an idle CLI session before task dispatch. */
  agentTeamWarmup?: boolean;
  /** The warmup CLI has produced output and is ready to receive team input. */
  agentTeamWarmupReady?: boolean;
  agentTeamId?: string;
  agentTeamAgentId?: string;
  agentTeamRole?: 'lead' | 'teammate';
}

/**
 * TLDRAW-style free-form text label on the canvas.
 *
 * Content is markdown. Colors are applied via inline styles so they
 * persist across reloads. `backgroundColor: 'transparent'` renders a
 * chrome-free label.
 */
export interface TextNodeData {
  content: string;
  textColor: string;
  backgroundColor: string;
  /** Optional font size in px; defaults to 18 when unset. */
  fontSize?: number;
  /** When false, the user has dragged a resize handle; respect width/height. */
  autoSize?: boolean;
}

/**
 * Embeds an external web page or renders raw HTML.
 *
 * `mode: 'url'` loads a remote page via Electron `<webview>`.
 * `mode: 'html'` renders user-supplied HTML in a sandboxed iframe.
 * `artifactId` sources rendered HTML from the workspace artifact store.
 */
export interface IframeNodeData {
  /** Full URL (including protocol) to load in the iframe. Empty = show URL input. */
  url: string;
  /** Raw HTML content to render when `mode` is `'html'` or `'ai'`. */
  html?: string;
  /** `'url'` embeds a remote page; `'html'` renders raw HTML; `'ai'` generates HTML from a prompt; `'artifact'` pulls from the artifact store. */
  mode?: 'url' | 'html' | 'ai' | 'artifact';
  /** The prompt used to generate HTML when `mode` is `'ai'`. */
  prompt?: string;
  /** Last page title reported by the embedded webview for URL mode. */
  pageTitle?: string;
  /** Last favicon URL reported by the embedded webview for URL mode. */
  faviconUrl?: string;
  /** When set, content is sourced from `artifacts.get(artifactId)`. */
  artifactId?: string;
}

/**
 * A free-form image pinned to the canvas. Created by pasting image data
 * onto the canvas; the bytes are persisted to the workspace images
 * directory and referenced by absolute path.
 */
export interface ImageNodeData {
  /** Absolute path on disk to the saved image file. */
  filePath: string;
}

/**
 * A primitive geometric shape drawn on the canvas. Rendered as an inline
 * SVG that fills the node box. Colors are stored as hex strings or
 * "transparent"; stroke width is in CSS pixels at scale=1.
 */
export interface ShapeNodeData {
  kind: 'rect' | 'rounded-rect' | 'ellipse' | 'triangle' | 'diamond' | 'hexagon' | 'star';
  fill: string;
  stroke: string;
  strokeWidth: number;
  text?: string;
  textColor?: string;
  /** Font size in px. Defaults to 16 when unset. */
  fontSize?: number;
}

/**
 * Heptabase-style mindmap card.
 *
 * The whole mindmap lives inside one canvas node; branches and children
 * are stored in a recursive `MindmapTopic` tree under `data.root`.
 */
export interface MindmapTopic {
  /** Stable id, unique within the containing mindmap only. */
  id: string;
  text: string;
  children: MindmapTopic[];
  /** When true, the subtree is hidden and descendants are skipped by layout. */
  collapsed?: boolean;
  /** Optional per-topic color override (hex). */
  color?: string;
}

export interface MindmapNodeData {
  root: MindmapTopic;
  /** Layout direction. v1 supports `'right'`; other values are reserved. */
  layout: 'right';
  /** Bumped on every topic add/remove/rename for external observers. */
  rev?: number;
}

export interface ReferenceNodeData {
  titleSnapshot?: string;
  typeSnapshot?: Exclude<CanvasNode['type'], 'reference'>;
  workspaceNameSnapshot?: string;
}

export interface CanvasTransform {
  x: number;
  y: number;
  scale: number;
}

/**
 * One end of a `CanvasEdge`.
 *
 * `node` tracks a node anchor; `point` is a free canvas coordinate.
 */
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

/**
 * A connection drawn between two endpoints on the canvas.
 *
 * Edges are first-class shapes. Either endpoint can be free so users can
 * draw arrows into empty space; when a bound node is deleted, the
 * renderer degrades the affected endpoint to a free point.
 */
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
  /** Epoch millis of last mutation; used for cross-process merge. */
  updatedAt?: number;
}

export interface CanvasSaveData {
  nodes: CanvasNode[];
  /** Connections between nodes. Optional for backwards compatibility. */
  edges?: CanvasEdge[];
  transform: CanvasTransform;
  savedAt: string;
}
