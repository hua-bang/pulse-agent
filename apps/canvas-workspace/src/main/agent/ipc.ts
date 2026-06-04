/**
 * IPC handlers for the Canvas Agent.
 *
 * Channels:
 *   canvas-agent:chat              — send a message, stream text deltas, get final response
 *   canvas-agent:abort             — interrupt the currently-running chat turn
 *   canvas-agent:clarify-answer    — deliver a user reply to a pending clarification
 *   canvas-agent:status            — check if agent is active
 *   canvas-agent:list-skills       — list skills (name + description) for the / popup
 *   canvas-agent:history           — get current session messages
 *   canvas-agent:sessions          — list all sessions (current + archived)
 *   canvas-agent:new-session       — start a new session
 *   canvas-agent:load-session      — load an archived session
 *   canvas-agent:activate          — explicitly start the agent
 *   canvas-agent:deactivate        — stop the agent and archive session
 *
 * Streaming:
 *   canvas-agent:chat returns { ok, sessionId } immediately.
 *   Text deltas arrive on         `canvas-agent:text-delta:{sessionId}`.
 *   Tool call starts arrive on    `canvas-agent:tool-call:{sessionId}`.
 *   Tool results arrive on        `canvas-agent:tool-result:{sessionId}`.
 *   Clarification requests arrive on `canvas-agent:clarify-request:{sessionId}`.
 *   Completion arrives on         `canvas-agent:chat-complete:{sessionId}`.
 */

import { BrowserWindow, ipcMain } from 'electron';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { basename, join } from 'path';
import { homedir } from 'os';
import { CanvasAgentService } from './service';
import { streamWorkspaceDoc } from './workspace-doc-generator';
import type { AgentScope, AgentScopeRef } from './types';

const STORE_DIR = join(homedir(), '.pulse-coder', 'canvas');

let service: CanvasAgentService | null = null;

/**
 * Track which agent scope each in-flight sessionId belongs to, so that
 * aborts and clarification answers from the renderer can be routed back to
 * the right agent instance. Entries are cleared when the corresponding chat
 * turn completes or is aborted.
 */
const sessionScopeMap = new Map<string, AgentScope>();

function resolveAgentScope(payload: AgentScopeRef): AgentScope {
  if (payload.scope?.kind === 'global') return { kind: 'global' };
  if (payload.scope?.kind === 'workspace' && payload.scope.workspaceId) {
    return { kind: 'workspace', workspaceId: payload.scope.workspaceId };
  }
  if (payload.workspaceId) return { kind: 'workspace', workspaceId: payload.workspaceId };
  return { kind: 'global' };
}

export function getCanvasAgentService(): CanvasAgentService {
  if (!service) {
    service = new CanvasAgentService();
  }
  return service;
}

function getService(): CanvasAgentService {
  return getCanvasAgentService();
}

