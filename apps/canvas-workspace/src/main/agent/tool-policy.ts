import { BuiltinToolsMap } from 'pulse-coder-engine';

import type { AgentScope } from './types';
import { createCanvasTools, createGlobalCanvasTools } from './tools';
import type { CanvasTool } from './tools';

/**
 * Built-ins available outside workspace chat (global chat and scheduled
 * runs). Reads, web fetch, clarification — plus `bash`.
 *
 * `bash` is a deliberate exception to the otherwise read-only shape, added
 * because the useful global/scheduled work (pulling data through `lark-cli`,
 * `ntn`, and friends) is shell work: without it a task that runs fine in
 * workspace chat fails the moment it is scheduled. It is genuinely wider
 * than the rest of this list — arbitrary process execution at main-process
 * privilege, unattended in the scheduled case — see
 * `harness/knowledge/security-posture.md`.
 *
 * The filesystem WRITE tools (`write`, `edit`) and `generate_image` stay out.
 */
const GLOBAL_BUILTIN_TOOL_NAMES = [
  'read',
  'grep',
  'ls',
  'bash',
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

function createGlobalBuiltInTools(): EngineToolMap {
  const tools: EngineToolMap = {};
  for (const name of GLOBAL_BUILTIN_TOOL_NAMES) {
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
 * Workspace chat preserves the Engine defaults; global chat and scheduled
 * runs opt into a reviewed allowlist and expose canvas mutations only as
 * proposals.
 */
export function createCanvasAgentToolPolicy(scope: AgentScope): CanvasAgentToolPolicy {
  if (scope.kind === 'workspace') {
    return {
      canvasTools: createCanvasTools(scope.workspaceId),
    };
  }

  return {
    builtInTools: createGlobalBuiltInTools(),
    canvasTools: createGlobalCanvasTools(),
  };
}
