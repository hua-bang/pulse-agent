import type {
  AgentScope,
  CanvasAgentMessage,
  CanvasAgentSession,
} from './types';

interface SessionMutationAgent {
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

const scopeMutationKey = (scope: AgentScope): string => {
  if (scope.kind === 'workspace') return `workspace:${scope.workspaceId}`;
  if (scope.kind === 'scheduled') return `scheduled:${scope.taskId}`;
  return 'global';
};


/**
 * Serializes session replacement per scope. Queue order is intent order, so
 * when A is slow and B is requested later, B still commits last. Different
 * scopes retain independent queues.
 *
 * Chat runs are gated per conversation session: two different sessions in the
 * same scope may run concurrently (session-anchored runs), while a second run
 * for the same session — or any run for a conversation-less legacy caller —
 * is rejected. Pointer mutations that would rewrite a session with an active
 * run (new/branch/rewind/delete/import of the running session) stay blocked;
 * view-only mutations (load, rename, pin) are allowed so the user can switch
 * between conversations while one of them streams.
 */
export class SessionMutationCoordinator {
  private tails = new Map<string, Promise<void>>();
  private activeRuns = new Set<string>();

  constructor(
    private readonly activateScope: (scope: AgentScope) => Promise<void>,
    private readonly getAgent: (scope: AgentScope) => SessionMutationAgent | undefined,
  ) {}

  /** Run identity: per scope + conversation session. Empty session = legacy exclusive. */
  private runKey(scope: AgentScope, conversationSessionId?: string | null): string {
    return `${scopeMutationKey(scope)}\u0000${conversationSessionId ?? ''}`;
  }

  /** True when a run anchors to `sessionId` (or a legacy exclusive run owns the scope). */
  private isSessionActive(scope: AgentScope, sessionId: string | null | undefined): boolean {
    if (!sessionId) return this.activeRuns.has(this.runKey(scope, null));
    return this.activeRuns.has(this.runKey(scope, sessionId))
      || this.activeRuns.has(this.runKey(scope, null));
  }

  newSession(scope: AgentScope): Promise<NewSessionResult> {
    return this.run(scope, async () => {
      try {
        const agent = await this.activeAgent(scope);
        // Creating a session is safe WHILE another conversation in the scope
        // streams: the run is session-anchored (its context + persistence do
        // not depend on the current pointer), so archiving the current session
        // and pointing at a fresh one leaves the run writing to its archived
        // copy (appendToSession's slow path). Other pointer mutations
        // (rewind/delete/branch) still reject a running session because they
        // would destroy or fork the run's own thread.
        await agent.newSession();
        const activeSessionId = agent.getCurrentSessionId();
        if (!activeSessionId) {
          return this.failure(scope, 'New session did not become active');
        }
        return { ok: true, activeSessionId };
      } catch (err) {
        return this.failure(scope, String(err));
      }
    });
  }

