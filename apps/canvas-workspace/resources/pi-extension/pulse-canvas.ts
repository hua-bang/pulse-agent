/**
 * Pulse Canvas bridge extension for pi (pi.dev / @earendil-works/pi-coding-agent).
 *
 * Registers Canvas tools inside pi's own tool loop. Tool calls go back into
 * the running Pulse Canvas app through its loopback runtime-control server:
 * endpoint + bearer secret are discovered per call from
 * `~/.pulse-coder/canvas-runtime/canvas-workspace.json` (0600, self-healed by
 * the app while it runs), the same channel the pulse-canvas CLI uses. Reach
 * is the read/operate capability tier — never the unsafe tier.
 *
 * Loaded automatically by the app's pi-backed chat (`-e` per run, with
 * PULSE_CANVAS_WORKSPACE_ID injected), and usable manually:
 *   pi -e /path/to/pulse-canvas.ts    (set PULSE_CANVAS_WORKSPACE_ID yourself)
 *
 * Self-contained on purpose: `typebox` resolves from pi's own runtime.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Type } from 'typebox';

export interface RuntimeInfo {
  baseUrl: string;
  secret: string;
}

export interface CapabilityCallOptions {
  name: string;
  workspaceId: string;
  input: Record<string, unknown>;
  runtimeFile?: string;
  fetchImpl?: typeof fetch;
}

const defaultRuntimeFile = (): string =>
  process.env.PULSE_CANVAS_RUNTIME_FILE
  || join(homedir(), '.pulse-coder', 'canvas-runtime', 'canvas-workspace.json');

export function readRuntimeInfo(runtimeFile = defaultRuntimeFile()): RuntimeInfo {
  let raw: string;
  try {
    raw = readFileSync(runtimeFile, 'utf-8');
  } catch {
    throw new Error(
      `Pulse Canvas app is not running (runtime file not found: ${runtimeFile}). `
      + 'Launch Pulse Canvas, then retry.',
    );
  }
  const parsed = JSON.parse(raw) as Partial<RuntimeInfo>;
  if (typeof parsed.baseUrl !== 'string' || typeof parsed.secret !== 'string') {
    throw new Error(`Pulse Canvas runtime file is malformed: ${runtimeFile}`);
  }
  return { baseUrl: parsed.baseUrl, secret: parsed.secret };
}

export async function callCapability(options: CapabilityCallOptions): Promise<unknown> {
  const { baseUrl, secret } = readRuntimeInfo(options.runtimeFile);
  const doFetch = options.fetchImpl ?? fetch;
  const response = await doFetch(`${baseUrl}/capabilities/call`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      workspaceId: options.workspaceId,
      name: options.name,
      input: options.input,
    }),
  });
  const payload = await response.json() as
    | { ok: true; value?: unknown }
    | { ok: false; error?: { message?: string; code?: string } };
  if (!payload.ok) {
    const message = payload.error?.message ?? `capability call failed (HTTP ${response.status})`;
    throw new Error(`${options.name}: ${message}`);
  }
  return (payload as { ok: true; value?: unknown }).value ?? payload;
}

interface PulseCanvasToolConfig {
  workspaceId?: string;
  runtimeFile?: string;
  fetchImpl?: typeof fetch;
}

const asText = (value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }];

/**
 * Build the tool definitions. Exported so the app's tests can exercise
 * registration and execution without a live pi runtime.
 */
export function createPulseCanvasTools(config: PulseCanvasToolConfig = {}) {
  const workspaceId = () => {
    const id = config.workspaceId ?? process.env.PULSE_CANVAS_WORKSPACE_ID ?? '';
    if (!id) {
      throw new Error(
        'No Pulse Canvas workspace bound to this run — set PULSE_CANVAS_WORKSPACE_ID '
        + '(the app sets it automatically for pi-backed chat).',
      );
    }
    return id;
  };
  const call = async (name: string, input: Record<string, unknown>) => asText(
    await callCapability({
      name,
      workspaceId: workspaceId(),
      input,
      runtimeFile: config.runtimeFile,
      fetchImpl: config.fetchImpl,
    }),
  );

  return [
    {
      name: 'canvas_context_read',
      label: 'Canvas context',
      description:
        'Read the Pulse Canvas workspace map the Canvas Agent works from: nodes, titles, positions, edges. Pass scope="detailed" for per-node content (expensive).',
      parameters: Type.Object({
        scope: Type.Optional(Type.Union([Type.Literal('summary'), Type.Literal('detailed')])),
      }),
      execute: async (_id: string, params: { scope?: 'summary' | 'detailed' }) => ({
        content: await call('canvas.context.read', params.scope ? { scope: params.scope } : {}),
      }),
    },
    {
      name: 'canvas_node_read',
      label: 'Read canvas node',
      description: 'Read the full live detail of one Pulse Canvas node by id.',
      parameters: Type.Object({
        nodeId: Type.String({ description: 'Canvas node id' }),
      }),
      execute: async (_id: string, params: { nodeId: string }) => ({
        content: await call('canvas.nodes.read', { nodeId: params.nodeId }),
      }),
    },
    {
      name: 'canvas_nodes_search',
      label: 'Search canvas nodes',
      description: 'Search Pulse Canvas nodes by text query. Returns matches with ids and snippets.',
      parameters: Type.Object({
        query: Type.Optional(Type.String({ description: 'Text to search for' })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
      }),
      execute: async (_id: string, params: { query?: string; limit?: number }) => ({
        content: await call('canvas.nodes.search', {
          ...(params.query ? { query: params.query } : {}),
          ...(params.limit ? { limit: params.limit } : {}),
        }),
      }),
    },
    {
      name: 'canvas_node_update',
      label: 'Update canvas node',
      description:
        'Update one Pulse Canvas node. Only title and content can be changed through this bridge.',
      parameters: Type.Object({
        nodeId: Type.String({ description: 'Canvas node id' }),
        title: Type.Optional(Type.String()),
        content: Type.Optional(Type.String()),
      }),
      execute: async (_id: string, params: { nodeId: string; title?: string; content?: string }) => ({
        content: await call('canvas.nodes.update', {
          nodeId: params.nodeId,
          ...(params.title !== undefined ? { title: params.title } : {}),
          ...(params.content !== undefined ? { content: params.content } : {}),
        }),
      }),
    },
  ];
}

export default function (pi: { registerTool: (tool: unknown) => void }) {
  for (const tool of createPulseCanvasTools()) {
    pi.registerTool(tool);
  }
}
