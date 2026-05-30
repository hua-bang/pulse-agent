import { getRegisteredCanvasToolFactories } from '../../../plugins/main';
import type { CanvasTool } from './types';
import { createNodeTools } from './nodes';
import { createSearchTools } from './search';
import { createGroupTools } from './groups';
import { createWorkspaceNodeTools } from './workspace-nodes';
import { createAgentTools } from './agents';
import { createTerminalTools } from './terminals';
import { createShapeTools } from './shapes';
import { createEdgeTools } from './edges-tools';
import { createImageTools } from './images';
import { createVisualTools } from './visual';
import { createArtifactTools } from './artifacts';
import { createWebpageTools } from './webpage';
import { createSkillTools } from './skills';

export type { CanvasTool, CanvasToolExecutionContext } from './types';

// ─── Tool definitions ──────────────────────────────────────────────

export function createCanvasTools(workspaceId: string): Record<string, CanvasTool> {
  const base: Record<string, CanvasTool> = {
    ...createNodeTools(workspaceId),
    ...createSearchTools(workspaceId),
    ...createGroupTools(workspaceId),
    ...createWorkspaceNodeTools(workspaceId),
    ...createAgentTools(workspaceId),
    ...createTerminalTools(workspaceId),
    ...createShapeTools(workspaceId),
    ...createEdgeTools(workspaceId),
    ...createImageTools(workspaceId),
    ...createVisualTools(workspaceId),
    ...createArtifactTools(workspaceId),
    ...createWebpageTools(workspaceId),
    ...createSkillTools(workspaceId),
  };

  // Plugin-contributed tools (see `plugins/main/registry.ts`). A plugin's
  // factory is in the registry iff its `enabledWhen` returned true at
  // bootstrap, so flag-gating is already enforced — we just merge what
  // each factory produces for this workspace. Last writer wins on name
  // collisions; that matters if a future plugin shadows a built-in tool
  // intentionally (none do today).
  for (const [pluginId, factory] of getRegisteredCanvasToolFactories()) {
    try {
      const contributed = factory(workspaceId) as Record<string, CanvasTool>;
      Object.assign(base, contributed);
    } catch (err) {
      console.error(
        `[canvas-tools] plugin ${pluginId} tool factory threw; skipping its tools`,
        err,
      );
    }
  }

  return base;
}
