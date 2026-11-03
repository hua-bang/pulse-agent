/**
 * Tools that main-side Canvas plugins register with `ctx.registerCanvasTool`.
 *
 * Built-in plugins activate once at startup, so their tools join the static
 * tool map when an agent engine is built. Market plugins come and go while
 * the app runs (install, enable, hot reload, uninstall), so their tools are
 * read again before every model call through an engine `beforeLLMCall` hook.
 * A plugin the user enables mid-turn is callable at the next model step.
 */

import { jsonSchema, type JSONSchema7 } from 'ai';
import { z } from 'zod';
import { getRegisteredCanvasToolFactories, isExternalMainPlugin } from '../../../../plugins/main';
import type { AgentScope } from '../../types';
import type { CanvasTool } from '../types';

type PluginSource = 'built-in' | 'external';

/**
 * A plugin tool may declare `inputSchema` as plain JSON Schema, because a
 * no-build plugin cannot import zod. The engine reads either form through
 * the AI SDK `asSchema`, so wrap plain objects with `jsonSchema`. The cast
 * only bridges `CanvasTool`'s zod-typed field; code that needs zod methods
 * checks `instanceof z.ZodType` first.
 */
function normalizePluginTool(name: string, tool: CanvasTool): CanvasTool {
  const schema: unknown = tool.inputSchema ?? { type: 'object', properties: {} };
  if (schema instanceof z.ZodType) return { ...tool, name: tool.name || name };
  return {
    ...tool,
    name: tool.name || name,
    inputSchema: jsonSchema(schema as JSONSchema7) as unknown as z.ZodType,
  };
}

/** The current tools of active plugins from one source. Last writer wins on name collisions. */
export function createPluginContributedTools(
  workspaceId: string,
  source: PluginSource,
): Record<string, CanvasTool> {
  const tools: Record<string, CanvasTool> = {};
  for (const [pluginId, factory] of getRegisteredCanvasToolFactories()) {
    if (isExternalMainPlugin(pluginId) !== (source === 'external')) continue;
    try {
      const contributed = factory(workspaceId) as Record<string, CanvasTool>;
      for (const [name, tool] of Object.entries(contributed)) {
        tools[name] = normalizePluginTool(name, tool);
      }
    } catch (err) {
      console.error(
        `[canvas-tools] plugin ${pluginId} tool factory threw; skipping its tools`,
        err,
      );
    }
  }
  return tools;
}

/**
 * Adds market plugin tools before every model call. Global chat calls the
 * factories with an empty workspaceId; scheduled runs keep their fixed tool
 * boundary and get none. Built-in tools win on a name clash.
 */
export function createLivePluginToolsEnginePlugin(scope: AgentScope) {
  return {
    name: 'canvas-live-plugin-tools',
    version: '1.0.0',
    initialize(context: {
      registerHook: (
        name: 'beforeLLMCall',
        handler: (input: { tools: Record<string, unknown> }) => { tools: Record<string, unknown> } | undefined,
      ) => void;
    }) {
      if (scope.kind === 'scheduled') return;
      const workspaceId = scope.kind === 'workspace' ? scope.workspaceId : '';
      context.registerHook('beforeLLMCall', ({ tools }) => {
        const live = createPluginContributedTools(workspaceId, 'external');
        if (Object.keys(live).length === 0) return undefined;
        return { tools: { ...live, ...tools } };
      });
    },
  };
}
