import { randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';
import { asSchema } from 'ai';
import type { Engine, EngineToolSession } from 'pulse-coder-engine';

import { piBridgeDir } from './pi-model-bridge';
import type { TurnSegmentRequest } from './types';

export interface PiToolManifestEntry {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
}

interface ActivePiToolBridge {
  session: EngineToolSession;
  secret: string;
  executionMode: TurnSegmentRequest['executionMode'];
  abortSignal: AbortSignal;
  onClarificationRequest?: TurnSegmentRequest['onClarificationRequest'];
}

export interface PiToolBridgeHandle {
  id: string;
  manifestPath: string;
  env: Record<string, string>;
  dispose: () => Promise<void>;
}

export interface PiToolBridgeCall {
  bridgeId: string;
  bridgeSecret: string;
  toolCallId: string;
  name: string;
  input: unknown;
}

export interface PiToolBridgeResult {
  value: unknown;
  tools: PiToolManifestEntry[];
  activeToolNames: string[];
}

const activeBridges = new Map<string, ActivePiToolBridge>();

async function describeTools(tools: Record<string, any>): Promise<PiToolManifestEntry[]> {
  const entries = await Promise.all(
    Object.entries(tools)
      .filter(([, tool]) => typeof tool?.execute === 'function')
      .sort(([left], [right]) => left.localeCompare(right))
      .map(async ([name, tool]) => ({
        name,
        label: typeof tool.label === 'string' && tool.label.trim() ? tool.label : name,
        description: typeof tool.description === 'string' ? tool.description : '',
        parameters: await asSchema(tool.inputSchema).jsonSchema,
      })),
  );
  return entries;
}

export async function preparePiToolBridge(options: {
  engine: Engine;
  context: TurnSegmentRequest['context'];
  workspaceId: string;
  executionMode: TurnSegmentRequest['executionMode'];
  abortSignal: AbortSignal;
  onClarificationRequest?: TurnSegmentRequest['onClarificationRequest'];
  model?: string;
  systemPrompt?: TurnSegmentRequest['systemPrompt'];
}): Promise<PiToolBridgeHandle> {
  const id = randomUUID();
  const secret = randomBytes(32).toString('hex');
  const runContext = { executionMode: options.executionMode };
  const session = await options.engine.createToolSession(options.context, {
    runContext,
    model: options.model,
    systemPrompt: options.systemPrompt,
  });
  const manifestDir = join(piBridgeDir(), 'tool-bridges');
  const manifestPath = join(manifestDir, `${id}.json`);
  let tools: PiToolManifestEntry[];
  try {
    tools = await describeTools(session.getTools());
    await fs.mkdir(manifestDir, { recursive: true, mode: 0o700 });
    await fs.writeFile(manifestPath, JSON.stringify({ version: 1, tools }), { mode: 0o600 });
  } catch (error) {
    await session.dispose().catch(() => {});
    throw error;
  }

  activeBridges.set(id, {
    session,
    secret,
    executionMode: options.executionMode,
    abortSignal: options.abortSignal,
    onClarificationRequest: options.onClarificationRequest,
  });

  let disposed = false;
  return {
    id,
    manifestPath,
    env: {
      PULSE_CANVAS_PI_TOOL_BRIDGE_ID: id,
      PULSE_CANVAS_PI_TOOL_BRIDGE_SECRET: secret,
      PULSE_CANVAS_PI_TOOL_MANIFEST: manifestPath,
      ...(options.workspaceId ? { PULSE_CANVAS_WORKSPACE_ID: options.workspaceId } : {}),
    },
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      activeBridges.delete(id);
      try {
        await session.dispose();
      } finally {
        await fs.unlink(manifestPath).catch(() => {});
      }
    },
  };
}

export async function executePiToolBridgeCall(call: PiToolBridgeCall): Promise<PiToolBridgeResult> {
  const bridge = activeBridges.get(call.bridgeId);
  if (!bridge) throw new Error('Pi tool bridge expired or was not found');
  const suppliedSecret = Buffer.from(call.bridgeSecret);
  const expectedSecret = Buffer.from(bridge.secret);
  if (suppliedSecret.length !== expectedSecret.length
    || !timingSafeEqual(suppliedSecret, expectedSecret)) {
    throw new Error('Pi tool bridge credential is invalid');
  }
  if (!Object.prototype.hasOwnProperty.call(bridge.session.getTools(), call.name)) {
    throw new Error(`Tool is not available in this Pi bridge: ${call.name}`);
  }
  if (bridge.abortSignal.aborted) throw new Error('Pi tool bridge run was aborted');

  const value = await bridge.session.executeTool(call.name, call.input, {
    abortSignal: bridge.abortSignal,
    onClarificationRequest: bridge.onClarificationRequest,
    runContext: { executionMode: bridge.executionMode },
    toolCallId: call.toolCallId,
  });
  const tools = await describeTools(bridge.session.getTools());
  return { value, tools, activeToolNames: tools.map(tool => tool.name) };
}
