import type { IpcRenderer } from "electron";
import type { AgentApi } from "../../renderer/src/types";
import { subscribe } from "./ipc";

export const createAgentApi = (ipcRenderer: IpcRenderer): AgentApi => ({
  mcpApps: {
    listResources: (scope, serverName, cursor) =>
      ipcRenderer.invoke('canvas-agent:mcp-app-list-resources', { scope, serverName, cursor }),
    readResource: (scope, serverName, uri) =>
      ipcRenderer.invoke('canvas-agent:mcp-app-read-resource', { scope, serverName, uri }),
    callTool: (scope, serverName, toolName, args, approval) =>
      ipcRenderer.invoke('canvas-agent:mcp-app-call-tool', {
        scope,
        serverName,
        toolName,
        arguments: args,
        approval,
      }),
  },
  prepareChat: (scopeRef, message, mentionedWorkspaceIds, requestContext, attachments) =>
    ipcRenderer.invoke("canvas-agent:prepare-chat", {
      ...scopeRef,
      message,
      mentionedWorkspaceIds,
      requestContext,
      attachments
    }),

  markObservability: (input) =>
    ipcRenderer.invoke('canvas-agent:observability-mark', input),

  startChat: (sessionId) =>
    ipcRenderer.invoke("canvas-agent:start-chat", { sessionId }),

  cancelPreparedChat: (sessionId) =>
    ipcRenderer.invoke("canvas-agent:cancel-prepared-chat", { sessionId }),

  getRunStatus: (sessionId, afterSequence) =>
    ipcRenderer.invoke("canvas-agent:run-status", { sessionId, afterSequence }),

  getScopeRunStatus: (scopeRef, sessionId) =>
    ipcRenderer.invoke("canvas-agent:scope-run-status", {
      ...scopeRef,
      sessionId,
    }),

  getScopeRunningSessions: (scopeRef) =>
    ipcRenderer.invoke("canvas-agent:conversation-running-sessions", scopeRef),

  chat: (scopeRef, message, mentionedWorkspaceIds, requestContext, attachments) =>
    ipcRenderer.invoke("canvas-agent:chat", {
      ...scopeRef,
      message,
      mentionedWorkspaceIds,
      requestContext,
      attachments
    }),

  conversationChat: (scope, sessionId, message, mentionedWorkspaceIds, requestContext, attachments) =>
    ipcRenderer.invoke("canvas-agent:conversation-chat", {
      scope,
      sessionId,
      message,
      mentionedWorkspaceIds,
      requestContext,
      attachments,
    }),

  conversationAbort: (scope, sessionId) =>
    ipcRenderer.invoke("canvas-agent:conversation-abort", {
      scope,
      sessionId,
    }),

  conversationStopRelay: (scope, sessionId) =>
    ipcRenderer.invoke("canvas-agent:conversation-stop-relay", {
      scope,
      sessionId,
    }),

  conversationClarifyAnswer: (scope, sessionId, requestId, answer) =>
    ipcRenderer.invoke("canvas-agent:conversation-clarify-answer", {
      scope,
      sessionId,
      requestId,
      answer,
    }),

  onTextDelta: (sessionId, callback) =>
    subscribe<string>(ipcRenderer, `canvas-agent:text-delta:${sessionId}`, callback),

  onChatComplete: (sessionId, callback) =>
    subscribe(ipcRenderer, `canvas-agent:chat-complete:${sessionId}`, callback),

  onToolCall: (sessionId, callback) =>
    subscribe(ipcRenderer, `canvas-agent:tool-call:${sessionId}`, callback),

  onToolResult: (sessionId, callback) =>
    subscribe(ipcRenderer, `canvas-agent:tool-result:${sessionId}`, callback),

  onToolInputStart: (sessionId, callback) =>
    subscribe(ipcRenderer, `canvas-agent:tool-input-start:${sessionId}`, callback),

  onToolInputDelta: (sessionId, callback) =>
    subscribe(ipcRenderer, `canvas-agent:tool-input-delta:${sessionId}`, callback),

  onToolInputEnd: (sessionId, callback) =>
    subscribe(ipcRenderer, `canvas-agent:tool-input-end:${sessionId}`, callback),

  onVisualStream: (callback) =>
    subscribe(ipcRenderer, "canvas-agent:visual-stream", callback),

  onClarifyRequest: (sessionId, callback) =>
    subscribe(ipcRenderer, `canvas-agent:clarify-request:${sessionId}`, callback),

  onRoleTurnStart: (sessionId, callback) =>
    subscribe(ipcRenderer, `canvas-agent:role-turn-start:${sessionId}`, callback),

  onRoleTurnEnd: (sessionId, callback) =>
    subscribe(ipcRenderer, `canvas-agent:role-turn-end:${sessionId}`, callback),

  stopRelay: (sessionId) =>
    ipcRenderer.invoke("canvas-agent:stop-relay", { sessionId }),

  answerClarification: (sessionId, requestId, answer) =>
    ipcRenderer.invoke("canvas-agent:clarify-answer", { sessionId, requestId, answer }),

  abort: (sessionId) =>
    ipcRenderer.invoke("canvas-agent:abort", { sessionId }),

  getStatus: (scopeRef) =>
    ipcRenderer.invoke("canvas-agent:status", scopeRef),

  listSkills: (scopeRef) =>
    ipcRenderer.invoke("canvas-agent:list-skills", scopeRef),

  getHistory: (scopeRef) =>
    ipcRenderer.invoke("canvas-agent:history", scopeRef),

  listSessions: (scopeRef) =>
    ipcRenderer.invoke("canvas-agent:sessions", scopeRef),

  newSession: (scopeRef) =>
    ipcRenderer.invoke("canvas-agent:new-session", scopeRef),

  branchSession: (scopeRef, fromIndex) =>
    ipcRenderer.invoke("canvas-agent:branch-session", { ...scopeRef, fromIndex }),

  rewindMessages: (scopeRef, fromIndex) =>
    ipcRenderer.invoke("canvas-agent:rewind-messages", { ...scopeRef, fromIndex }),

  loadSession: (scopeRef, sessionId) =>
    ipcRenderer.invoke("canvas-agent:load-session", { ...scopeRef, sessionId }),

  renameSession: (scopeRef, sessionId, title) =>
    ipcRenderer.invoke("canvas-agent:rename-session", { ...scopeRef, sessionId, title }),

  setSessionPinned: (scopeRef, sessionId, pinned) =>
    ipcRenderer.invoke("canvas-agent:set-session-pinned", {
      ...scopeRef,
      sessionId,
      pinned
    }),

  deleteSession: (scopeRef, sessionId) =>
    ipcRenderer.invoke("canvas-agent:delete-session", { ...scopeRef, sessionId }),

  listAllSessions: (workspaceNames) =>
    ipcRenderer.invoke("canvas-agent:all-sessions", { workspaceNames }),

  searchSessions: (query, limit) =>
    ipcRenderer.invoke("canvas-agent:search-sessions", { query, limit }),

  getCurrentSession: (scopeRef) =>
    ipcRenderer.invoke("canvas-agent:current-session", scopeRef),

  warmScope: (scopeRef) =>
    ipcRenderer.send('canvas-agent:warm-scope', scopeRef),

  loadCrossWorkspaceSession: (targetWorkspaceId, sourceWorkspaceId, sessionId) =>
    ipcRenderer.invoke("canvas-agent:load-cross-workspace-session", {
      targetWorkspaceId,
      sourceWorkspaceId,
      sessionId
    }),

  activate: (workspaceId) =>
    ipcRenderer.invoke("canvas-agent:activate", { workspaceId }),

  deactivate: (workspaceId) =>
    ipcRenderer.invoke("canvas-agent:deactivate", { workspaceId }),

  addImageToCanvas: (workspaceId, imagePath, title) =>
    ipcRenderer.invoke("canvas-agent:add-image-to-canvas", { workspaceId, imagePath, title }),

  polishScheduledPrompt: (payload) =>
    ipcRenderer.invoke("canvas-agent:polish-scheduled-prompt", payload),

  streamWorkspaceDoc: (payload) =>
    ipcRenderer.invoke("canvas-agent:stream-workspace-doc", payload),

  onWorkspaceDocDelta: (requestId, callback) =>
    subscribe<string>(ipcRenderer, `canvas-agent:workspace-doc-delta:${requestId}`, callback),

  onWorkspaceDocComplete: (requestId, callback) =>
    subscribe(ipcRenderer, `canvas-agent:workspace-doc-complete:${requestId}`, callback)
});
