/**
 * IPC for user-managed skills (global + per-workspace scope).
 *
 * Channels:
 *   canvas-skills:list    { scope }                       → status
 *   canvas-skills:upsert  { scope, skill }                → status
 *   canvas-skills:remove  { scope, name }                 → status
 *
 * After a write we hot-rescan affected agents so the next chat turn sees the
 * change without restarting: global edits refresh every active agent;
 * workspace edits refresh just that workspace.
 */

import { ipcMain } from 'electron';
import { parseScopePayload, type CanvasConfigScope } from '../config-scope';
import { getCanvasAgentService } from '../ipc';
import {
  getCanvasSkillsStatus,
  removeCanvasSkill,
  upsertCanvasSkill,
  type UpsertCanvasSkillInput,
} from './config';

async function refreshAgents(scope: CanvasConfigScope): Promise<void> {
  const service = getCanvasAgentService();
  await service.reloadSkills(scope.level === 'workspace' ? scope.workspaceId : undefined);
}

export function setupCanvasSkillsIpc(): void {
  ipcMain.handle('canvas-skills:list', async (_event, payload: { scope?: unknown }) => {
    try {
      const scope = parseScopePayload(payload?.scope);
      return { ok: true, status: await getCanvasSkillsStatus(scope) };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle(
    'canvas-skills:upsert',
    async (_event, payload: { scope?: unknown; skill: UpsertCanvasSkillInput }) => {
      try {
        const scope = parseScopePayload(payload?.scope);
        const status = await upsertCanvasSkill(scope, payload.skill);
        await refreshAgents(scope);
        return { ok: true, status };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  ipcMain.handle(
    'canvas-skills:remove',
    async (_event, payload: { scope?: unknown; name: string }) => {
      try {
        const scope = parseScopePayload(payload?.scope);
        const status = await removeCanvasSkill(scope, payload.name);
        await refreshAgents(scope);
        return { ok: true, status };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );
}
