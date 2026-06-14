import type {
  AgentChatMessage,
  AgentRequestContext,
  AgentScopeRef,
  AgentSessionInfo,
  ChatImageAttachment,
  CrossWorkspaceSessionGroup,
  SessionSearchHit,
} from '../../../shared/agent-chat';

export type * from '../../../shared/agent-chat';

export interface AgentApi {
  chat: (
    scopeRef: AgentScopeRef,
    message: string,
    mentionedWorkspaceIds?: string[],
    requestContext?: AgentRequestContext,
    attachments?: ChatImageAttachment[],
  ) => Promise<{ ok: boolean; sessionId?: string; error?: string }>;
  onTextDelta: (
    sessionId: string,
    callback: (delta: string) => void,
  ) => () => void;
  onChatComplete: (
    sessionId: string,
    callback: (result: { ok: boolean; response?: string; runId?: string; error?: string }) => void,
  ) => () => void;
  onToolCall: (
    sessionId: string,
    callback: (data: { name: string; args: any; toolCallId?: string }) => void,
  ) => () => void;
  onToolResult: (
    sessionId: string,
    callback: (data: { name: string; result: string; toolCallId?: string }) => void,
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
    callback: (data: { id: string; question: string; context?: string }) => void,
  ) => () => void;
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
  ) => Promise<{ ok: boolean; messages?: AgentChatMessage[] }>;
  listSessions: (
    scopeRef: AgentScopeRef,
  ) => Promise<{ ok: boolean; sessions?: AgentSessionInfo[]; error?: string }>;
  newSession: (
    scopeRef: AgentScopeRef,
  ) => Promise<{ ok: boolean; error?: string }>;
  rewindMessages: (
    scopeRef: AgentScopeRef,
    fromIndex: number,
  ) => Promise<{ ok: boolean; error?: string }>;
  loadSession: (
    scopeRef: AgentScopeRef,
    sessionId: string,
  ) => Promise<{ ok: boolean; messages?: AgentChatMessage[]; error?: string }>;
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
