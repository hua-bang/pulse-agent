import type { AgentHarnessTool } from '@earendil-works/pi-agent-core';
import type { TSchema } from '@earendil-works/pi-ai';
import { asSchema, type FlexibleSchema } from 'ai';

import type { CanvasToolExecutionContext } from '../tools';

interface PiSourceTool {
  name: string;
  description: string;
  inputSchema: FlexibleSchema;
  defer_loading?: boolean;
  execute(input: unknown, context?: CanvasToolExecutionContext): Promise<unknown>;
}

export interface AdaptEngineToolsForPiOptions {
  tools: Record<string, PiSourceTool>;
  /** Execute through EngineToolSession so hooks and policy remain authoritative. */
  executeTool(
    name: string,
    input: unknown,
    context: CanvasToolExecutionContext,
  ): Promise<unknown>;
  executionContext: CanvasToolExecutionContext;
  /** Policy-filtered initial visibility. Defaults to non-deferred tools. */
  activeToolNames?: string[];
  activateTools?: (toolNames: string[]) => Promise<void>;
}

export interface AdaptedPiTools {
  tools: Array<AgentHarnessTool<undefined>>;
  activeToolNames: string[];
}

const formatToolOutput = (output: unknown): string => {
  if (typeof output === 'string') return output;
  if (output === undefined) return '';
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
};

const formatToolContent = (output: unknown) => {
  const record = output && typeof output === 'object' ? output as any : undefined;
  const candidates = record?.type === 'content' && Array.isArray(record.value)
    ? record.value
    : Array.isArray(record?.content)
      ? record.content
      : undefined;
  if (!candidates) return [{ type: 'text' as const, text: formatToolOutput(output) }];
  const content = candidates.flatMap((part: any) => {
    if (part?.type === 'text') {
      return [{ type: 'text' as const, text: String(part.text ?? '') }];
    }
    if (
      (part?.type === 'image' || part?.type === 'image-data' || part?.type === 'media')
      && typeof part.data === 'string'
    ) {
      return [{
        type: 'image' as const,
        data: part.data,
        mimeType: String(part.mimeType ?? part.mediaType ?? 'image/png'),
      }];
    }
    return [];
  });
  return content.length > 0
    ? content
    : [{ type: 'text' as const, text: formatToolOutput(output) }];
};

const referencedToolNames = (
  output: unknown,
  availableNames: ReadonlySet<string>,
): string[] | undefined => {
  if (!output || typeof output !== 'object') return undefined;
  const references = (output as any).tool_references;
  if (!Array.isArray(references)) return undefined;
  const names = references
    .map(reference => typeof reference?.tool_name === 'string' ? reference.tool_name : '')
    .filter((name, index, all) => availableNames.has(name) && all.indexOf(name) === index);
  return names.length > 0 ? names : undefined;
};

/**
 * Adapt the Engine/Canvas tool registry to AgentHarness without creating a
 * second capability registry. Deferred tools remain registered but inactive;
 * the runtime can activate them after tool-search returns references.
 */
export function adaptEngineToolsForPi(
  options: AdaptEngineToolsForPiOptions,
): AdaptedPiTools {
  const entries = Object.entries(options.tools);
  const availableNames = new Set(entries.map(([name]) => name));
  return {
    activeToolNames: options.activeToolNames ?? entries
      .filter(([, tool]) => !tool.defer_loading)
      .map(([name]) => name),
    tools: entries.map(([name, tool]) => ({
      name,
      label: name,
      description: tool.description,
      parameters: asSchema(tool.inputSchema).jsonSchema as TSchema,
      // EngineToolSession is a stateful policy transcript: each execution
      // closes one LLM step, records a result, and refreshes the next table.
      executionMode: 'sequential',
      execute: async (toolCallId, params, signal) => {
        const output = await options.executeTool(name, params, {
          ...options.executionContext,
          abortSignal: signal ?? options.executionContext.abortSignal,
          toolCallId,
        });
        const addedToolNames = referencedToolNames(output, availableNames);
        if (addedToolNames) await options.activateTools?.(addedToolNames);
        return {
          content: formatToolContent(output),
          details: output,
          addedToolNames,
        };
      },
    })),
  };
}
