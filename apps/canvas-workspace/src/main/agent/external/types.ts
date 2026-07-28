import type { AgentRoleExternalFamily } from '../../../shared/agent-roles';

/** One segment of a turn, produced by a local coding-agent CLI. */
export interface ExternalSegmentRequest {
  family: AgentRoleExternalFamily;
  /** Working directory the agent runs in — also the safety boundary. */
  cwd: string;
  /** Fully rendered prompt (persona + labeled discussion window + ask). */
  prompt: string;
  /** CLI session to resume; absent → fresh session. */
  sessionId?: string;
  abortSignal: AbortSignal;
  /** Streaming text as the agent produces it (may arrive in coarse chunks). */
  onText: (delta: string) => void;
  timeoutMs?: number;
}

export interface ExternalSegmentResult {
  text: string;
  /** CLI session id to persist for the next turn's resume. */
  sessionId?: string;
}