  rewindSession(
    scope: AgentScope,
    fromIndex: number,
  ): Promise<{ ok: boolean; error?: string }> {
    return this.run(scope, async () => {
      try {
        const agent = await this.activeAgent(scope);
        if (this.isSessionActive(scope, agent.getCurrentSessionId())) {
          return { ok: false, error: 'Another reply is already running for this chat scope.' };
        }
        agent.rewindTo(fromIndex);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    });
  }

  loadSession(scope: AgentScope, sessionId: string): Promise<LoadSessionResult> {
    return this.run(scope, async () => {
      try {
        const agent = await this.activeAgent(scope);
        const session = await agent.loadSession(sessionId);
        if (!session) {
          return this.failure(scope, 'Session not found', 'SESSION_NOT_FOUND');
        }

        const activeSessionId = agent.getCurrentSessionId();
        if (activeSessionId !== session.sessionId) {
          return this.failure(scope, 'Loaded session did not become active');
        }
        return {
          ok: true,
          activeSessionId,
          messages: session.messages,
        };
      } catch (err) {
        return this.failure(scope, String(err));
      }
    });
  }

  importSession(
    scope: AgentScope,
    messages: CanvasAgentMessage[],
  ): Promise<LoadSessionResult> {
    return this.run(scope, async () => {
      try {
        const agent = await this.activeAgent(scope);
        if (this.isSessionActive(scope, agent.getCurrentSessionId())) {
          return this.scopeBusyFailure(scope);
        }
        await agent.loadCrossWorkspaceSession(messages);
        const activeSessionId = agent.getCurrentSessionId();
        if (!activeSessionId) {
          return this.failure(scope, 'Imported session did not become active');
        }
        return { ok: true, activeSessionId, messages };
      } catch (err) {
        return this.failure(scope, String(err));
      }
    });
  }

  branchSession(scope: AgentScope, fromIndex: number): Promise<BranchSessionResult> {
    return this.run(scope, async () => {
      try {
        const agent = await this.activeAgent(scope);
        if (this.isSessionActive(scope, agent.getCurrentSessionId())) {
          return this.scopeBusyFailure(scope);
        }
        const branch = await agent.branchSession(fromIndex);
        if (!branch) {
          return this.failure(scope, 'Active session not found', 'SESSION_NOT_FOUND');
        }
        const activeSessionId = agent.getCurrentSessionId();
        if (activeSessionId !== branch.session.sessionId) {
          return this.failure(scope, 'Branched session did not become active');
        }
        return {
          ok: true,
          sourceSessionId: branch.sourceSessionId,
          activeSessionId,
          messages: branch.session.messages,
        };
      } catch (err) {
        return this.failure(scope, String(err));
      }
    });
  }

  renameSession(
    scope: AgentScope,
    sessionId: string,
    title: string,
  ): Promise<SessionActionResult> {
    return this.existingSessionAction(
      scope,
      (agent) => agent.renameSession(sessionId, title),
    );
  }

  setSessionPinned(
    scope: AgentScope,
    sessionId: string,
    pinned: boolean,
  ): Promise<SessionActionResult> {
    return this.existingSessionAction(
      scope,
      (agent) => agent.setSessionPinned(sessionId, pinned),
    );
  }

  deleteSession(scope: AgentScope, sessionId: string): Promise<DeleteSessionResult> {
    return this.run(scope, async () => {
      try {
        const agent = await this.activeAgent(scope);
        if (this.isSessionActive(scope, sessionId)) {
          return this.scopeBusyFailure(scope);
        }
        const deleted = await agent.deleteSession(sessionId);
        if (!deleted) {
          return this.failure(scope, 'Session not found', 'SESSION_NOT_FOUND');
        }
        const activeSessionId = agent.getCurrentSessionId();
        if (activeSessionId !== deleted.activeSession.sessionId) {
          return this.failure(scope, 'Session delete left an inconsistent active session');
        }
        return {
          ok: true,
          deletedCurrent: deleted.deletedCurrent,
          activeSessionId,
          messages: deleted.activeSession.messages,
        };
      } catch (err) {
        return this.failure(scope, String(err));
      }
    });
  }

  private async activeAgent(scope: AgentScope): Promise<SessionMutationAgent> {
    await this.activateScope(scope);
    const agent = this.getAgent(scope);
    if (!agent) throw new Error('Agent activation did not produce an active agent');
    return agent;
  }

  private scopeBusyFailure(scope: AgentScope): SessionMutationFailure {
    return {
      ok: false,
      activeSessionId: this.getAgent(scope)?.getCurrentSessionId() ?? null,
      code: 'CHAT_SCOPE_BUSY',
      error: 'Another reply is already running for this chat scope.',
    };
  }

  private failure(
    scope: AgentScope,
    error: string,
    code: SessionMutationFailure['code'] = 'SESSION_MUTATION_FAILED',
  ): SessionMutationFailure {
    const scopeBusy = error.includes('CHAT_SCOPE_BUSY');
    return {
      ok: false,
      activeSessionId: this.getAgent(scope)?.getCurrentSessionId() ?? null,
      code: scopeBusy ? 'CHAT_SCOPE_BUSY' : code,
      error: scopeBusy
        ? 'Another reply is already running for this chat scope.'
        : error,
    };
  }

  private run<T>(scope: AgentScope, operation: () => Promise<T>): Promise<T> {
    const key = scopeMutationKey(scope);
    const previous = this.tails.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(operation);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return run;
  }

  waitForIdle(scope: AgentScope): Promise<void> {
    return this.tails.get(scopeMutationKey(scope)) ?? Promise.resolve();
  }

  async runChat<T>(
    scope: AgentScope,
    operation: () => Promise<T>,
    conversationSessionId?: string | null,
  ): Promise<T | null> {
    const key = this.runKey(scope, conversationSessionId);
    if (this.activeRuns.has(key)) return null;
    await this.waitForIdle(scope);
    if (this.activeRuns.has(key)) return null;
    this.activeRuns.add(key);
    try {
      return await operation();
    } finally {
      this.activeRuns.delete(key);
    }
  }

  /**
   * Queue a session-addressed message append behind the scope's pointer
   * mutations so it never races an archive/load (both read the same files).
   * Fire-and-forget; the run awaits {@link waitForIdle} at completion so the
   * final messages are durable before chat-complete is published.
   */
  enqueueSessionAppend(
    scope: AgentScope,
    sessionId: string,
    messages: CanvasAgentMessage[],
  ): void {
    void this.run(scope, async () => {
      try {
        const agent = await this.activeAgent(scope);
        await agent.appendToSession(sessionId, messages);
      } catch (error) {
        console.error(
          `[session-mutation] Failed to persist ${messages.length} message(s) to ${sessionId}:`,
          error,
        );
      }
    });
  }

  private existingSessionAction(
    scope: AgentScope,
    action: (agent: SessionMutationAgent) => Promise<boolean>,
  ): Promise<SessionActionResult> {
    return this.run(scope, async () => {
      try {
        const agent = await this.activeAgent(scope);
        if (!await action(agent)) {
          return this.failure(scope, 'Session not found', 'SESSION_NOT_FOUND');
        }
        const activeSessionId = agent.getCurrentSessionId();
        return activeSessionId
          ? { ok: true, activeSessionId }
          : this.failure(scope, 'Session mutation left no active session');
      } catch (err) {
        return this.failure(scope, String(err));
      }
    });
  }

}
