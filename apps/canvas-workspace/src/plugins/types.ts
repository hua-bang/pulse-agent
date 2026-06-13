// Canvas Plugin contracts. Pure types only — safe to import from both the
// main and renderer tsconfigs.

import type { ComponentType } from 'react';

export interface AgentTurn {
  runId: string;
  sessionId: string;
  input?: unknown;
  messages?: unknown[];
  systemPrompt?: string;
  // Plugin-specific payload negotiated between the emitting site and
  // the subscribing plugin. Concrete shape is checked at the boundary
  // via a runtime cast.
  data?: unknown;
}

// `turnComplete` fires unconditionally after every agent turn (unlike
// `turnEnd`, which only fires when debug tracing is on) and carries the full
// turn text, so plugins like memory can react to every turn.
export type AgentEvent = 'turnStart' | 'turnEnd' | 'turnComplete';

export interface PluginStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  /** Remove the value at `key`. No-op when the key is absent. */
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
}

// ── Canvas-agent service handle (structural) ────────────────────────────────
//
// A narrow, structural view of the host's `CanvasAgentService` exposed to
// plugins via `MainCtx.getAgentService()`. Declared here (not imported from
// main) so this shared types file stays free of host/electron imports — the
// registry casts the real singleton to this shape at the boundary. Only the
// methods a plugin legitimately needs to *drive* a conversation are surfaced.
export interface AgentChatResult {
  ok: boolean;
  response?: string;
  runId?: string;
  error?: string;
}

export interface AgentClarificationRequest {
  id: string;
  question: string;
  context?: string;
}

export interface AgentToolCallInfo {
  name: string;
  args: unknown;
  toolCallId?: string;
}

export interface AgentToolResultInfo {
  name: string;
  result: string;
  toolCallId?: string;
}

export interface AgentToolInputStartInfo {
  id: string;
  toolName: string;
}

export interface AgentToolInputDeltaInfo {
  id: string;
  delta: string;
}

export interface AgentToolInputEndInfo {
  id: string;
}

export interface AgentStatusInfo {
  ok: boolean;
  active: boolean;
  messageCount: number;
}

export interface AgentSessionInfo {
  sessionId: string;
  date: string;
  messageCount: number;
  isCurrent: boolean;
}

export type AgentScope =
  | { kind: 'global' }
  | { kind: 'workspace'; workspaceId: string };

export interface CanvasAgentServiceRef {
  chat(
    workspaceId: string,
    message: string,
    onText?: (delta: string) => void,
    onToolCall?: (data: AgentToolCallInfo) => void,
    onToolResult?: (data: AgentToolResultInfo) => void,
    mentionedWorkspaceIds?: string[],
    onClarificationRequest?: (req: AgentClarificationRequest) => void,
    requestContext?: unknown,
    attachments?: unknown[],
    onToolInputStart?: (data: AgentToolInputStartInfo) => void,
    onToolInputDelta?: (data: AgentToolInputDeltaInfo) => void,
    onToolInputEnd?: (data: AgentToolInputEndInfo) => void,
  ): Promise<AgentChatResult>;
  chatWithScope(
    scope: AgentScope,
    message: string,
    onText?: (delta: string) => void,
    onToolCall?: (data: AgentToolCallInfo) => void,
    onToolResult?: (data: AgentToolResultInfo) => void,
    mentionedWorkspaceIds?: string[],
    onClarificationRequest?: (req: AgentClarificationRequest) => void,
    requestContext?: unknown,
    attachments?: unknown[],
    onToolInputStart?: (data: AgentToolInputStartInfo) => void,
    onToolInputDelta?: (data: AgentToolInputDeltaInfo) => void,
    onToolInputEnd?: (data: AgentToolInputEndInfo) => void,
  ): Promise<AgentChatResult>;
  abort(workspaceId: string): void;
  abortScope(scope: AgentScope): void;
  answerClarification(workspaceId: string, requestId: string, answer: string): boolean;
  answerClarificationForScope(scope: AgentScope, requestId: string, answer: string): boolean;
  getStatus(workspaceId: string): AgentStatusInfo;
  getStatusForScope(scope: AgentScope): AgentStatusInfo;
  /** Current session id for the workspace, or null when none is active. */
  getCurrentSessionId(workspaceId: string): string | null;
  /** Current session id for an agent scope, or null when none is active. */
  getCurrentSessionIdForScope(scope: AgentScope): string | null;
  newSession(workspaceId: string): Promise<{ ok: boolean; error?: string }>;
  newSessionForScope(scope: AgentScope): Promise<{ ok: boolean; error?: string }>;
  /** Swap the workspace's current session to an existing one by id. */
  loadSession(workspaceId: string, sessionId: string): Promise<{ ok: boolean; error?: string }>;
  /** Swap the scope's current session to an existing one by id. */
  loadSessionForScope(scope: AgentScope, sessionId: string): Promise<{ ok: boolean; error?: string }>;
  listSessions(workspaceId: string): Promise<AgentSessionInfo[]>;
  listSessionsForScope(scope: AgentScope): Promise<AgentSessionInfo[]>;
  copySessionToScope(
    sourceScope: AgentScope,
    sourceSessionId: string,
    targetScope: AgentScope,
  ): Promise<{ ok: boolean; sessionId?: string; messageCount?: number; error?: string }>;
}

