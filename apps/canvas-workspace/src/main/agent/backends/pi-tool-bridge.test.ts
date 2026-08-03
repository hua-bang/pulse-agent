import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Engine } from 'pulse-coder-engine';

import {
  executePiToolBridgeCall,
  preparePiToolBridge,
} from './pi-tool-bridge';
import {
  createCanvasAgentToolPolicy,
  createCanvasAskModeToolPolicyPlugin,
} from '../tool-policy';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'canvas-pi-tool-bridge-'));
  process.env.PULSE_CANVAS_PI_BRIDGE_DIR = dir;
});

afterEach(() => {
  delete process.env.PULSE_CANVAS_PI_BRIDGE_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe('pi full tool bridge', () => {
  it('writes a manifest from the engine tool table without a copied allowlist', async () => {
    const tools = {
      canvas_create_node: {
        name: 'canvas_create_node',
        description: 'Create a node.',
        inputSchema: z.object({ title: z.string() }),
        execute: vi.fn(),
      },
      memory_save: {
        name: 'memory_save',
        description: 'Save memory.',
        inputSchema: z.object({ content: z.string() }),
        execute: vi.fn(),
      },
    };
    const engine = {
      createToolSession: async () => ({
        getTools: () => tools,
        executeTool: vi.fn(),
        dispose: vi.fn(),
      }),
    };

    const bridge = await preparePiToolBridge({
      engine: engine as never,
      context: { messages: [] },
      workspaceId: 'ws-1',
      executionMode: 'ask',
      abortSignal: new AbortController().signal,
    });

    const manifest = JSON.parse(readFileSync(bridge.manifestPath, 'utf8'));
    expect(manifest.tools.map((tool: { name: string }) => tool.name)).toEqual([
      'canvas_create_node',
      'memory_save',
    ]);
    expect(manifest.tools[0].parameters).toMatchObject({
      type: 'object',
      required: ['title'],
    });
    expect(bridge.env).toMatchObject({
      PULSE_CANVAS_PI_TOOL_BRIDGE_ID: bridge.id,
      PULSE_CANVAS_PI_TOOL_BRIDGE_SECRET: expect.stringMatching(/^[a-f0-9]{64}$/),
      PULSE_CANVAS_PI_TOOL_MANIFEST: bridge.manifestPath,
      PULSE_CANVAS_WORKSPACE_ID: 'ws-1',
    });
    await bridge.dispose();
  });

  it('executes through the Engine tool session with the bound run context', async () => {
    const executeTool = vi.fn().mockResolvedValue({ id: 'node-1' });
    const tools = {
      canvas_create_node: {
        name: 'canvas_create_node',
        description: 'Create a node.',
        inputSchema: z.object({ title: z.string() }),
        execute: vi.fn(),
      },
    };
    const engine = {
      createToolSession: async () => ({ getTools: () => tools, executeTool, dispose: vi.fn() }),
    };
    const abortSignal = new AbortController().signal;
    const onClarificationRequest = vi.fn();
    const context = { messages: [] };
    const bridge = await preparePiToolBridge({
      engine: engine as never,
      context,
      workspaceId: 'ws-1',
      executionMode: 'ask',
      abortSignal,
      onClarificationRequest,
    });

    await expect(executePiToolBridgeCall({
      bridgeId: bridge.id,
      bridgeSecret: '0'.repeat(64),
      toolCallId: 'forged-call',
      name: 'canvas_create_node',
      input: { title: 'Forged' },
    })).rejects.toThrow(/credential/i);
    expect(executeTool).not.toHaveBeenCalled();

    await expect(executePiToolBridgeCall({
      bridgeId: bridge.id,
      bridgeSecret: bridge.env.PULSE_CANVAS_PI_TOOL_BRIDGE_SECRET,
      toolCallId: 'call-1',
      name: 'canvas_create_node',
      input: { title: 'Hello' },
    })).resolves.toEqual({
      value: { id: 'node-1' },
      tools: [expect.objectContaining({ name: 'canvas_create_node' })],
      activeToolNames: ['canvas_create_node'],
    });
    expect(executeTool).toHaveBeenCalledWith(
      'canvas_create_node',
      { title: 'Hello' },
      {
        abortSignal,
        onClarificationRequest,
        runContext: { executionMode: 'ask' },
        toolCallId: 'call-1',
      },
    );

    await bridge.dispose();
    await expect(executePiToolBridgeCall({
      bridgeId: bridge.id,
      bridgeSecret: bridge.env.PULSE_CANVAS_PI_TOOL_BRIDGE_SECRET,
      toolCallId: 'call-2',
      name: 'canvas_create_node',
      input: { title: 'Late' },
    })).rejects.toThrow(/expired/i);
  });

  it('returns the complete policy-visible table after a policy step', async () => {
    const searchTool = {
      name: 'tool_search_tool_bm25',
      description: 'Search deferred tools.',
      inputSchema: z.object({ query: z.string() }),
      execute: vi.fn(),
    };
    const artifactTool = {
      name: 'artifact_create',
      description: 'Create an artifact.',
      inputSchema: z.object({ title: z.string() }),
      execute: vi.fn(),
    };
    let visible: Record<string, any> = { tool_search_tool_bm25: searchTool };
    const session = {
      getTools: () => visible,
      executeTool: vi.fn(async () => {
        visible = { tool_search_tool_bm25: searchTool, artifact_create: artifactTool };
        return { tool_references: [{ tool_name: 'artifact_create' }] };
      }),
      dispose: vi.fn(),
    };
    const bridge = await preparePiToolBridge({
      engine: { createToolSession: async () => session } as never,
      context: { messages: [] },
      workspaceId: 'ws-1',
      executionMode: 'auto',
      abortSignal: new AbortController().signal,
    });

    const result = await executePiToolBridgeCall({
      bridgeId: bridge.id,
      bridgeSecret: bridge.env.PULSE_CANVAS_PI_TOOL_BRIDGE_SECRET,
      toolCallId: 'search-1',
      name: 'tool_search_tool_bm25',
      input: { query: 'artifact' },
    });
    expect(result.tools.map(tool => tool.name)).toEqual(['artifact_create', 'tool_search_tool_bm25']);
    expect(result.activeToolNames).toEqual(['artifact_create', 'tool_search_tool_bm25']);
    await bridge.dispose();
  });

  it('fails closed through the real Engine hook chain when Ask mode denies a write', async () => {
    const execute = vi.fn(async () => 'should not run');
    const engine = new Engine({
      disableBuiltInPlugins: true,
      enginePlugins: { plugins: [createCanvasAskModeToolPolicyPlugin()], scan: false },
      userConfigPlugins: { scan: false },
      builtInTools: {},
      tools: {
        canvas_create_node: {
          name: 'canvas_create_node',
          description: 'Create a node.',
          inputSchema: z.object({ title: z.string() }),
          execute,
        },
      },
    });
    await engine.initialize();
    const onClarificationRequest = vi.fn(async () => 'No');
    const bridge = await preparePiToolBridge({
      engine,
      context: { messages: [] },
      workspaceId: 'ws-1',
      executionMode: 'ask',
      abortSignal: new AbortController().signal,
      onClarificationRequest,
    });

    const result = await executePiToolBridgeCall({
      bridgeId: bridge.id,
      bridgeSecret: bridge.env.PULSE_CANVAS_PI_TOOL_BRIDGE_SECRET,
      toolCallId: 'write-1',
      name: 'canvas_create_node',
      input: { title: 'Blocked' },
    });
    expect(result.value).toMatchObject({ ok: false, cancelled: true });
    expect(onClarificationRequest).toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    await bridge.dispose();
  });

  it('preserves the reviewed global tool allowlist without a workspace binding', async () => {
    const policy = createCanvasAgentToolPolicy({ kind: 'global' });
    const engine = new Engine({
      disableBuiltInPlugins: true,
      enginePlugins: { scan: false },
      userConfigPlugins: { scan: false },
      builtInTools: policy.builtInTools,
      tools: policy.canvasTools,
    });
    await engine.initialize();
    const bridge = await preparePiToolBridge({
      engine,
      context: { messages: [] },
      workspaceId: '',
      executionMode: 'auto',
      abortSignal: new AbortController().signal,
    });
    const manifest = JSON.parse(readFileSync(bridge.manifestPath, 'utf8'));
    const names = manifest.tools.map((tool: { name: string }) => tool.name);

    expect(names).toContain('bash');
    expect(names).toContain('knowledge_search_nodes');
    expect(names).not.toContain('write');
    expect(names).not.toContain('edit');
    expect(names).not.toContain('canvas_create_node');
    expect(bridge.env).not.toHaveProperty('PULSE_CANVAS_WORKSPACE_ID');
    await bridge.dispose();
  });
});
