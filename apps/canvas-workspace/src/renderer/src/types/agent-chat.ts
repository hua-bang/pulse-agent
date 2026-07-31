import type {
  AgentChatMessage,
  AgentClarificationRequest,
  AgentRequestContext,
  AgentScopeRef,
  AgentSessionInfo,
  ChatImageAttachment,
  CrossWorkspaceSessionGroup,
  SessionSearchHit,
} from '../../../shared/agent-chat';
import type { RoleTurnEndEvent, RoleTurnStartEvent } from '../../../shared/agent-roles';

export type * from '../../../shared/agent-chat';

export interface AgentApi {
  prepareChat: (
    scopeRef: AgentScopeRef,
    message: string,
    mentionedWorkspaceIds?: string[],
    requestContext?: AgentRequestContext,
    attachments?: ChatImageAttachment[],
  ) => Promise<{ ok: boolean; sessionId?: string; code?: string; error?: string }>;
  /** Start a prepared turn only after run-scoped listeners are installed. */
  startChat: (sessionId: string) => Promise<{
    ok: boolean;
    modelProvider?: string;
    modelId?: string;
    modelLabel?: string;
    error?: string;
  }>;
  /** Release a prepared turn when its originating surface changes scope. */
  cancelPreparedChat: (sessionId: string) => Promise<{ ok: boolean }>;
  /** Check whether main still owns a prepared run when completion was not observed. */
  getRunStatus: (sessionId: string) => Promise<{ ok: boolean; active: boolean }>;
  /** Detect a run started from another chat surface or renderer window. */
  getScopeRunStatus: (
    scopeRef: AgentScopeRef,
  ) => Promise<{
    ok: boolean;
    active: boolean;
    sessionId?: string;
    pendingClarification?: AgentClarificationRequest;
  }>;
  /** @deprecated Compatibility path; new code must use prepareChat/startChat. */
  chat: (
    scopeRef: AgentScopeRef,
    message: string,
    mentionedWorkspaceIds?: string[],
    requestContext?: AgentRequestContext,
    attachments?: ChatImageAttachment[],
  ) => Promise<{ ok: boolean; sessionId?: string; code?: string; error?: string }>;
  onTextDelta: (
    sessionId: string,
    callback: (delta: string) => void,
  ) => () => void;
  onChatComplete: (
    sessionId: string,
    callback: (result: {
      ok: boolean;
      code?: string;
      activeSessionId?: string | null;
      response?: string;
      runId?: string;
      error?: string;
      stopped?: boolean;
      speakerRole?: { id: string; name: string; color: string };
    }) => void,
  ) => () => void;
  onToolCall: (
    sessionId: string,
    callback: (data: { name: string; args: any; toolCallId?: string }) => void,
  ) => () => void;
  onToolResult: (
    sessionId: string,
    callback: (data: {
      name: string;
      result: string;
      toolCallId?: string;
      status: 'succeeded' | 'failed' | 'cancelled';
      error?: string;
    }) => void,
  ) => () => void;
  /** Tool-input streaming: fired when LLM starts emitting tool arguments. */
  onToolInputStart: (
    sessionId: string,
    callback: (data: { id: string; toolName: string }) => void,
  ) => () => void;
  /** Each chunk of raw tool argument JSON. `id` matches `toolCallId` on the final tool-call. */
  onToolInputDelta: (
    sessionId: string,
    callback: (data: { id: string; delta: string }) => void,
  ) => () => void;
  onToolInputEnd: (
    sessionId: string,
    callback: (data: { id: string }) => void,
  ) => () => void;
  /**
   * Subscribe to side-channel visual stream chunks emitted by the
   * `visual_render` tool when the upstream LLM/provider does not stream
   * tool-call arguments.
   */
  onVisualStream: (
    callback: (data: {
      workspaceId: string;
      toolCallId: string;
      content: string;
      done?: boolean;
    }) => void,
  ) => () => void;
  onClarifyRequest: (
    sessionId: string,
    callback: (data: AgentClarificationRequest) => void,
  ) => () => void;
  /** Multi-role relay: fired before each segment (single-speaker turns emit one with total=1). */
  onRoleTurnStart: (
    sessionId: string,
    callback: (event: RoleTurnStartEvent) => void,
  ) => () => void;
  /** Fired after each successful segment with its finalized response + speaker snapshot. */
  onRoleTurnEnd: (
    sessionId: string,
    callback: (event: RoleTurnEndEvent) => void,
  ) => () => void;
  /** Graceful relay stop: current segment finishes, queued segments are skipped. */
  stopRelay: (sessionId: string) => Promise<{ ok: boolean; error?: string }>;
  answerClarification: (
    sessionId: string,
    requestId: string,
    answer: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  abort: (sessionId: string) => Promise<{ ok: boolean; error?: string }>;
  getStatus: (
    scopeRef: AgentScopeRef,
  ) => Promise<{ ok: boolean; active: boolean; messageCount: number }>;
  listSkills: (
    scopeRef: AgentScopeRef,
  ) => Promise<{ ok: boolean; skills?: Array<{ name: string; description: string }>; error?: string }>;
  getHistory: (
    scopeRef: AgentScopeRef,
  ) => Promise<{
    ok: boolean;
    messages?: AgentChatMessage[];
    activeSessionId?: string | null;
  }>;
  listSessions: (
    scopeRef: AgentScopeRef,
  ) => Promise<{ ok: boolean; sessions?: AgentSessionInfo[]; error?: string }>;
  newSession: (
    scopeRef: AgentScopeRef,
  ) => Promise<{
    ok: boolean;
    activeSessionId?: string | null;
    code?: string;
    error?: string;
  }>;
  branchSession: (
    scopeRef: AgentScopeRef,
    fromIndex: number,
  ) => Promise<{
    ok: boolean;
    sourceSessionId?: string;
    activeSessionId?: string | null;
    messages?: AgentChatMessage[];
    code?: string;
    error?: string;
  }>;
  rewindMessages: (
    scopeRef: AgentScopeRef,
    fromIndex: number,
  ) => Promise<{ ok: boolean; error?: string }>;
  loadSession: (
    scopeRef: AgentScopeRef,
    sessionId: string,
  ) => Promise<{
    ok: boolean;
    messages?: AgentChatMessage[];
    activeSessionId?: string | null;
    code?: string;
    error?: string;
  }>;
  renameSession: (
    scopeRef: AgentScopeRef,
    sessionId: string,
    title: string,
  ) => Promise<{ ok: boolean; activeSessionId?: string | null; code?: string; error?: string }>;
  setSessionPinned: (
    scopeRef: AgentScopeRef,
    sessionId: string,
    pinned: boolean,
  ) => Promise<{ ok: boolean; activeSessionId?: string | null; code?: string; error?: string }>;
  deleteSession: (
    scopeRef: AgentScopeRef,
    sessionId: string,
  ) => Promise<{
    ok: boolean;
    activeSessionId?: string | null;
    messages?: AgentChatMessage[];
    code?: string;
    error?: string;
  }>;
  listAllSessions: (
    workspaceNames: Record<string, string>,
  ) => Promise<{ ok: boolean; groups?: CrossWorkspaceSessionGroup[]; error?: string }>;
  /** Keyword search over stored session message content (for the @-mention popup). */
  searchSessions: (
    query: string,
    limit?: number,
  ) => Promise<{ ok: boolean; hits?: SessionSearchHit[]; error?: string }>;
  /** Current session id for a scope (live agent, falling back to disk). */
  getCurrentSession: (
    scopeRef: AgentScopeRef,
  ) => Promise<{ ok: boolean; sessionId?: string | null; error?: string }>;
  loadCrossWorkspaceSession: (
    targetWorkspaceId: string,
    sourceWorkspaceId: string,
    sessionId: string,
  ) => Promise<{ ok: boolean; messages?: AgentChatMessage[]; error?: string }>;
  activate: (workspaceId: string) => Promise<{ ok: boolean; error?: string }>;
  deactivate: (workspaceId: string) => Promise<{ ok: boolean; error?: string }>;
  addImageToCanvas: (
    workspaceId: string,
    imagePath: string,
    title?: string,
  ) => Promise<{ ok: boolean; nodeId?: string; error?: string }>;
  polishScheduledPrompt: (payload: {
    title: string;
    currentPrompt?: string;
  }) => Promise<{ ok: boolean; content?: string; error?: string }>;
  streamWorkspaceDoc: (payload: {
    workspaceName: string;
    intent: string;
    currentContent?: string;
  }) => Promise<{ ok: boolean; requestId?: string; error?: string }>;
  onWorkspaceDocDelta: (requestId: string, callback: (delta: string) => void) => () => void;
  onWorkspaceDocComplete: (
    requestId: string,
    callback: (result: { ok: boolean; content?: string; error?: string }) => void,
  ) => () => void;
}
