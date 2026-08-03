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

interface PiToolManifestEntry {
  name: string;
  label?: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

interface PiToolManifest {
  version: 1;
  tools: PiToolManifestEntry[];
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

export function readPiToolManifest(path: string): PiToolManifest {
  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<PiToolManifest>;
  if (parsed.version !== 1 || !Array.isArray(parsed.tools)) {
    throw new Error(`Invalid Pulse Canvas pi tool manifest: ${path}`);
  }
  return { version: 1, tools: validatePiToolEntries(parsed.tools, path) };
}

function validatePiToolEntries(tools: unknown, source: string): PiToolManifestEntry[] {
  if (!Array.isArray(tools)) {
    throw new Error(`Invalid Pulse Canvas pi tools from ${source}`);
  }
  const names = new Set<string>();
  for (const tool of tools as PiToolManifestEntry[]) {
    if (!tool || typeof tool !== 'object' || typeof tool.name !== 'string' || !tool.name.trim()) {
      throw new Error(`Invalid tool entry in Pulse Canvas pi tools from ${source}`);
    }
    if (names.has(tool.name)) {
      throw new Error(`Duplicate tool "${tool.name}" in Pulse Canvas pi tools from ${source}`);
    }
    if (tool.parameters !== undefined
      && (!tool.parameters || typeof tool.parameters !== 'object' || Array.isArray(tool.parameters))) {
      throw new Error(`Invalid parameters for tool "${tool.name}" in Pulse Canvas pi tools from ${source}`);
    }
    names.add(tool.name);
  }
  return tools as PiToolManifestEntry[];
}

async function callBridgedTool(options: {
  bridgeId: string;
  bridgeSecret: string;
  toolCallId: string;
  name: string;
  input: Record<string, unknown>;
}): Promise<{ value: unknown; tools: PiToolManifestEntry[]; activeToolNames: string[] }> {
  const { baseUrl, secret } = readRuntimeInfo();
  const response = await fetch(`${baseUrl}/pi-tools/call`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(options),
  });
  const payload = await response.json() as
    | { ok: true; value?: unknown; tools?: PiToolManifestEntry[]; activeToolNames?: unknown }
    | { ok: false; error?: string };
  if (!payload.ok) throw new Error(payload.error ?? `Pi tool bridge call failed (HTTP ${response.status})`);
  const tools = validatePiToolEntries(payload.tools ?? [], 'runtime bridge response');
  const activeToolNames = payload.activeToolNames ?? tools.map(tool => tool.name);
  if (!Array.isArray(activeToolNames)
    || activeToolNames.some(name => typeof name !== 'string' || !name.trim())
    || new Set(activeToolNames).size !== activeToolNames.length) {
    throw new Error('Invalid active tool names from Pulse Canvas runtime bridge response');
  }
  const visibleNames = new Set(tools.map(tool => tool.name));
  if (activeToolNames.some(name => !visibleNames.has(name as string))) {
    throw new Error('Active tool name is missing its definition in Pulse Canvas runtime bridge response');
  }
  return {
    value: payload.value,
    tools,
    activeToolNames: activeToolNames as string[],
  };
}

function createManifestTool(
  tool: PiToolManifestEntry,
  bridgeId: string,
  bridgeSecret: string,
  reconcileTools?: (tools: PiToolManifestEntry[], activeToolNames: string[]) => void,
) {
  return {
    name: tool.name,
    label: tool.label?.trim() || tool.name,
    description: tool.description ?? '',
    // TypeBox schemas are JSON Schema objects at runtime. The manifest is
    // generated from the Engine's FlexibleSchema through AI SDK asSchema().
    parameters: (tool.parameters ?? Type.Object({})) as any,
    execute: async (toolCallId: string, params: Record<string, unknown>) => {
      const result = await callBridgedTool({
        bridgeId,
        bridgeSecret,
        toolCallId,
        name: tool.name,
        input: params,
      });
      reconcileTools?.(result.tools, result.activeToolNames);
      return { content: asText(result.value) };
    },
  };
}

export function createManifestTools(
  manifestPath: string,
  bridgeId: string,
  bridgeSecret = process.env.PULSE_CANVAS_PI_TOOL_BRIDGE_SECRET?.trim() ?? '',
  reconcileTools?: (tools: PiToolManifestEntry[], activeToolNames: string[]) => void,
) {
  return readPiToolManifest(manifestPath).tools.map(tool =>
    createManifestTool(tool, bridgeId, bridgeSecret, reconcileTools));
}

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

export default function (pi: {
  registerTool: (tool: unknown) => void;
  setActiveTools?: (toolNames: string[]) => void;
}) {
  const manifestPath = process.env.PULSE_CANVAS_PI_TOOL_MANIFEST?.trim();
  const bridgeId = process.env.PULSE_CANVAS_PI_TOOL_BRIDGE_ID?.trim();
  const bridgeSecret = process.env.PULSE_CANVAS_PI_TOOL_BRIDGE_SECRET?.trim();
  if (!manifestPath && !bridgeId && !bridgeSecret) {
    for (const tool of createPulseCanvasTools()) pi.registerTool(tool);
    return;
  }
  if (!manifestPath || !bridgeId || !bridgeSecret) {
    throw new Error('Pulse Canvas pi tool bridge configuration is incomplete');
  }

  const fingerprints = new Map<string, string>();
  const reconcile = (
    entries: PiToolManifestEntry[],
    activeToolNames: string[],
    updateActiveSet = true,
  ) => {
    for (const entry of entries) {
      const fingerprint = JSON.stringify(entry);
      if (fingerprints.get(entry.name) === fingerprint) continue;
      fingerprints.set(entry.name, fingerprint);
      pi.registerTool(createManifestTool(entry, bridgeId, bridgeSecret, reconcile));
    }
    // pi binds action methods only after extension loading. The initial
    // manifest already is the active table, so defer this call until runtime.
    if (updateActiveSet) pi.setActiveTools?.(activeToolNames);
  };
  const initialTools = readPiToolManifest(manifestPath).tools;
  reconcile(initialTools, initialTools.map(tool => tool.name), false);
}
