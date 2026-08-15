import { BuiltinToolsMap } from 'pulse-coder-engine';

import type { AgentScope } from './types';
import { createCanvasTools, createGlobalCanvasTools } from './tools';
import type { CanvasTool, CanvasToolExecutionContext } from './tools';

/**
 * Built-ins available in interactive global chat. Global chat has no ambient
 * Canvas workspace; browser tab/page tools may use the visible Dock route,
 * while file paths and image generation are independently targetable
 * capabilities and Canvas mutations use explicit workspaceId-bearing tools.
 *
 * Scheduled runs deliberately use the narrower list below. In particular,
 * they do not inherit filesystem writes, image generation, or targeted Canvas
 * mutations merely because they share the global scope shape.
 *
 * `bash` remains available in both lists because the useful global/scheduled
 * work (pulling data through `lark-cli`, `ntn`, and friends) is shell work.
 * It is a main-process privilege and is still subject to the existing Ask
 * mode policy; scheduled runs remain unattended by design.
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
  'write',
  'edit',
  'generate_image',
] as const;

const SCHEDULED_BUILTIN_TOOL_NAMES = [
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
  builtInTools: EngineToolMap;
  canvasTools: Record<string, CanvasTool>;
}

export type CanvasToolOperationKind = 'read' | 'write' | 'execute' | 'destructive';

const READ_ONLY_TOOL_NAMES = new Set([
  'read',
  'grep',
  'ls',
  'tavily',
  'tavily_extract',
  'tavily_crawl',
  'tavily_map',
  'clarify',
  'user_ask',
  'visual_render',
  'screen_capture',
]);

const READ_ONLY_NAME_PARTS = [
  '_read',
  '_list',
  '_search',
  '_get',
  '_summary',
  '_analyze',
  '_inspect',
  '_screenshot',
];

const DESTRUCTIVE_NAME_PARTS = ['delete', 'remove', 'clear', 'overwrite', 'truncate'];
const EXECUTE_NAME_PARTS = ['bash', 'execute', 'run_command', 'send_to_agent', 'create_terminal'];
const WRITE_NAME_PARTS = [
  'create',
  'add',
  'update',
  'write',
  'edit',
  'patch',
  'set',
  'save',
  'send',
  'upload',
  'move',
  'copy',
  'rename',
  'apply',
];

export function classifyCanvasToolOperation(name: string): CanvasToolOperationKind {
  const normalized = name.toLowerCase();
  // Mutating words win over reader-like words: `get_or_create` and
  // `search_and_delete` must never be classified as reads.
  if (DESTRUCTIVE_NAME_PARTS.some(part => normalized.includes(part))) return 'destructive';
  if (EXECUTE_NAME_PARTS.some(part => normalized.includes(part))) return 'execute';
  if (WRITE_NAME_PARTS.some(part => normalized.includes(part))) return 'write';
  if (
    READ_ONLY_TOOL_NAMES.has(normalized)
    || READ_ONLY_NAME_PARTS.some(part => normalized.includes(part))
  ) {
    return 'read';
  }
  return 'write';
}

const APPROVAL_RE =
  /^(?:y|yes|ok|okay|approve|approved|allow|allowed|confirm|confirmed|continue|go|run|可以|好|好的|批准|允许|确认|同意|继续|执行|运行)[.!。！\s]*$/i;

function previewToolInput(input: unknown): string {
  try {
    const serialized = JSON.stringify(input, null, 2);
    return serialized.length > 1_200 ? `${serialized.slice(0, 1_197)}...` : serialized;
  } catch {
    return String(input).slice(0, 1_200);
  }
}

export interface AskModeApprovalDecision {
  approved: boolean;
  toolContext?: CanvasToolExecutionContext;
  error?: string;
}

export async function requestAskModeApproval(options: {
  name: string;
  input: unknown;
  operation?: CanvasToolOperationKind;
  context?: CanvasToolExecutionContext;
}): Promise<AskModeApprovalDecision> {
  const { name, input, context } = options;
  if (context?.runContext?.executionMode !== 'ask') return { approved: true, toolContext: context };

  const operation = options.operation ?? classifyCanvasToolOperation(name);
  if (operation === 'read') return { approved: true, toolContext: context };

  const requestApproval = context.onClarificationRequest;
  if (!requestApproval) {
    return {
      approved: false,
      error: `Approval unavailable; ${name} was not executed.`,
    };
  }

  const toolCallId = context.toolCallId || `${name}-${Date.now()}`;
  const answer = await requestApproval({
    id: `tool-approval:${toolCallId}`,
    kind: 'approval',
    question: `Allow ${operation} operation “${name}”?`,
    context: `Proposed input:\n${previewToolInput(input)}`,
    defaultAnswer: 'No',
    timeout: 300_000,
  });
  if (!APPROVAL_RE.test(answer.trim())) {
    return {
      approved: false,
      error: `${name} was not approved and did not run.`,
    };
  }

  return {
    approved: true,
    toolContext: {
      ...context,
      runContext: {
        ...context.runContext,
        approvalGrantedFor: toolCallId,
      },
    },
  };
}

type BeforeToolCallInput = {
  name: string;
  input: unknown;
  toolContext?: CanvasToolExecutionContext;
};

type BeforeToolCallResult = {
  toolContext?: CanvasToolExecutionContext;
  output?: unknown;
};

/** Final host boundary: applies after plugin/deferred tools join the run tool table. */
export async function enforceCanvasAskModeToolPolicy(
  input: BeforeToolCallInput,
): Promise<BeforeToolCallResult | undefined> {
  const decision = await requestAskModeApproval({
    name: input.name,
    input: input.input,
    context: input.toolContext,
  });
  if (!decision.approved) {
    return {
      output: {
        ok: false,
        cancelled: true,
        error: decision.error,
      },
    };
  }
  return decision.toolContext === input.toolContext
    ? undefined
    : { toolContext: decision.toolContext };
}

/**
 * Installed after the Canvas Agent's skills/MCP/tool-search plugins. The
 * engine invokes this hook against its final per-run tool table, so tools
 * registered by plugins cannot bypass Ask mode.
 */
export function createCanvasAskModeToolPolicyPlugin() {
  return {
    name: 'pulse-canvas/ask-mode-tool-policy',
    version: '1.0.0',
    initialize(context: {
      registerHook: (
        name: 'beforeToolCall',
        handler: (input: BeforeToolCallInput) => Promise<BeforeToolCallResult | undefined>,
      ) => void;
    }) {
      context.registerHook('beforeToolCall', enforceCanvasAskModeToolPolicy);
    },
  };
}

function createBuiltInTools(names: readonly string[]): EngineToolMap {
  const tools: EngineToolMap = {};
  for (const name of names) {
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
 * Workspace chat preserves the Engine defaults. Interactive Global chat gets
 * independently useful built-ins plus explicit-target Canvas operations;
 * scheduled runs keep the narrower unattended boundary.
 */
export function createCanvasAgentToolPolicy(scope: AgentScope): CanvasAgentToolPolicy {
  if (scope.kind === 'workspace') {
    return {
      builtInTools: { ...BuiltinToolsMap },
      canvasTools: createCanvasTools(scope.workspaceId),
    };
  }

  if (scope.kind === 'global') {
    return {
      builtInTools: createBuiltInTools(GLOBAL_BUILTIN_TOOL_NAMES),
      canvasTools: createGlobalCanvasTools({ allowWorkspaceTargetedTools: true }),
    };
  }

  return {
    builtInTools: createBuiltInTools(SCHEDULED_BUILTIN_TOOL_NAMES),
    canvasTools: createGlobalCanvasTools(),
  };
}
