import type { AgentScope, CanvasAgentMessage, CanvasAgentSession } from './types';

export interface SessionMutationAgent {
  abort?(sessionId?: string): void;
  getCurrentSessionId(): string | null;
  newSession(): Promise<void>;
  branchSession(
    fromIndex: number,
  ): Promise<{ sourceSessionId: string; session: CanvasAgentSession } | null>;
  renameSession(sessionId: string, title: string): Promise<boolean>;
  setSessionPinned(sessionId: string, pinned: boolean): Promise<boolean>;
  deleteSession(sessionId: string): Promise<{
    deletedCurrent: boolean;
    activeSession: CanvasAgentSession;
  } | null>;
  rewindTo(fromIndex: number): void;
  loadSession(sessionId: string): Promise<CanvasAgentSession | null>;
  loadCrossWorkspaceSession(messages: CanvasAgentMessage[]): Promise<void>;
  appendToSession(sessionId: string, messages: CanvasAgentMessage[]): Promise<void>;
  readSessionById(sessionId: string): Promise<CanvasAgentSession | null>;
  replaceSessionMessagesById(sessionId: string, messages: CanvasAgentMessage[]): Promise<void>;
}
export type SessionMutationFailure = {
  ok: false;
  activeSessionId: string | null;
  code: 'CHAT_SCOPE_BUSY' | 'SESSION_MUTATION_FAILED' | 'SESSION_NOT_FOUND';
  error: string;
};

export type SessionActionResult =
  | { ok: true; activeSessionId: string }
  | SessionMutationFailure;

export type NewSessionResult = SessionActionResult;

export type LoadSessionResult =
  | { ok: true; activeSessionId: string; messages: CanvasAgentMessage[] }
  | SessionMutationFailure;

export type BranchSessionResult =
  | {
      ok: true;
      sourceSessionId: string;
      activeSessionId: string;
      messages: CanvasAgentMessage[];
    }
  | SessionMutationFailure;

export type DeleteSessionResult =
  | {
      ok: true;
      deletedCurrent: boolean;
      activeSessionId: string;
      messages: CanvasAgentMessage[];
    }
  | SessionMutationFailure;

export interface StoredSessionLoad {
  session: CanvasAgentSession | null;
  activeSessionId: string | null;
}

export interface PendingSessionRun {
  scope: AgentScope;
  sessionId?: string | null;
  promise: Promise<unknown>;
}

