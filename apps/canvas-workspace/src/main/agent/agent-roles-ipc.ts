/**
 * IPC handlers for the agent role library (multi-role chat personas).
 *
 * Channels:
 *   agent-roles:list    — all roles in the global library
 *   agent-roles:save    — create (no id) or update (with id) one role
 *   agent-roles:delete  — remove one role by id
 */

import { ipcMain } from 'electron';
import type { AgentRoleSaveInput } from '../../shared/agent-roles';
import { deleteAgentRole, listAgentRoles, saveAgentRole } from './roles-store';

export function setupAgentRolesIpc(): void {
  ipcMain.handle('agent-roles:list', async () => {
    try {
      return { ok: true, roles: await listAgentRoles() };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle('agent-roles:save', async (_event, payload: { input: AgentRoleSaveInput }) => {
    try {
      return { ok: true, role: await saveAgentRole(payload?.input ?? ({} as AgentRoleSaveInput)) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('agent-roles:delete', async (_event, payload: { id: string }) => {
    try {
      return { ok: true, removed: await deleteAgentRole(payload?.id ?? '') };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });
}
