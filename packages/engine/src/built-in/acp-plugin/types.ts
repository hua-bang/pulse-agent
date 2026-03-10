import type { ToolExecutionContext } from '../../shared/types';

export interface AcpClientConfig {
  baseUrl: string;
  apiKey?: string;
  timeoutMs: number;
  initializePath: string;
  sessionNewPath: string;
  sessionPromptPath: string;
  sessionCancelPath: string;
  initializeOptional: boolean;
}

export interface AcpSessionBinding {
  remoteSessionId: string;
  acpSessionId: string;
  target: string;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export interface AcpSessionStore {
  initialize(): Promise<void>;
  get(remoteSessionId: string): Promise<AcpSessionBinding | null>;
  upsert(binding: Omit<AcpSessionBinding, 'createdAt' | 'updatedAt'>): Promise<AcpSessionBinding>;
  remove(remoteSessionId: string): Promise<void>;
}

export interface AcpNewSessionInput {
  target: string;
  metadata?: Record<string, unknown>;
}

export interface AcpNewSessionResult {
  sessionId: string;
  raw: unknown;
}

export interface AcpPromptInput {
  sessionId: string;
  prompt: string;
  target?: string;
  metadata?: Record<string, unknown>;
}

export interface AcpPromptResult {
  text: string;
  finishReason?: string;
  raw: unknown;
}

export interface AcpCancelInput {
  sessionId: string;
  reason?: string;
}

export interface EnsureSessionInput {
  remoteSessionId: string;
  target?: string;
  metadata?: Record<string, unknown>;
  forceNewSession?: boolean;
}

export interface EnsureSessionResult {
  binding: AcpSessionBinding;
  reused: boolean;
}

export interface AcpBridgeStatus {
  configured: boolean;
  baseUrl?: string;
  timeoutMs: number;
  defaultTarget: string;
}

export type AcpToolExecutionContext = ToolExecutionContext | undefined;
