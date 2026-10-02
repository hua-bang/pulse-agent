import { randomUUID } from 'node:crypto';
import { asSchema } from 'ai';
import { z } from 'zod';
import type { EnginePlugin } from '../../plugin/EnginePlugin.js';
import type { Tool } from '../../shared/types.js';
import { runCodemode, type CodemodeRuntimeOptions } from './runtime.js';

export type { CodemodeCall, CodemodeResult, CodemodeRuntimeOptions } from './runtime.js';

export interface CodemodePluginOptions extends CodemodeRuntimeOptions {
  /** Explicit host-reviewed tools. No tools are implicitly authorized. */
  allowedTools: readonly string[];
}

/** Opt-in plugin: never installed by the default built-in list. */
export function createCodemodePlugin(options: CodemodePluginOptions): EnginePlugin {
  const allowed = new Set(options.allowedTools.filter(name => name !== 'codemode'));
  return {
    name: 'pulse-coder-engine/codemode',
    version: '0.1.0',
    async initialize(context) {
      const tool: Tool<{ code: string }> = {
        name: 'codemode',
        description: 'Run JavaScript with await tools[name](args). Calls execute serially. Discover allowed tools with ALL_TOOLS and describeTools(names). Output only needed results with text(value) or return. No filesystem or network globals; no automatic retries.',
        inputSchema: z.object({ code: z.string() }).strict(),
        async execute({ code }, executionContext) {
          const executor = executionContext?.nestedTools;
          if (!executor) throw new Error('Codemode requires an active Engine tool execution context');
          const tools = executor.getTools();
          const catalog = Object.entries(tools)
            .filter(([name]) => allowed.has(name))
            .map(([name, item]) => ({
              name,
              description: item.description,
              inputSchema: asSchema(item.inputSchema).jsonSchema,
              outputSchema: item.outputSchema ? asSchema(item.outputSchema).jsonSchema : undefined,
            }));
          const parentToolCallId = executionContext.toolCallId ?? `codemode:${randomUUID()}`;
          return runCodemode({
            ...options,
            code,
            catalog,
            parentToolCallId,
            signal: executionContext.abortSignal,
            executeTool: (name, input, signal, toolCallId, onIntercepted) => executor.executeTool(name, input, {
              abortSignal: signal, toolCallId,
            }, onIntercepted),
            onCall: call => context.events.emit('codemodeTool', call),
          });
        },
      };
      context.registerTool(tool.name, tool);
    },
  };
}
