/**
 * IPC handlers for agent-team operations.
 * Registers handlers that bridge renderer ↔ AgentTeamManager.
 */

import { ipcMain } from 'electron';
import type { AgentTeamManager, AgentRuntime } from './agent-team-manager';

export function setupAgentTeamIpc(manager: AgentTeamManager): void {
  ipcMain.handle(
    'agent-team:spawn',
    async (_event, payload: {
      teammateId: string;
      runtime: AgentRuntime;
      cwd?: string;
      model?: string;
      spawnPrompt?: string;
      teamStateDir?: string;
    }) => {
      try {
        const result = await manager.spawnAgent(payload);
        return { ok: true, ...result };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  ipcMain.on(
    'agent-team:input',
    (_event, payload: { teammateId: string; data: string }) => {
      manager.sendInput(payload.teammateId, payload.data);
    },
  );

  ipcMain.on(
    'agent-team:resize',
    (_event, payload: { teammateId: string; cols: number; rows: number }) => {
      manager.resizeAgent(payload.teammateId, payload.cols, payload.rows);
    },
  );

  ipcMain.handle(
    'agent-team:stop',
    (_event, payload: { teammateId: string }) => {
      manager.stopAgent(payload.teammateId);
      return { ok: true };
    },
  );

  ipcMain.handle(
    'agent-team:stop-all',
    () => {
      manager.stopAll();
      return { ok: true };
    },
  );

  ipcMain.handle(
    'agent-team:list',
    () => {
      return { ok: true, agents: manager.listAgents() };
    },
  );
}