export function setupCanvasAgentIpc(): void {
  const svc = getService();

  ipcMain.handle(
    'canvas-agent:chat',
    async (
      event,
      payload: {
        scope?: AgentScope;
        workspaceId?: string;
        message: string;
        mentionedWorkspaceIds?: string[];
        requestContext?: {
          executionMode?: 'auto' | 'ask';
          scope?: 'current_canvas' | 'selected_nodes';
          selectedNodes?: Array<{ id: string; title: string; type: string; workspaceId?: string }>;
          quickAction?: string;
        };
        attachments?: Array<{ id: string; path: string; fileName?: string; mimeType?: string }>;
      },
    ) => {
      const sessionId = randomUUID();
      const sender = event.sender;
      const scope = resolveAgentScope(payload);
      sessionScopeMap.set(sessionId, scope);

      // Fire-and-forget: run the agent asynchronously, streaming text deltas
      void (async () => {
        try {
          const result = await svc.chatWithScope(
            scope,
            payload.message,
            (delta) => {
              if (!sender.isDestroyed()) {
                sender.send(`canvas-agent:text-delta:${sessionId}`, delta);
              }
            },
            (toolCall) => {
              if (!sender.isDestroyed()) {
                sender.send(`canvas-agent:tool-call:${sessionId}`, toolCall);
              }
            },
            (toolResult) => {
              if (!sender.isDestroyed()) {
                sender.send(`canvas-agent:tool-result:${sessionId}`, toolResult);
              }
            },
            payload.mentionedWorkspaceIds,
            (req) => {
              if (!sender.isDestroyed()) {
                sender.send(`canvas-agent:clarify-request:${sessionId}`, req);
              }
            },
            payload.requestContext,
            payload.attachments,
            (data) => {
              if (!sender.isDestroyed()) {
                sender.send(`canvas-agent:tool-input-start:${sessionId}`, data);
              }
            },
            (data) => {
              if (!sender.isDestroyed()) {
                sender.send(`canvas-agent:tool-input-delta:${sessionId}`, data);
              }
            },
            (data) => {
              if (!sender.isDestroyed()) {
                sender.send(`canvas-agent:tool-input-end:${sessionId}`, data);
              }
            },
          );
          if (!sender.isDestroyed()) {
            sender.send(`canvas-agent:chat-complete:${sessionId}`, result);
          }
        } catch (err) {
          if (!sender.isDestroyed()) {
            sender.send(`canvas-agent:chat-complete:${sessionId}`, {
              ok: false,
              error: String(err),
            });
          }
        } finally {
          sessionScopeMap.delete(sessionId);
        }
      })();

      // Return immediately with the sessionId for the renderer to subscribe
      return { ok: true, sessionId };
    },
  );

  ipcMain.handle(
    'canvas-agent:abort',
    (_event, payload: { sessionId?: string; workspaceId?: string }) => {
      const scope =
        payload.sessionId ? sessionScopeMap.get(payload.sessionId) : undefined;
      if (scope) {
        svc.abortScope(scope);
        return { ok: true };
      }
      const workspaceId = payload.workspaceId;
      if (!workspaceId) return { ok: false, error: 'No active run for sessionId' };
      svc.abort(workspaceId);
      return { ok: true };
    },
  );

  ipcMain.handle(
    'canvas-agent:clarify-answer',
    (
      _event,
      payload: { sessionId: string; requestId: string; answer: string },
    ) => {
      const scope = sessionScopeMap.get(payload.sessionId);
      if (!scope) return { ok: false, error: 'No active run for sessionId' };
      const matched = svc.answerClarificationForScope(scope, payload.requestId, payload.answer);
      return { ok: matched, error: matched ? undefined : 'No pending clarification matched' };
    },
  );


  ipcMain.handle(
    'canvas-agent:add-image-to-canvas',
    async (_event, payload: { workspaceId: string; imagePath: string; title?: string }) => {
      try {
        const workspaceId = payload.workspaceId;
        const imagePath = payload.imagePath;
        if (!workspaceId || !imagePath) return { ok: false, error: 'workspaceId and imagePath are required' };

        const canvasPath = join(STORE_DIR, workspaceId, 'canvas.json');
        const raw = await fs.readFile(canvasPath, 'utf-8');
        const canvas = JSON.parse(raw) as {
          nodes?: Array<any>;
          edges?: Array<any>;
          transform?: { x: number; y: number; scale: number };
          savedAt?: string;
        };
        const nodes = Array.isArray(canvas.nodes) ? canvas.nodes : [];
        const maxRight = nodes.reduce((max, node) => Math.max(max, (node.x ?? 0) + (node.width ?? 0)), 0);
        const nodeId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const node = {
          id: nodeId,
          type: 'image',
          title: payload.title?.trim() || basename(imagePath),
          x: maxRight > 0 ? maxRight + 40 : 100,
          y: nodes[0]?.y ?? 100,
          width: 480,
          height: 360,
          data: { filePath: imagePath },
          updatedAt: Date.now(),
        };
        canvas.nodes = [...nodes, node];
        canvas.savedAt = new Date().toISOString();
        await fs.writeFile(canvasPath, JSON.stringify(canvas, null, 2), 'utf-8');

        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) {
            win.webContents.send('canvas:external-update', {
              type: 'canvas:updated',
              workspaceId,
              nodeIds: [nodeId],
              source: 'canvas-agent',
            });
          }
        }
        return { ok: true, nodeId };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  ipcMain.handle(
    'canvas-agent:status',
    (_event, payload: AgentScopeRef) => {
      return svc.getStatusForScope(resolveAgentScope(payload));
    },
  );

  ipcMain.handle(
    'canvas-agent:list-skills',
    async (_event, payload: AgentScopeRef) => {
      try {
        const skills = await svc.listSkillsForScope(resolveAgentScope(payload));
        return { ok: true, skills };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  ipcMain.handle(
    'canvas-agent:history',
    (_event, payload: AgentScopeRef) => {
      return { ok: true, messages: svc.getHistoryForScope(resolveAgentScope(payload)) };
    },
  );

  ipcMain.handle(
    'canvas-agent:sessions',
    async (_event, payload: AgentScopeRef) => {
      try {
        const sessions = await svc.listSessionsForScope(resolveAgentScope(payload));
        return { ok: true, sessions };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  ipcMain.handle(
    'canvas-agent:new-session',
    async (_event, payload: AgentScopeRef) => {
      try {
        return await svc.newSessionForScope(resolveAgentScope(payload));
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  ipcMain.handle(
    'canvas-agent:rewind-messages',
    async (_event, payload: AgentScopeRef & { fromIndex: number }) => {
      try {
        return await svc.rewindMessagesForScope(resolveAgentScope(payload), payload.fromIndex);
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  ipcMain.handle(
    'canvas-agent:load-session',
    async (_event, payload: AgentScopeRef & { sessionId: string }) => {
      try {
        return await svc.loadSessionForScope(resolveAgentScope(payload), payload.sessionId);
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  ipcMain.handle(
    'canvas-agent:all-sessions',
    async (_event, payload: { workspaceNames: Record<string, string> }) => {
      try {
        const groups = await svc.listAllSessions(payload.workspaceNames);
        return { ok: true, groups };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  ipcMain.handle(
    'canvas-agent:load-cross-workspace-session',
    async (_event, payload: { targetWorkspaceId: string; sourceWorkspaceId: string; sessionId: string }) => {
      try {
        return await svc.loadCrossWorkspaceSession(
          payload.targetWorkspaceId,
          payload.sourceWorkspaceId,
          payload.sessionId,
        );
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  ipcMain.handle(
    'canvas-agent:activate',
    async (_event, payload: { workspaceId: string }) => {
      try {
        await svc.activate(payload.workspaceId);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  ipcMain.handle(
    'canvas-agent:deactivate',
    async (_event, payload: { workspaceId: string }) => {
      try {
        await svc.deactivate(payload.workspaceId);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  // ── Workspace doc one-shot generation (user-triggered from settings) ──
  // The renderer subscribes to delta + complete events keyed by requestId
  // returned synchronously from the invoke. Mirrors the llm:stream-html
  // pattern. Never invoked from the agent loop.
  ipcMain.handle(
    'canvas-agent:stream-workspace-doc',
    (
      event,
      payload: { workspaceName: string; intent: string; currentContent?: string },
    ) => {
      if (!payload?.intent?.trim()) {
        return { ok: false, error: 'Intent is required' };
      }
      const requestId = randomUUID();
      const sender = event.sender;

      void (async () => {
        try {
          const result = await streamWorkspaceDoc(
            payload.workspaceName?.trim() || 'Workspace',
            payload.intent.trim(),
            payload.currentContent,
            (delta) => {
              if (!sender.isDestroyed()) {
                sender.send(`canvas-agent:workspace-doc-delta:${requestId}`, delta);
              }
            },
          );
          if (!sender.isDestroyed()) {
            sender.send(`canvas-agent:workspace-doc-complete:${requestId}`, result);
          }
        } catch (err) {
          if (!sender.isDestroyed()) {
            sender.send(`canvas-agent:workspace-doc-complete:${requestId}`, {
              ok: false,
              error: String(err),
            });
          }
        }
      })();

      return { ok: true, requestId };
    },
  );
}

export function teardownCanvasAgent(): void {
  if (service) {
    void service.deactivateAll();
    service = null;
  }
}
