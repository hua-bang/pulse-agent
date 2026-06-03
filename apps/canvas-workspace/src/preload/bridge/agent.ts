import type { IpcRenderer } from "electron";
import type { AgentApi } from "../../renderer/src/types";
import { subscribe } from "./ipc";

export const createAgentApi = (ipcRenderer: IpcRenderer): AgentApi => ({
  chat: (scopeRef, message, mentionedWorkspaceIds, requestContext, attachments) =>
    ipcRenderer.invoke("canvas-agent:chat", {
      ...scopeRef,
      message,
      mentionedWorkspaceIds,
      requestContext,
      attachments
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

  rewindMessages: (scopeRef, fromIndex) =>
    ipcRenderer.invoke("canvas-agent:rewind-messages", { ...scopeRef, fromIndex }),

  loadSession: (scopeRef, sessionId) =>
    ipcRenderer.invoke("canvas-agent:load-session", { ...scopeRef, sessionId }),

  listAllSessions: (workspaceNames) =>
    ipcRenderer.invoke("canvas-agent:all-sessions", { workspaceNames }),

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

  streamWorkspaceDoc: (payload) =>
    ipcRenderer.invoke("canvas-agent:stream-workspace-doc", payload),

  onWorkspaceDocDelta: (requestId, callback) =>
    subscribe<string>(ipcRenderer, `canvas-agent:workspace-doc-delta:${requestId}`, callback),

  onWorkspaceDocComplete: (requestId, callback) =>
    subscribe(ipcRenderer, `canvas-agent:workspace-doc-complete:${requestId}`, callback)
});
