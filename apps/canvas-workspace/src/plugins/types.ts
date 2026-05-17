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

export type AgentEvent = 'turnStart' | 'turnEnd';

export interface PluginStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  list(prefix?: string): Promise<string[]>;
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
}

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
}

export interface RendererCanvasPlugin {
  id: string;
  enabledWhen?: () => boolean;
  activate(ctx: RendererCtx): void;
}
