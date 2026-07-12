/**
 * CanvasAgentService — manages one Canvas Agent per workspace.
 *
 * Lifecycle:
 *   activate(workspaceId)  → creates + initializes agent
 *   chat(workspaceId, msg) → runs a turn
 *   deactivate(workspaceId) → archives session + destroys agent
 */

import { join } from 'path';
import { homedir } from 'os';
import { CanvasAgent, type CanvasClarificationRequest } from './canvas-agent';
import type { MCPServerStatus } from 'pulse-coder-engine/built-in';
import { GLOBAL_CHAT_SESSION_STORE_ID, GLOBAL_CHAT_WORKSPACE_NAME, SessionStore } from './session-store';
import { sessionPreview } from './session-preview';
import type {
  AgentRequestContext,
  AgentScope,
  CanvasAgentImageAttachment,
  ChatResponse,
  AgentStatusResponse,
  SessionListResponse,
  CanvasAgentMessage,
  CanvasAgentDebugRunDetail,
  CanvasAgentDebugRunSummary,
  CrossWorkspaceSessionGroup,
  SessionSearchHit,
} from './types';

const STORE_DIR = join(homedir(), '.pulse-coder', 'canvas');

const workspaceScope = (workspaceId: string): AgentScope => ({ kind: 'workspace', workspaceId });

const scopeKey = (scope: AgentScope): string =>
  scope.kind === 'global' ? 'global' : `workspace:${scope.workspaceId}`;

const scopeSessionStoreId = (scope: AgentScope): string =>
  scope.kind === 'global' ? GLOBAL_CHAT_SESSION_STORE_ID : scope.workspaceId;

export class CanvasAgentService {
  private agents = new Map<string, CanvasAgent>();

  private async activateScope(scope: AgentScope): Promise<void> {
    const key = scopeKey(scope);
    if (this.agents.has(key)) return;

    const workspaceId = scope.kind === 'workspace' ? scope.workspaceId : undefined;
    const agent = new CanvasAgent({
      scope,
      sessionStoreId: scopeSessionStoreId(scope),
      workspaceId,
      workspaceDir: workspaceId ? join(STORE_DIR, workspaceId) : undefined,
    });

    await agent.initialize();
    this.agents.set(key, agent);
  }

  private getAgent(scope: AgentScope): CanvasAgent | undefined {
    return this.agents.get(scopeKey(scope));
  }

  /**
   * Activate the Canvas Agent for a workspace. Idempotent — if already
   * active, returns immediately.
   */
  async activate(workspaceId: string): Promise<void> {
    await this.activateScope(workspaceScope(workspaceId));
  }

  /**
   * Send a chat message to the workspace's Canvas Agent.
   * Auto-activates the agent if not already active.
   * @param onText — optional callback receiving streaming text deltas
   * @param onClarificationRequest — invoked when the agent needs to ask the
   *   user a clarifying question; the caller must eventually deliver the
   *   reply via `answerClarification` or cancel via `abort`.
   */
  async chat(
    workspaceId: string,
    message: string,
    onText?: (delta: string) => void,
    onToolCall?: (data: { name: string; args: any; toolCallId?: string }) => void,
    onToolResult?: (data: { name: string; result: string; toolCallId?: string }) => void,
    mentionedWorkspaceIds?: string[],
    onClarificationRequest?: (req: CanvasClarificationRequest) => void,
    requestContext?: AgentRequestContext,
    attachments?: CanvasAgentImageAttachment[],
    onToolInputStart?: (data: { id: string; toolName: string }) => void,
    onToolInputDelta?: (data: { id: string; delta: string }) => void,
    onToolInputEnd?: (data: { id: string }) => void,
  ): Promise<ChatResponse> {
    return this.chatWithScope(
      workspaceScope(workspaceId),
      message,
      onText,
      onToolCall,
      onToolResult,
      mentionedWorkspaceIds,
      onClarificationRequest,
      requestContext,
      attachments,
      onToolInputStart,
      onToolInputDelta,
      onToolInputEnd,
    );
  }

