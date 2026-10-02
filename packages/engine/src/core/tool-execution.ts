import { asSchema } from 'ai';
import { validator, type Json, type Validate } from '@exodus/schemasafe';
import type { EngineHookMap } from '../plugin/EnginePlugin.js';
import type { Context, NestedToolExecutor, Tool, ToolExecutionContext } from '../shared/types.js';

interface ExecutionOptions {
  context: Context;
  toolContext?: ToolExecutionContext;
  beforeHooks: Array<EngineHookMap['beforeToolCall']>;
  afterHooks: Array<EngineHookMap['afterToolCall']>;
  validate?: boolean;
  onIntercepted?: () => void;
  createNestedTools?: (context?: ToolExecutionContext) => NestedToolExecutor;
}

const validators = new WeakMap<object, Validate>();

function validateJsonInput(schema: object, input: unknown, name: string): void {
  if ('$async' in schema && schema.$async === true) {
    throw new Error(`Async JSON Schema is not supported for tool ${name}`);
  }
  let validate = validators.get(schema);
  if (!validate) {
    validate = validator(schema, {
      includeErrors: true,
      formatAssertion: false,
      mode: 'lax',
      allowUnusedKeywords: true,
      contentValidation: false,
      $schemaDefault: 'http://json-schema.org/draft-07/schema#',
    });
    validators.set(schema, validate);
  }
  // The library's experimental types assume JSON input; validation itself
  // accepts unknown values and rejects those incompatible with the schema.
  if (!validate(input as Json)) throw new Error(`Invalid input for tool ${name}: ${JSON.stringify(validate.errors)}`);
}

/** Shared execution only: no model requests, history writes or run hooks. */
export async function executeToolWithHooks(
  tool: Tool,
  name: string,
  input: unknown,
  options: ExecutionOptions,
): Promise<unknown> {
  let finalInput = input;
  if (options.validate !== false) {
    const schema = asSchema(tool.inputSchema);
    if (schema.validate) {
      const result = await schema.validate(input);
      if (!result.success) throw new Error(`Invalid input for tool ${name}: ${result.error.message}`);
      finalInput = result.value;
    } else {
      validateJsonInput(schema.jsonSchema, input, name);
    }
  }
  let finalContext = options.toolContext;
  let blocked = false;
  let output: unknown;
  for (const hook of options.beforeHooks) {
    const result = await hook({ context: options.context, name, input: finalInput, toolContext: finalContext });
    if (result && 'input' in result) finalInput = result.input;
    if (result && 'toolContext' in result) finalContext = result.toolContext;
    if (result && 'output' in result) {
      blocked = true;
      options.onIntercepted?.();
      output = result.output;
      break;
    }
  }
  if (options.toolContext?.resultTarget === 'script') {
    finalContext = {
      ...finalContext,
      resultTarget: 'script',
      parentToolCallId: options.toolContext.parentToolCallId,
      toolCallId: options.toolContext.toolCallId,
      abortSignal: options.toolContext.abortSignal,
    };
  }
  if (finalContext?.abortSignal?.aborted) throw new Error('Tool execution aborted');
  if (options.createNestedTools) {
    finalContext = { ...finalContext, nestedTools: options.createNestedTools(finalContext) };
  }
  if (!blocked) output = await tool.execute(finalInput, finalContext);
  for (const hook of options.afterHooks) {
    const result = await hook({ context: options.context, name, input: finalInput, output, toolContext: finalContext });
    if (result && 'output' in result) output = result.output;
  }
  return output;
}

/** Same union/wildcard matching as PTC, enforced even without its plugin. */
function allowsCaller(tool: Tool, context?: ToolExecutionContext): boolean {
  const extra = (tool as Tool & { ptc?: { allowed_callers?: string[] } }).ptc?.allowed_callers;
  const declarations = [tool.allowed_callers, extra];
  if (declarations.some(value => value !== undefined && !Array.isArray(value))) return false;
  const normalize = (values: unknown[]) => values
    .filter((value): value is string => typeof value === 'string')
    .map(value => value.trim().toLowerCase()).filter(Boolean);
  const allowed = normalize(declarations.flatMap(value => value ?? []));
  if (!allowed.length || allowed.includes('*')) return true;
  const run = context?.runContext;
  const selectors = normalize([
    ...(Array.isArray(run?.callerSelectors) ? run.callerSelectors : [run?.callerSelectors]),
    run?.caller,
  ]);
  return allowed.some(value => selectors.includes(value));
}

export function createNestedToolExecutor(options: {
  getTools(): Record<string, Tool>;
  context: Context;
  beforeHooks: Array<EngineHookMap['beforeToolCall']>;
  afterHooks: Array<EngineHookMap['afterToolCall']>;
  toolContext?: ToolExecutionContext;
}): NestedToolExecutor {
  const getTools = () => Object.fromEntries(Object.entries(options.getTools())
    .filter(([, tool]) => allowsCaller(tool, options.toolContext)));
  return {
    getTools,
    async executeTool(name, input, childContext, onIntercepted) {
      const tools = getTools();
      const tool = Object.hasOwn(tools, name) ? tools[name] : undefined;
      if (!tool || tool.codemode === false) throw new Error(`Unknown or unavailable tool: ${name}`);
      const signals = [...new Set([options.toolContext?.abortSignal, childContext?.abortSignal]
        .filter((signal): signal is AbortSignal => signal !== undefined))];
      const controller = new AbortController();
      const abort = () => controller.abort();
      for (const signal of signals) {
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
      }
      // Child calls inherit authority. Only signal and correlation are replaceable.
      const toolContext: ToolExecutionContext = {
        ...options.toolContext,
        abortSignal: controller.signal,
        toolCallId: childContext?.toolCallId,
        parentToolCallId: options.toolContext?.toolCallId,
        resultTarget: 'script',
        nestedTools: undefined,
      };
      try {
        return await executeToolWithHooks(tool, name, input, { ...options, toolContext, onIntercepted });
      } finally {
        for (const signal of signals) signal.removeEventListener('abort', abort);
      }
    },
  };
}

/** Presentation cannot restore policy-denied tools or replace their execution wrappers. */
export async function prepareToolPresentation(
  input: Parameters<EngineHookMap['beforeLLMCall']>[0],
  hooks: Array<EngineHookMap['prepareToolPresentation']> = [],
) {
  let tools = input.tools;
  let systemPrompt = input.systemPrompt;
  for (const hook of hooks) {
    const previous = tools;
    const presentedTools = Object.fromEntries(Object.entries(previous)
      .map(([name, tool]) => [name, { ...tool }]));
    const result = await hook({ ...input, tools: presentedTools, systemPrompt });
    if (result?.systemPrompt !== undefined) systemPrompt = result.systemPrompt;
    if (result?.tools !== undefined) {
      tools = Object.fromEntries(Object.entries(result.tools)
        .filter(([name]) => Object.hasOwn(previous, name))
        .map(([name, presented]) => [name, { ...previous[name], description: presented.description }]));
    }
  }
  return { tools, systemPrompt };
}
