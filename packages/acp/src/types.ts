import type { ClarificationRequest } from 'pulse-coder-engine';

export type AcpAgent = 'claude' | 'codex';

export interface AcpChannelState {
  agent: AcpAgent;
  cwd: string;
  sessionId?: string;
}

export interface AcpStateStore {
  getState(platformKey: string): Promise<AcpChannelState | undefined>;
  setState(platformKey: string, state: AcpChannelState): Promise<void>;
  clearState(platformKey: string): Promise<void>;
  updateCwd(platformKey: string, cwd: string): Promise<boolean>;
  saveSessionId(platformKey: string, sessionId: string): Promise<void>;
}

export interface AcpRunnerCallbacks {
  onText?: (delta: string) => void;
  onToolCall?: (toolCall: unknown) => void;
  onToolResult?: (toolResult: unknown) => void;
  onClarificationRequest?: (request: ClarificationRequest) => Promise<string>;
}

export type AcpMcpServer =
  | { type?: 'stdio'; name: string; command: string; args: string[]; env: Array<{ name: string; value: string }>; [key: string]: unknown }
  | { type: 'http' | 'sse'; name: string; url: string; headers: Array<{ name: string; value: string }>; [key: string]: unknown };

export interface AcpSessionInfo {
  sessionId: string;
  cwd: string;
  title?: string | null;
  updatedAt?: string | null;
  [key: string]: unknown;
}

export interface AcpRunnerInput {
  platformKey: string;
  agent: AcpAgent;
  cwd: string;
  sessionId?: string;
  userText: string;
  abortSignal?: AbortSignal;
  callbacks?: AcpRunnerCallbacks;
  stateStore?: AcpStateStore;
  envOverrides?: Record<string, string | undefined>;
  unsetEnv?: string[];
  clientInfo?: {
    name: string;
    title?: string;
    version?: string;
  };
  clientCapabilities?: AcpClientCapabilities;
  mcpServers?: AcpMcpServer[];
  commandOverrides?: Partial<Record<AcpAgent, string>>;
}

export interface AcpRunnerResult {
  text: string;
  sessionId: string;
  stopReason: string;
}

export interface PermissionOption {
  optionId: string;
  kind?: string;
  name?: string;
  description?: string;
  [key: string]: unknown;
}

export interface PermissionRequest {
  sessionId?: string;
  toolCall?: Record<string, unknown>;
  options: PermissionOption[];
  rawParams: Record<string, unknown>;
}

export type PermissionOutcome =
  | { outcome: 'selected'; optionId: string }
  | { outcome: 'cancelled' };

export type PermissionRequestHandler = (request: PermissionRequest) => Promise<PermissionOutcome | null>;

export interface AcpClientOptions {
  onPermissionRequest?: PermissionRequestHandler;
  commandOverrides?: Partial<Record<AcpAgent, string>>;
  envOverrides?: Record<string, string | undefined>;
  unsetEnv?: string[];
}

export interface AcpClientCapabilities {
  fs?: {
    readTextFile?: boolean;
    writeTextFile?: boolean;
  };
  terminal?: boolean;
}

export interface AcpInitializeInput {
  protocolVersion: number;
  clientCapabilities?: AcpClientCapabilities;
  clientInfo?: {
    name: string;
    title?: string;
    version?: string;
  };
}

export interface SessionUpdateNotification {
  sessionId: string;
  update: {
    sessionUpdate: 'plan' | 'agent_message_chunk' | 'tool_call' | 'tool_call_update';
    content?: { type: string; text: string };
    toolCallId?: string;
    title?: string;
    kind?: string;
    status?: 'pending' | 'in_progress' | 'completed' | 'cancelled';
    entries?: unknown[];
  };
}

export interface InitializeResult {
  protocolVersion: number;
  agentCapabilities: {
    loadSession?: boolean;
    sessionCapabilities?: {
      resume?: Record<string, unknown> | null;
      list?: Record<string, unknown> | null;
      close?: Record<string, unknown> | null;
      [key: string]: unknown;
    };
    mcpCapabilities?: {
      http?: boolean;
      sse?: boolean;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  agentInfo?: { name: string; title?: string; version?: string } | null;
  authMethods?: unknown[];
}

export interface SessionNewResult {
  sessionId: string;
  configOptions?: unknown[] | null;
  modes?: unknown | null;
}

export interface SessionReconnectResult {
  configOptions?: unknown[] | null;
  modes?: unknown | null;
}

export interface ListSessionsResult {
  sessions: AcpSessionInfo[];
  nextCursor?: string | null;
}

export interface PromptResult {
  stopReason: 'end_turn' | 'max_tokens' | 'max_turn_requests' | 'refusal' | 'cancelled';
}
