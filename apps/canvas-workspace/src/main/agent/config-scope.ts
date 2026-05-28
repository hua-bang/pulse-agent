/**
 * Scope model for user-configurable Skills and MCP servers.
 *
 * Two granularities, mirroring the engine's existing global-vs-project split:
 *   - global    → shared across every workspace
 *   - workspace → bound to a single canvas workspace
 *
 * On disk (rooted at ~/.pulse-coder/canvas):
 *   global skills      <root>/skills/<slug>/SKILL.md
 *   workspace skills   <root>/<workspaceId>/skills/<slug>/SKILL.md
 *   global mcp         <root>/mcp.json
 *   workspace mcp      <root>/<workspaceId>/mcp.json
 *
 * Precedence is workspace-over-global (a workspace entry with the same
 * name/server wins), matching the engine's "project overrides user" rule.
 */

import { homedir } from 'os';
import { join } from 'path';

export const CANVAS_STORE_DIR = join(homedir(), '.pulse-coder', 'canvas');

export type CanvasConfigScopeLevel = 'global' | 'workspace';

export type CanvasConfigScope =
  | { level: 'global' }
  | { level: 'workspace'; workspaceId: string };

/** Root directory for a given scope. */
export function scopeRootDir(scope: CanvasConfigScope): string {
  return scope.level === 'workspace'
    ? join(CANVAS_STORE_DIR, scope.workspaceId)
    : CANVAS_STORE_DIR;
}

/** Skills directory for a given scope (`<root>/skills`). */
export function scopeSkillsDir(scope: CanvasConfigScope): string {
  return join(scopeRootDir(scope), 'skills');
}

/** MCP config file path for a given scope (`<root>/mcp.json`). */
export function scopeMcpConfigPath(scope: CanvasConfigScope): string {
  return join(scopeRootDir(scope), 'mcp.json');
}

/**
 * Parse an IPC scope payload into a typed scope. Throws on a malformed
 * workspace scope so handlers fail loudly rather than silently writing to
 * the global root.
 */
export function parseScopePayload(payload: unknown): CanvasConfigScope {
  if (!payload || typeof payload !== 'object') {
    return { level: 'global' };
  }
  const level = (payload as { level?: unknown }).level;
  if (level === 'workspace') {
    const workspaceId = (payload as { workspaceId?: unknown }).workspaceId;
    if (typeof workspaceId !== 'string' || !workspaceId.trim()) {
      throw new Error('workspace scope requires a non-empty workspaceId');
    }
    return { level: 'workspace', workspaceId: workspaceId.trim() };
  }
  return { level: 'global' };
}
