/**
 * IPC handlers for the agent role library (multi-role chat personas).
 *
 * Channels:
 *   agent-roles:list           — all roles in the global library
 *   agent-roles:save           — create (no id) or update (with id) one role
 *   agent-roles:delete         — remove one role by id
 *   agent-roles:settings-get   — library behavior settings (agent@agent handoff switch)
 *   agent-roles:settings-save  — replace the library behavior settings
 */

import { ipcMain } from 'electron';
import type { AgentRoleLibrarySettings, AgentRoleSaveInput } from '../../shared/agent-roles';
import {
  deleteAgentRole,
  getAgentRoleSettings,
  listAgentRoles,
  saveAgentRole,
  saveAgentRoleSettings,
} from './roles-store';

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

  ipcMain.handle('agent-roles:settings-get', async () => {
    try {
      return { ok: true, settings: await getAgentRoleSettings() };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle('agent-roles:settings-save', async (_event, payload: { settings: AgentRoleLibrarySettings }) => {
    try {
      return { ok: true, settings: await saveAgentRoleSettings(payload?.settings) };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });
}
