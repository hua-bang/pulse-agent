import type { ModelMessage } from 'ai';
import type { Engine } from 'pulse-coder-engine';

import type { AgentRoleDefinition } from '../../../shared/agent-roles';
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
 * Implementations today: the built-in engine (`engine-backend.ts`) and the
 * external coding-agent CLIs (`external-cli-backend.ts`). A future native
 * backend (e.g. pi) plugs in here without touching the chat pipeline.
 */

type ClarificationHandler = (request: {
  id: string;
  question: string;
  context?: string;
}) => Promise<string>;

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

export interface TurnBackendCapabilities {
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
}

export interface TurnBackend {
  id: 'engine' | 'external-cli' | (string & {});
  capabilities: TurnBackendCapabilities;
  runSegment(request: TurnSegmentRequest): Promise<TurnSegmentResult>;
}
