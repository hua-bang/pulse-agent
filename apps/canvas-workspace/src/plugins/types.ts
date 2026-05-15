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
  registerIpc(channel: string, handler: PluginIpcHandler): void;
  onAgent(event: AgentEvent, handler: (turn: AgentTurn) => void): () => void;
}

export interface ChatMessageRef {
  role: string;
  meta?: Record<string, unknown>;
}

export interface ChatCardSpec<T = unknown> {
  id: string;
  match: (message: ChatMessageRef) => T | null;
  Component: ComponentType<{ payload: T }>;
}

export interface RendererCtx {
  registerRoute(path: string, Component: ComponentType): void;
  registerChatCard<T>(spec: ChatCardSpec<T>): void;
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
