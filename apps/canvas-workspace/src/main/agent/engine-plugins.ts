import { join } from 'path';

import {
  createSkillsPlugin,
  createMcpPlugin,
  createToolOffloadPlugin,
  builtInToolSearchPlugin,
} from 'pulse-coder-engine/built-in';

import { scopeMcpConfigPath, scopeRootDir, skillSourceDirs } from './config-scope';
import { getCanvasPluginSkillScanPathsSync } from '../settings/canvas-plugins-config';
import { createCanvasMcpOAuthProvider } from './mcp/oauth';
import type { AgentScope } from './types';
import { canvasAgentObservabilityEnginePlugin } from './observability/engine-plugin';

/**
 * Engine plugin list for a Canvas Agent scope.
 *
 * CanvasAgent constructs its Engine with `disableBuiltInPlugins: true` because
 * skills / MCP / offload all need scope-derived paths, so the engine's default
 * plugin list is replaced rather than extended. That makes this array the only
 * place a built-in plugin can enter the Canvas Agent — anything omitted here is
 * silently absent, which is why the list is extracted and covered by tests.
 */
export function createCanvasEnginePlugins(scope: AgentScope): unknown[] {
  const workspaceId = scope.kind === 'workspace' ? scope.workspaceId : undefined;
  const globalScope = { level: 'global' as const };
  const wsScope = workspaceId ? { level: 'workspace' as const, workspaceId } : undefined;

  // Skills: workspace dirs scanned first, then every standard global skill
  // dir (canvas-managed, plus whatever the user has under ~/.pulse-coder,
  // ~/.claude, ~/.codex, etc.). Earlier sources win on same-name — so the
  // workspace's own skills override globals, and canvas-managed globals
  // override skills from other tools.
  const skillsScanPaths = [
    ...(wsScope ? skillSourceDirs(wsScope).map((d) => ({ base: d.base, pattern: '**/SKILL.md' })) : []),
    ...skillSourceDirs(globalScope).map((d) => ({ base: d.base, pattern: '**/SKILL.md' })),
    ...getCanvasPluginSkillScanPathsSync().map((base) => ({ base, pattern: '**/SKILL.md' })),
  ];
  // MCP: global first, workspace later so it overrides on same server name.
  const mcpConfigPaths = [
    scopeMcpConfigPath(globalScope),
    ...(wsScope ? [scopeMcpConfigPath(wsScope)] : []),
  ];
  // Offload oversized tool results (chiefly uncapped MCP output) to disk so
  // they don't bloat the context window; the agent reads them on demand via
  // the read/grep tools. Store under the workspace scope's user dir (never
  // cwd — the Electron cwd is unpredictable and must not receive runtime data).
  const offloadDir = join(scopeRootDir(wsScope ?? globalScope), 'offload');

  return [
    createSkillsPlugin({ scanPaths: skillsScanPaths }),
    // Enforces `defer_loading` on the canvas tool set and on MCP servers
    // configured with `deferTools`. Without it the flag is inert and every tool
    // reaches the model on every turn.
    builtInToolSearchPlugin,
    createMcpPlugin({
      configPaths: mcpConfigPaths,
      authProviderFactory: ({ serverName, config }) => {
        if (config.auth !== 'oauth') return undefined;
        return createCanvasMcpOAuthProvider(serverName, config.oauth);
      },
    }),
    createToolOffloadPlugin({ dir: offloadDir }),
    canvasAgentObservabilityEnginePlugin,
  ];
}
