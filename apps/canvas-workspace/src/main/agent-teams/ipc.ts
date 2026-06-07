import { ipcMain } from 'electron';
import { getCanvasAgentTeamsService } from './service';
import type {
  CanvasAgentTeamAddAgentInput,
  CanvasAgentTeamCreateInput,
  CanvasAgentTeamCreateTaskInput,
} from './types';

const ok = <T extends Record<string, unknown>>(value: T): { ok: true } & T => ({ ok: true, ...value });
const fail = (err: unknown): { ok: false; error: string } => ({ ok: false, error: err instanceof Error ? err.message : String(err) });

export function setupCanvasAgentTeamsIpc(): void {
  const service = getCanvasAgentTeamsService();

  ipcMain.handle('agent-teams:create', async (_event, payload: CanvasAgentTeamCreateInput) => {
    try {
      const snapshot = await service.createTeam(payload);
      return ok({ snapshot });
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('agent-teams:list', async (_event, payload: { workspaceId: string }) => {
    try {
      const teams = await service.listTeams(payload.workspaceId);
      return ok({ teams });
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('agent-teams:snapshot', async (_event, payload: { workspaceId: string; teamId: string }) => {
    try {
      const snapshot = await service.snapshot(payload.workspaceId, payload.teamId);
      return ok({ snapshot });
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('agent-teams:add-agent', async (_event, payload: CanvasAgentTeamAddAgentInput) => {
    try {
      const snapshot = await service.addAgent(payload);
      return ok({ snapshot });
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('agent-teams:brief-lead', async (_event, payload: { workspaceId: string; teamId: string; content: string }) => {
    try {
      const snapshot = await service.briefLead(payload.workspaceId, payload.teamId, payload.content);
      return ok({ snapshot });
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('agent-teams:confirm-plan', async (_event, payload: { workspaceId: string; teamId: string }) => {
    try {
      const snapshot = await service.confirmPlan(payload.workspaceId, payload.teamId);
      return ok({ snapshot });
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('agent-teams:create-task', async (_event, payload: CanvasAgentTeamCreateTaskInput) => {
    try {
      const runtime = await service.createTask(payload);
      return ok({ runtime });
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('agent-teams:dispatch', async (_event, payload: { workspaceId: string; teamId: string }) => {
    try {
      const snapshot = await service.dispatch(payload.workspaceId, payload.teamId);
      return ok({ snapshot });
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('agent-teams:pause', async (_event, payload: { workspaceId: string; teamId: string }) => {
    try {
      const snapshot = await service.pauseTeam(payload.workspaceId, payload.teamId);
      return ok({ snapshot });
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('agent-teams:delete', async (_event, payload: { workspaceId: string; teamId: string }) => {
    try {
      const result = await service.deleteTeam(payload.workspaceId, payload.teamId);
      return ok(result);
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle(
    'agent-teams:complete-task',
    async (_event, payload: { workspaceId: string; teamId: string; taskId: string; result?: string }) => {
      try {
        const snapshot = await service.completeTask(
          payload.workspaceId,
          payload.teamId,
          payload.taskId,
          payload.result || 'Marked complete from the team frame.',
        );
        return ok({ snapshot });
      } catch (err) {
        return fail(err);
      }
    },
  );

  ipcMain.handle('agent-teams:answer-gate', async (_event, payload: { workspaceId: string; gateId: string; answer: string }) => {
    try {
      const snapshot = await service.answerGate(payload.workspaceId, payload.gateId, payload.answer);
      return ok({ snapshot });
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle(
    'agent-teams:open-gate',
    async (_event, payload: {
      workspaceId: string;
      teamId: string;
      agentId?: string;
      taskId?: string;
      reason: string;
      prompt: string;
    }) => {
      try {
        const snapshot = await service.openHumanGate(payload.workspaceId, payload.teamId, {
          agentId: payload.agentId,
          taskId: payload.taskId,
          reason: payload.reason,
          prompt: payload.prompt,
        });
        return ok({ snapshot });
      } catch (err) {
        return fail(err);
      }
    },
  );

  ipcMain.handle(
    'agent-teams:interrupt-agent',
    async (_event, payload: {
      workspaceId: string;
      teamId: string;
      agentId: string;
      mode: 'soft' | 'ctrl-c' | 'abort';
      reason?: string;
    }) => {
      try {
        const snapshot = await service.interruptAgent(
          payload.workspaceId,
          payload.teamId,
          payload.agentId,
          payload.mode,
          payload.reason,
        );
        return ok({ snapshot });
      } catch (err) {
        return fail(err);
      }
    },
  );

  ipcMain.handle(
    'agent-teams:send-input',
    async (_event, payload: { workspaceId: string; teamId: string; agentId: string; content: string }) => {
      try {
        const snapshot = await service.sendInput(payload.workspaceId, payload.teamId, payload.agentId, payload.content);
        return ok({ snapshot });
      } catch (err) {
        return fail(err);
      }
    },
  );

  ipcMain.handle(
    'agent-teams:agent-output',
    async (_event, payload: { workspaceId: string; nodeId: string; delta: string }) => {
      try {
        const snapshot = await service.reportAgentOutput(payload.workspaceId, payload.nodeId, payload.delta);
        return ok({ snapshot });
      } catch (err) {
        return fail(err);
      }
    },
  );

  ipcMain.handle(
    'agent-teams:agent-exit',
    async (_event, payload: { workspaceId: string; nodeId: string; code?: number }) => {
      try {
        const snapshot = await service.reportAgentExit(payload.workspaceId, payload.nodeId, payload.code);
        return ok({ snapshot });
      } catch (err) {
        return fail(err);
      }
    },
  );
}
