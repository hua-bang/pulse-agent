import { BuiltinToolsMap } from 'pulse-coder-engine';

import type { AgentScope } from './types';
import { createCanvasTools, createGlobalCanvasTools } from './tools';
import type { CanvasTool } from './tools';

const GLOBAL_READ_ONLY_BUILTIN_TOOL_NAMES = [
  'read',
  'grep',
  'ls',
  'tavily',
  'tavily_extract',
  'tavily_crawl',
  'tavily_map',
  'clarify',
] as const;

type EngineToolMap = Record<string, (typeof BuiltinToolsMap)[string]>;

export interface CanvasAgentToolPolicy {
  /** Undefined means the Engine's complete default built-in tool set. */
  builtInTools?: EngineToolMap;
  canvasTools: Record<string, CanvasTool>;
}

function createGlobalReadOnlyBuiltInTools(): EngineToolMap {
  const tools: EngineToolMap = {};
  for (const name of GLOBAL_READ_ONLY_BUILTIN_TOOL_NAMES) {
    const tool = BuiltinToolsMap[name];
    if (!tool) {
      throw new Error(`Missing required global Canvas Agent built-in tool: ${name}`);
    }
    tools[name] = tool;
  }
  return tools;
}

/**
 * Select the host-side tool boundary before constructing an Engine.
 * Workspace chat preserves the Engine defaults; global chat opts into a
 * reviewed read-only allowlist and exposes canvas mutations only as proposals.
 */
export function createCanvasAgentToolPolicy(scope: AgentScope): CanvasAgentToolPolicy {
  if (scope.kind === 'workspace') {
    return {
      canvasTools: createCanvasTools(scope.workspaceId),
    };
  }

  return {
    builtInTools: createGlobalReadOnlyBuiltInTools(),
    canvasTools: createGlobalCanvasTools(),
  };
}
