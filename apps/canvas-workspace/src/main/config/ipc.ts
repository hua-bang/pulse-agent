/**
 * IPC for per-workspace + global MCP/skills config.
 *
 * The workspace-config engine plugin watches the on-disk JSON files —
 * so writing via these handlers automatically triggers a reconcile
 * before the next agent turn. No push notification needed.
 *
 * Preview channel `workspace-config:fetch-skill-preview` exists so the
 * UI can show the user what they're about to register (title +
 * description, first N chars) before saving.
 */

import { ipcMain } from 'electron';
import {
  readMergedConfig,
  readScopeConfig,
  saveMCPConfig,
  saveSkillsConfig,
  validateMCPConfig,
  validateSkillsConfig,
  type WorkspaceMCPConfig,
  type WorkspaceSkillsConfig,
  type WorkspaceSkillEntry,
} from '../config/workspace-config-store';
import { materialiseSkill } from '../config/remote-skill-fetcher';

type Scope = { kind: 'global' } | { kind: 'workspace'; workspaceId: string };

function parseScope(raw: unknown): Scope | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as { kind?: unknown; workspaceId?: unknown };
  if (s.kind === 'global') return { kind: 'global' };
  if (s.kind === 'workspace' && typeof s.workspaceId === 'string' && s.workspaceId.trim()) {
    return { kind: 'workspace', workspaceId: s.workspaceId };
  }
  return null;
}

export function setupWorkspaceConfigIpc(): void {
  ipcMain.handle(
    'workspace-config:get',
    async (_event, payload: { workspaceId?: string }) => {
      try {
        if (!payload?.workspaceId || typeof payload.workspaceId !== 'string') {
          return { ok: false, error: 'workspaceId required' };
        }
        const merged = await readMergedConfig(payload.workspaceId);
        return { ok: true, merged };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle(
    'workspace-config:get-scope',
    async (_event, payload: { scope: unknown }) => {
      try {
        const scope = parseScope(payload?.scope);
        if (!scope) return { ok: false, error: 'invalid scope' };
        const scoped = await readScopeConfig(scope);
        return { ok: true, scope: scoped };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle(
    'workspace-config:save-mcp',
    async (_event, payload: { scope: unknown; config: unknown }) => {
      try {
        const scope = parseScope(payload?.scope);
        if (!scope) return { ok: false, error: 'invalid scope' };
        const validated = validateMCPConfig(payload?.config);
        await saveMCPConfig(scope, validated as WorkspaceMCPConfig);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle(
    'workspace-config:save-skills',
    async (_event, payload: { scope: unknown; config: unknown }) => {
      try {
        const scope = parseScope(payload?.scope);
        if (!scope) return { ok: false, error: 'invalid scope' };
        const validated = validateSkillsConfig(payload?.config);
        await saveSkillsConfig(scope, validated as WorkspaceSkillsConfig);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle(
    'workspace-config:fetch-skill-preview',
    async (_event, payload: { entry: WorkspaceSkillEntry }) => {
      try {
        if (!payload?.entry) return { ok: false, error: 'entry required' };
        const info = await materialiseSkill(payload.entry);
        return {
          ok: true,
          preview: {
            name: info.name,
            description: info.description,
            location: info.location,
            // Cap preview so a giant SKILL.md doesn't blow IPC.
            content: info.content.length > 2000 ? info.content.slice(0, 2000) + '\n…' : info.content,
          },
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );
}
