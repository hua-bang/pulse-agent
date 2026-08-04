import type { ModelMessage } from 'ai';
import type { Engine } from 'pulse-coder-engine';

import type { AgentRoleDefinition } from '../../../shared/agent-roles';
import type { AgentClarificationRequest } from '../../../shared/agent-chat';
import type { ResolvedCanvasModel } from '../model/config';
import type {
  CanvasAgentDebugTrace,
  CanvasAgentMessage,
  CanvasAgentToolCall,
} from '../types';
import type { CanvasToolResultEvent } from '../engine-stream-callbacks';

/**
 * The turn-backend boundary: everything that can execute ONE chat segment
 * (default assistant, persona role, or externally-driven role) behind the
 * same request/result shape. `executeCanvasAgentSegment` owns the
 * backend-agnostic policies — streamed-text accumulation, response-message
 * collection, and stopped-vs-failed abort normalization — so a backend only
 * runs the model turn and reports what it produced.
 *
 * Implementations today: the built-in Engine, embedded Pi AgentHarness, and
 * external coding-agent CLIs. New runtimes plug in here without touching the
 * chat pipeline.
 */

type ClarificationHandler = (request: AgentClarificationRequest) => Promise<string>;

export interface TurnSegmentRequest {
  /** Engine instance for the built-in backend; unused by CLI backends. */
  engine: Engine;
  context: { messages: ModelMessage[] };
  role: AgentRoleDefinition | null;
  chatSessionId: string;
  workspaceRootFolder?: string;
  history: CanvasAgentMessage[];
  currentAsk: string;
  handoffNames: string[];
  abortSignal: AbortSignal;
  executionMode: 'auto' | 'ask';
  onClarificationRequest?: ClarificationHandler;
  /** Always provided: the executor pre-wraps it so every delta is
   *  accumulated into the segment's `streamedText` before forwarding. */
  onText: (delta: string) => void;
  onToolCall?: (data: { name: string; args: any; toolCallId?: string }) => void;
  onToolResult?: (data: CanvasToolResultEvent) => void;
  onToolInputStart?: (data: { id: string; toolName: string }) => void;
  onToolInputDelta?: (data: { id: string; delta: string }) => void;
  onToolInputEnd?: (data: { id: string }) => void;
  modelConfig: ResolvedCanvasModel;
  configuredModel?: string;
  systemPrompt: string;
  debugTrace?: CanvasAgentDebugTrace;
  /**
   * Record messages the segment produced: appends to the live model history
   * AND to the executor's per-segment collection in one call, so partial
   * output survives an abort exactly like before the boundary existed.
   */
  recordResponseMessages: (messages: ModelMessage[]) => void;
  /** Engine compaction write-back (host history replacement). */
  replaceMessages: (messages: ModelMessage[]) => void;
}

export interface TurnSegmentResult {
  resultText: string;
  /** Tool calls carried by backends that never touch the engine's
   *  onToolCall persistence path (external CLIs). */
  toolCalls?: CanvasAgentToolCall[];
}

export interface AgentRuntimeCapabilities {
  /** Canvas tools (canvas_read_context, node creation, …) run natively. */
  nativeCanvasTools: boolean;
  /** How user-in-the-loop questions surface: engine clarification cards,
   *  Ask-mode approval gate, or not at all. */
  clarifications: 'native' | 'approval' | 'none';
  /** Whether the backend consumes the full model history or a rendered
   *  discussion window. */
  historyFidelity: 'full' | 'window';
  /** Who owns resumable conversation state across segments. */
  sessionResume: 'host' | 'cli';
  /** Whether an in-flight run accepts pi-style steer/follow-up input. */
  steering: 'native' | 'none';
  /** Which layer owns context compaction. */
  compaction: 'native' | 'host' | 'cli';
}

export interface AgentRuntime {
  id: 'engine' | 'external-cli' | (string & {});
  capabilities: AgentRuntimeCapabilities;
  runSegment(request: TurnSegmentRequest): Promise<TurnSegmentResult>;
  /** Queue an instruction at the next safe boundary of an active run. */
  steer?(sessionId: string, text: string): Promise<boolean>;
  /** Queue a new turn after the current active run settles. */
  followUp?(sessionId: string, text: string): Promise<boolean>;
}

/** @deprecated Use AgentRuntime; retained while callers migrate names. */
export type TurnBackend = AgentRuntime;
/** @deprecated Use AgentRuntimeCapabilities. */
export type TurnBackendCapabilities = AgentRuntimeCapabilities;
