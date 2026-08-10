/** Host-facing TUI data shapes shared by the readline renderer and the Ink host. */

export interface TuiHelpItem {
  command: string;
  description: string;
}

export interface TuiRunSummary {
  elapsedMs: number;
  toolCalls: number;
  messages: number;
  estimatedTokens: number;
  mode?: string | null;
}

export interface TuiSessionSnapshot {
  sessionId?: string | null;
  taskListId?: string | null;
  messages: number;
  estimatedTokens: number;
  mode?: string | null;
}
