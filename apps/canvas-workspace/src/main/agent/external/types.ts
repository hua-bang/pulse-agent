import type { AgentRoleExternalFamily } from '../../../shared/agent-roles';
import type { ExternalStreamHandlers } from './tool-events';

/** One segment of a turn, produced by a local coding-agent CLI. */
export interface ExternalSegmentRequest extends ExternalStreamHandlers {
  family: AgentRoleExternalFamily;
  /** Working directory the agent runs in — also the safety boundary. */
  cwd: string;
  /** Fully rendered prompt (persona + labeled discussion window + ask). */
  prompt: string;
  /** CLI session to resume; absent → fresh session. */
  sessionId?: string;
  abortSignal: AbortSignal;
  timeoutMs?: number;
  /** Extension files for CLIs that support them (pi `-e <path>`). */
  extensionPaths?: string[];
  /** Extra argv appended after the family's base args (e.g. model pinning). */
  extraArgs?: string[];
  /** Extra environment for the spawned CLI (e.g. workspace binding). */
  env?: Record<string, string>;
}

export interface ExternalSegmentResult {
  text: string;
  /** CLI session id to persist for the next turn's resume. */
  sessionId?: string;
}