  async chatWithScope(
    scope: AgentScope,
    message: string,
    onText?: (delta: string) => void,
    onToolCall?: (data: { name: string; args: any; toolCallId?: string }) => void,
    onToolResult?: (data: { name: string; result: string; toolCallId?: string }) => void,
    mentionedWorkspaceIds?: string[],
    onClarificationRequest?: (req: CanvasClarificationRequest) => void,
    requestContext?: AgentRequestContext,
    attachments?: CanvasAgentImageAttachment[],
    onToolInputStart?: (data: { id: string; toolName: string }) => void,
    onToolInputDelta?: (data: { id: string; delta: string }) => void,
    onToolInputEnd?: (data: { id: string }) => void,
  ): Promise<ChatResponse> {
    try {
      await this.activateScope(scope);
      const agent = this.getAgent(scope)!;
      const result = await agent.chat(
        message,
        onText,
        onToolCall,
        onToolResult,
        mentionedWorkspaceIds,
        onClarificationRequest,
        requestContext,
        attachments,
        onToolInputStart,
        onToolInputDelta,
        onToolInputEnd,
      );
      return { ok: true, response: result.response, runId: result.runId };
    } catch (err) {
      console.error(`[canvas-agent-service] chat error for ${scopeKey(scope)}:`, err);
      return { ok: false, error: String(err) };
    }
  }

  /**
   * Abort the workspace's currently-running chat turn (if any). No-op when
   * the agent is idle or not activated.
   */
  abort(workspaceId: string): void {
    this.abortScope(workspaceScope(workspaceId));
  }

  abortScope(scope: AgentScope): void {
    this.getAgent(scope)?.abort();
  }

  /**
   * Deliver the user's answer to a pending clarification request.
   * Returns true if a matching pending request was resolved.
   */
  answerClarification(workspaceId: string, requestId: string, answer: string): boolean {
    return this.answerClarificationForScope(workspaceScope(workspaceId), requestId, answer);
  }

  answerClarificationForScope(scope: AgentScope, requestId: string, answer: string): boolean {
    const agent = this.getAgent(scope);
    if (!agent) return false;
    return agent.answerClarification(requestId, answer);
  }

  /**
   * Get the agent's status for a workspace.
   */
  getStatus(workspaceId: string): AgentStatusResponse {
    return this.getStatusForScope(workspaceScope(workspaceId));
  }

  getStatusForScope(scope: AgentScope): AgentStatusResponse {
    const agent = this.getAgent(scope);
    if (!agent) return { ok: true, active: false, messageCount: 0 };
    return { ok: true, active: true, messageCount: agent.getMessageCount() };
  }

  /**
   * Current session id for a workspace's active agent, or null when the
   * agent is inactive or has no session yet. Lets callers (e.g. the channel
   * plugin) give each external conversation its own session by swapping the
   * current session via {@link loadSession} / {@link newSession}.
   */
  getCurrentSessionId(workspaceId: string): string | null {
    return this.getAgent(workspaceScope(workspaceId))?.getCurrentSessionId() ?? null;
  }

  getCurrentSessionIdForScope(scope: AgentScope): string | null {
    return this.getAgent(scope)?.getCurrentSessionId() ?? null;
  }

  /**
   * List skills (name + description) available to the workspace's agent.
   * Auto-activates the agent so the engine — and the skills plugin — is
   * initialized before reading the registry.
   */
  async listSkills(workspaceId: string): Promise<Array<{ name: string; description: string }>> {
    return this.listSkillsForScope(workspaceScope(workspaceId));
  }

  async listSkillsForScope(scope: AgentScope): Promise<Array<{ name: string; description: string }>> {
    await this.activateScope(scope);
    const agent = this.getAgent(scope)!;
    return agent.listSkills();
  }

  /**
   * Get conversation history for the current session.
   */
  getHistory(workspaceId: string): CanvasAgentMessage[] {
    return this.getHistoryForScope(workspaceScope(workspaceId));
  }

  getHistoryForScope(scope: AgentScope): CanvasAgentMessage[] {
    const agent = this.getAgent(scope);
    return agent?.getHistory() ?? [];
  }

  /**
   * List all sessions (current + archived) for a workspace.
   */
  async listSessions(workspaceId: string): Promise<Array<{ sessionId: string; date: string; messageCount: number; isCurrent: boolean }>> {
    return this.listSessionsForScope(workspaceScope(workspaceId));
  }

  async listSessionsForScope(scope: AgentScope): Promise<Array<{ sessionId: string; date: string; messageCount: number; isCurrent: boolean }>> {
    await this.activateScope(scope);
    const agent = this.getAgent(scope)!;
    return agent.listSessions();
  }

  /**
   * Drop the tail of the current session at and after `fromIndex`.
   * Used by edit / regenerate so the next chat turn picks up from a
   * clean slate without leaking the abandoned messages into context.
   */
  async rewindMessages(workspaceId: string, fromIndex: number): Promise<{ ok: boolean; error?: string }> {
    return this.rewindMessagesForScope(workspaceScope(workspaceId), fromIndex);
  }