// Subset of Electron's IpcMainInvokeEvent the plugin contract needs.
// Defined inline so the shared types file does not import 'electron',
// which is only valid in the main tsconfig.
export interface PluginIpcInvokeEvent {
  sender: unknown;
  frameId: number;
}

export type PluginIpcHandler = (
  event: PluginIpcInvokeEvent,
  ...args: unknown[]
) => unknown;

export interface MainCtx {
  store: PluginStore;
  // Mirror of ipcMain.handle: register a channel callable from the
  // renderer plugin via ctx.invoke. Channel is auto-prefixed with
  // `plugin:<id>:` so plugins cannot collide with each other or with
  // existing host IPC.
  handle(channel: string, handler: PluginIpcHandler): void;
  onAgent(event: AgentEvent, handler: (turn: AgentTurn) => void): () => void;
  /**
   * Access the host's Canvas Agent service singleton. Lets a plugin *drive*
   * conversations (e.g. relay a chat turn from an external channel) rather
   * than only observe them via {@link onAgent}. Returns a narrow structural
   * view — see {@link CanvasAgentServiceRef}.
   */
  getAgentService(): CanvasAgentServiceRef;
  /**
   * Register a factory that contributes canvas-agent tools. The factory
   * is invoked once per workspace at canvas-agent construction time —
   * it receives the workspaceId and returns a name → tool map. Tools
   * from all registered factories are merged into the canvas-agent's
   * tool set; later entries with the same name shadow earlier ones.
   *
   * The factory's return value is intentionally typed as `unknown` here
   * so this shared types module does not have to import the host's
   * `CanvasTool` definition (which lives in main and cannot be imported
   * from the renderer half). The host casts to the concrete type at
   * the registry boundary.
   */
  registerCanvasTool(factory: CanvasToolFactory): void;
}

/**
 * Factory contract for plugin-contributed canvas-agent tools. Called
 * once per workspace when the canvas-agent boots; the plugin can use
 * the workspaceId to scope tool behaviour. Returns a `Record<toolName, tool>`
 * where each tool conforms to the host's `CanvasTool` shape — checked
 * structurally at the boundary, not via a TS import.
 */
export type CanvasToolFactory = (workspaceId: string) => Record<string, unknown>;

// Minimal contract — hosts pass any chat-message object that has at
// least a `role`. Plugins' match() functions cast to read whatever
// extra fields they care about (e.g. `debugTrace`, `meta`).
export interface ChatMessageRef {
  role: string;
}

// Chat card contract.
//
//   match() returns a lightweight reference when the card applies to the
//   message, or null to skip. When the plugin needs to hydrate the ref
//   into a fuller payload (e.g. fetch trace data via ctx.invoke), it
//   passes a resolve() — the framework renders <Loading>, awaits the
//   promise, then <Component>. Without resolve() the card stays sync:
//   the ref is the payload, and Component renders immediately.
export interface ChatCardSpec<TRef = unknown, TPayload = TRef> {
  id: string;
  match: (message: ChatMessageRef) => TRef | null;
  resolve?: (ref: TRef) => Promise<TPayload>;
  Component: ComponentType<{ payload: TPayload }>;
  Loading?: ComponentType<{ ref: TRef }>;
  Error?: ComponentType<{ ref: TRef; error: unknown }>;
}

export interface NavItem {
  id: string;
  path: string;
  label: string;
  title?: string;
  icon?: ComponentType<{ size?: number }>;
}

export interface RendererCtx {
  registerRoute(path: string, Component: ComponentType): void;
  registerChatCard<TRef = unknown, TPayload = TRef>(
    spec: ChatCardSpec<TRef, TPayload>,
  ): void;
  registerNavItem(item: NavItem): void;
  // Mirror of ipcRenderer.invoke: call a channel registered by this
  // plugin's main half via ctx.handle. Plugin id is bound on activation
  // so the renderer code does not have to repeat it.
  invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T>;
}

// Preload-side bridge that backs RendererCtx.invoke. The host preload
// exposes this on `window.canvasWorkspace.plugin` so the renderer half
// of every plugin can reach its main half through a single, generic
// channel.
export interface PluginBridge {
  invoke<T = unknown>(
    pluginId: string,
    channel: string,
    ...args: unknown[]
  ): Promise<T>;
}

// Main-side and renderer-side halves are declared separately so each
// half can live in its own bundle. A "plugin" in conversation usually
// refers to a matched pair sharing the same id.
export interface MainCanvasPlugin {
  id: string;
  enabledWhen?: () => boolean;
  activate(ctx: MainCtx): void | Promise<void>;
  /**
   * Optional teardown, called on app shutdown for plugins that hold
   * long-lived resources (sockets, timers, external connections). Only
   * invoked for plugins that activated successfully.
   */
  deactivate?(): void | Promise<void>;
}

export interface RendererCanvasPlugin {
  id: string;
  enabledWhen?: () => boolean;
  activate(ctx: RendererCtx): void;
}
