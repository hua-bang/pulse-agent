// Canvas Plugin contracts. Pure types only — safe to import from both the
// main and renderer tsconfigs.

import type { ComponentType } from 'react';

export interface AgentTurn {
  runId: string;
  sessionId: string;
  input?: unknown;
  messages?: unknown[];
  systemPrompt?: string;
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

export interface ChatCardSpec<T = unknown> {
  id: string;
  match: (message: ChatMessageRef) => T | null;
  Component: ComponentType<{ payload: T }>;
}

export interface RendererCtx {
  registerRoute(path: string, Component: ComponentType): void;
  registerChatCard<T>(spec: ChatCardSpec<T>): void;
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
