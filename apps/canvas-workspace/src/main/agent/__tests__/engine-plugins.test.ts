import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { createCodemodePlugin } from 'pulse-coder-engine/built-in';

import { CANVAS_CODEMODE_TOOLS, createCanvasEnginePlugins } from '../engine-plugins';
import { classifyCanvasToolOperation, createCanvasAgentToolPolicy } from '../tool-policy';

type CodemodePlugin = ReturnType<typeof createCodemodePlugin>;
type PluginContext = Parameters<NonNullable<CodemodePlugin['initialize']>>[0];
type RegisteredTool = Parameters<PluginContext['registerTool']>[1];

// CanvasAgent builds its Engine with `disableBuiltInPlugins: true`, so this list
// is the ONLY way a built-in engine plugin reaches the Canvas Agent — a plugin
// missing here is silently absent, with no type or runtime error. That failure
// shape already bit this repo once: 35 canvas tools carried `defer_loading`
// while the plugin that enforces it (tool-search) was not in the list, so the
// flag was dead config and every tool still reached the model.
const pluginName = (plugin: unknown): string =>
  (plugin as { name?: string })?.name ?? '';

describe('canvas engine plugin list', () => {
  for (const scope of [
    { kind: 'workspace' as const, workspaceId: 'ws-1' },
    { kind: 'global' as const },
  ]) {
    it(`registers tool-search so defer_loading is enforced (${scope.kind})`, () => {
      const names = createCanvasEnginePlugins(scope).map(pluginName);

      expect(names).toContain('pulse-coder-engine/built-in-tool-search');
    });

    it(`keeps the scoped skills / MCP / offload plugins (${scope.kind})`, () => {
      const names = createCanvasEnginePlugins(scope).map(pluginName);

      // Every plugin must be identifiable; an unnamed entry would slip past the
      // assertions below without failing them.
      expect(names.every((name) => name.length > 0)).toBe(true);
      expect(names).toContain('pulse-coder-engine/built-in-skills');
      expect(names).toContain('pulse-coder-engine/built-in-mcp');
      expect(names).toContain('pulse-coder-engine/built-in-tool-offload');
      expect(names).toContain('canvas-agent-observability');
    });
  }
});

describe('canvas Codemode opt-in', () => {
  const codemode = 'pulse-coder-engine/codemode';
  const scope = { kind: 'workspace' as const, workspaceId: 'ws-1' };
  const dirs: string[] = [];

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const stubFlags = (overrides?: Record<string, boolean>) => {
    const dir = mkdtempSync(join(tmpdir(), 'canvas-codemode-flags-'));
    dirs.push(dir);
    const path = join(dir, 'experimental-features.json');
    if (overrides) writeFileSync(path, JSON.stringify(overrides));
    vi.stubEnv('PULSE_CANVAS_EXPERIMENTAL_FEATURES', path);
  };

  it('stays off without a user override', () => {
    stubFlags();

    expect(createCanvasEnginePlugins(scope).map(pluginName)).not.toContain(codemode);
  });

  it('follows the agent-codemode experimental flag', () => {
    stubFlags({ 'agent-codemode': true });

    expect(createCanvasEnginePlugins(scope).map(pluginName)).toContain(codemode);
    expect(createCanvasEnginePlugins(scope, { codemode: false }).map(pluginName)).not.toContain(codemode);
  });

  it('authorizes only read-only Canvas tools that exist in every interactive scope', () => {
    for (const toolScope of [scope, { kind: 'global' as const }]) {
      const { canvasTools } = createCanvasAgentToolPolicy(toolScope);
      for (const name of CANVAS_CODEMODE_TOOLS) {
        expect(canvasTools[name], `${name} in ${toolScope.kind}`).toBeDefined();
        expect(classifyCanvasToolOperation(name)).toBe('read');
      }
    }
  });

  it('permits complete bulk MCP patches while retaining a bounded Canvas argument budget', async () => {
    const plugin = createCanvasEnginePlugins(scope, { codemode: true })
      .find((entry) => pluginName(entry) === codemode) as CodemodePlugin;
    const tools = new Map<string, RegisteredTool>();
    await plugin.initialize!({
      registerTool: (name: string, tool: RegisteredTool) => { tools.set(name, tool); },
      events: { emit: vi.fn() },
    } as unknown as PluginContext);
    const executeTool = vi.fn(async () => 'saved');
    const nestedTools = {
      getTools: () => ({
        mcp_patch: {
          name: 'mcp_patch', description: 'Patch test drawing', codemode: true,
          inputSchema: z.object({ elements: z.string() }), execute: executeTool,
        },
      }),
      executeTool,
    };
    expect(await tools.get('codemode')!.execute({
      code: 'return await tools.mcp_patch({elements: "中".repeat(40000)});',
    }, { nestedTools })).toMatchObject({ ok: true, value: 'saved' });
    expect(executeTool).toHaveBeenCalledTimes(1);
    executeTool.mockClear();
    expect(await tools.get('codemode')!.execute({
      code: 'await tools.mcp_patch({elements: "中".repeat(180000)});',
    }, { nestedTools })).toMatchObject({ ok: false });
    expect(executeTool).not.toHaveBeenCalled();
  });
});
