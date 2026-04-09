/**
 * IPC handlers for the Canvas Agent.
 *
 * Channels:
 *   canvas-agent:chat     — send a message, get a response
 *   canvas-agent:status   — check if agent is active
 *   canvas-agent:history  — get current session messages
 *   canvas-agent:activate — explicitly start the agent
 *   canvas-agent:deactivate — stop the agent and archive session
 */

import { ipcMain } from 'electron';
import { CanvasAgentService } from './canvas-agent/service';

let service: CanvasAgentService | null = null;

function getService(): CanvasAgentService {
  if (!service) {
    service = new CanvasAgentService();
  }
  return service;
}

export function setupCanvasAgentIpc(): void {
  const svc = getService();

  ipcMain.handle(
    'canvas-agent:chat',
    async (_event, payload: { workspaceId: string; message: string }) => {
      return await svc.chat(payload.workspaceId, payload.message);
    },
  );

  ipcMain.handle(
    'canvas-agent:status',
    (_event, payload: { workspaceId: string }) => {
      return svc.getStatus(payload.workspaceId);
    },
  );

  ipcMain.handle(
    'canvas-agent:history',
    (_event, payload: { workspaceId: string }) => {
      return { ok: true, messages: svc.getHistory(payload.workspaceId) };
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
}

export function teardownCanvasAgent(): void {
  if (service) {
    void service.deactivateAll();
    service = null;
  }
}