  async rewindMessagesForScope(scope: AgentScope, fromIndex: number): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.activateScope(scope);
      const agent = this.getAgent(scope)!;
      agent.rewindTo(fromIndex);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  /**
   * Start a new session for a workspace.
   */
  async newSession(workspaceId: string): Promise<{ ok: boolean; error?: string }> {
    return this.newSessionForScope(workspaceScope(workspaceId));
  }

  async newSessionForScope(scope: AgentScope): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.activateScope(scope);
      const agent = this.getAgent(scope)!;
      await agent.newSession();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  /**
   * Load a specific session by sessionId.
   */
  async loadSession(workspaceId: string, sessionId: string): Promise<{ ok: boolean; messages?: CanvasAgentMessage[]; error?: string }> {
    return this.loadSessionForScope(workspaceScope(workspaceId), sessionId);
  }

  async loadSessionForScope(scope: AgentScope, sessionId: string): Promise<{ ok: boolean; messages?: CanvasAgentMessage[]; error?: string }> {
    try {
      await this.activateScope(scope);
      const agent = this.getAgent(scope)!;
      const messages = await agent.loadSession(sessionId);
      return { ok: true, messages };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  /**
   * List sessions from ALL workspaces, grouped by workspace.
   * @param workspaceNames — map of workspaceId → display name (from renderer manifest)
   */
  async listAllSessions(
    workspaceNames: Record<string, string>,
  ): Promise<CrossWorkspaceSessionGroup[]> {
    const diskGroups = await SessionStore.listAllWorkspaceSessions();
    const groups: CrossWorkspaceSessionGroup[] = [];

    for (const g of diskGroups) {
      // If this workspace has an active in-memory agent, use its live session list
      const scope: AgentScope = g.workspaceId === GLOBAL_CHAT_SESSION_STORE_ID
        ? { kind: 'global' }
        : workspaceScope(g.workspaceId);
      const agent = this.getAgent(scope);
      const sessions = agent
        ? await agent.listSessions()
        : g.sessions;

      groups.push({
        workspaceId: g.workspaceId,
        workspaceName: g.workspaceId === GLOBAL_CHAT_SESSION_STORE_ID
          ? GLOBAL_CHAT_WORKSPACE_NAME
          : workspaceNames[g.workspaceId] || g.workspaceId,
        sessions,
      });
    }

    // Sort: ensure workspaces with more recent sessions come first
    groups.sort((a, b) => {
      const aDate = a.sessions[0]?.date ?? '';
      const bDate = b.sessions[0]?.date ?? '';
      return bDate.localeCompare(aDate);
    });

    return groups;
  }

  /**
   * Current session id for a scope. Prefers the live agent (see
   * {@link getCurrentSessionIdForScope}); falls back to the on-disk
   * current.json so the renderer can record a back-navigation entry even
   * before the agent for that scope is activated.
   */
  async resolveCurrentSessionId(scope: AgentScope): Promise<string | null> {
    const live = this.getCurrentSessionIdForScope(scope);
    if (live) return live;
    return SessionStore.readCurrentSessionId(scopeSessionStoreId(scope));
  }

  /**
   * Keyword lookup over session TITLES — the first user message (the same
   * text the session rail shows as preview) plus the workspace name. Powers
   * the chat composer's @-mention popup, which only surfaces sessions when
   * the user has typed a query — so an empty/blank query returns nothing by
   * design.
   *
   * Deliberately NOT a full-content search: this runs on every keystroke
   * after `@`, so it stays cheap and predictable. Deep content search is the
   * agent-side `session_search` tool's job.
   */
  async searchSessions(query: string, limit = 8): Promise<SessionSearchHit[]> {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];

    const hits: SessionSearchHit[] = [];
    for (const entry of await SessionStore.readAllSessionsWithMeta()) {
      const { session } = entry;
      const firstUserMsg = session.messages.find(m => m.role === 'user');
      const title = firstUserMsg ? firstUserMsg.content.replace(/\s+/g, ' ').trim() : '';
      const haystack = `${title}\n${entry.workspaceName}`.toLowerCase();
      if (!haystack.includes(normalized)) continue;

      hits.push({
        sessionId: session.sessionId,
        workspaceId: session.workspaceId,
        workspaceName: entry.workspaceName,
        date: session.startedAt?.slice(0, 10) ?? '',
        isCurrent: entry.isCurrent,
        messageCount: session.messages.length,
        preview: sessionPreview(title, 60),
      });
      if (hits.length >= limit) break;
    }
    return hits;
  }

  /**
   * Load a session from a different workspace into the current workspace's agent.
   */
  async loadCrossWorkspaceSession(
    targetWorkspaceId: string,
    sourceWorkspaceId: string,
    sessionId: string,
  ): Promise<{ ok: boolean; messages?: CanvasAgentMessage[]; error?: string }> {
    try {
      // Read session data from source workspace
      const session = await SessionStore.readSessionFromWorkspace(sourceWorkspaceId, sessionId);
      if (!session) return { ok: false, error: 'Session not found in source workspace' };

      // Activate target workspace agent
      await this.activate(targetWorkspaceId);
      const agent = this.getAgent(workspaceScope(targetWorkspaceId))!;

      // Archive current session, then set loaded messages as current view
      await agent.loadCrossWorkspaceSession(session.messages);

      return { ok: true, messages: session.messages };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  async copySessionToScope(
    sourceScope: AgentScope,
    sourceSessionId: string,
    targetScope: AgentScope,
  ): Promise<{ ok: boolean; sessionId?: string; messageCount?: number; error?: string }> {
    try {
      const session = await SessionStore.readSessionFromWorkspace(
        scopeSessionStoreId(sourceScope),
        sourceSessionId,
      );
      if (!session) return { ok: false, error: 'Source session not found' };
      if (session.messages.length === 0) {
        return { ok: true, messageCount: 0 };
      }

      await this.activateScope(targetScope);
      const agent = this.getAgent(targetScope)!;
      await agent.loadCrossWorkspaceSession(session.messages);

      return {
        ok: true,
        sessionId: agent.getCurrentSessionId() ?? undefined,
        messageCount: session.messages.length,
      };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }


  /**
   * Re-scan skills for active agents after a skills config change.
   * Global-scope edits affect every workspace, so pass no id to refresh all
   * active agents; pass a workspaceId to refresh just that one.
   */
  async reloadSkills(workspaceId?: string): Promise<void> {
    const agents = workspaceId
      ? [this.getAgent(workspaceScope(workspaceId))].filter((a): a is CanvasAgent => Boolean(a))
      : Array.from(this.agents.values());
    await Promise.all(agents.map((agent) => agent.rescanSkills()));
  }

  /**
   * Rebuild the Engine for active agents after an MCP config change.
   * Global-scope edits affect every active agent and ensure the global agent is
   * available for status probing. Workspace edits activate and reload just that
   * workspace so an explicit Connect/Load Tools click always tests the server.
   */
  async reloadMcp(workspaceId?: string): Promise<void> {
    const targetScope: AgentScope = workspaceId ? workspaceScope(workspaceId) : { kind: 'global' };
    await this.activateScope(targetScope);
    const agents = workspaceId
      ? [this.getAgent(targetScope)].filter((a): a is CanvasAgent => Boolean(a))
      : Array.from(this.agents.values());
    await Promise.all(agents.map((agent) => agent.reloadEngine()));
  }

  /**
   * MCP per-server connection health for a given workspace's agent. Returns
   * an empty record if no agent is active for that workspace. For global edits,
   * prefer the global agent's status; fall back to any active workspace so older
   * status reads still have best-effort data before an explicit reload.
   */
  getMcpStatuses(workspaceId?: string): Record<string, MCPServerStatus> {
    if (workspaceId) {
      return this.getAgent(workspaceScope(workspaceId))?.getMcpStatuses() ?? {};
    }
    const global = this.getAgent({ kind: 'global' });
    if (global) return global.getMcpStatuses();
    const first = this.agents.values().next().value as CanvasAgent | undefined;
    return first?.getMcpStatuses() ?? {};
  }

  /**
   * Deactivate and archive the Canvas Agent for a workspace.
   */
  async deactivate(workspaceId: string): Promise<void> {
    const scope = workspaceScope(workspaceId);
    const key = scopeKey(scope);
    const agent = this.agents.get(key);
    if (!agent) return;
    await agent.destroy();
    this.agents.delete(key);
  }

  async deactivateScope(scope: AgentScope): Promise<void> {
    const key = scopeKey(scope);
    const agent = this.agents.get(key);
    if (!agent) return;
    await agent.destroy();
    this.agents.delete(key);
  }

  /**
   * Deactivate all agents (called on app shutdown).
   */
  async deactivateAll(): Promise<void> {
    const entries = Array.from(this.agents.entries());
    await Promise.all(entries.map(async ([key, agent]) => {
      await agent.destroy();
      this.agents.delete(key);
    }));
  }
}
