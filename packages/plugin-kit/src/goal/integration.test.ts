import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { FileGoalPluginService } from './service.js';
import { createGoalEnginePlugin, appendSystemPrompt } from './integration.js';

interface FakePluginContext {
  services: Map<string, unknown>;
  tools: Map<string, unknown>;
  hooks: Map<string, unknown[]>;
  logger: { debug(...args: unknown[]): void; info(...args: unknown[]): void; warn(...args: unknown[]): void; error(...args: unknown[]): void };
  registerService(name: string, service: unknown): void;
  registerTools(tools: Record<string, unknown>): void;
  registerHook(name: string, handler: unknown): void;
}

function createFakeContext(): FakePluginContext {
  const ctx: FakePluginContext = {
    services: new Map(),
    tools: new Map(),
    hooks: new Map(),
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    registerService(name, service) { this.services.set(name, service); },
    registerTools(tools) { for (const [name, tool] of Object.entries(tools)) this.tools.set(name, tool); },
    registerHook(name, handler) {
      const list = this.hooks.get(name) ?? [];
      list.push(handler);
      this.hooks.set(name, list);
    },
  };
  return ctx;
}

let dir: string;
let service: FileGoalPluginService;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'goal-integration-test-'));
  service = new FileGoalPluginService({ baseDir: dir, scope: 'scope' });
  await service.initialize();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('createGoalEnginePlugin', () => {
  it('registers goal service, four tools, and a beforeLLMCall hook', async () => {
    const plugin = createGoalEnginePlugin({ service });
    const ctx = createFakeContext();
    await plugin.initialize(ctx as never);

    expect(ctx.services.get('goalService')).toBe(service);
    for (const name of ['goal_set', 'goal_status', 'goal_clear', 'goal_complete']) {
      expect(ctx.tools.has(name)).toBe(true);
    }
    expect((ctx.hooks.get('beforeLLMCall') ?? []).length).toBe(1);
  });

  it('does not inject a goal prompt when no goal is active', async () => {
    const plugin = createGoalEnginePlugin({ service });
    const ctx = createFakeContext();
    await plugin.initialize(ctx as never);

    const hook = (ctx.hooks.get('beforeLLMCall') ?? [])[0] as (input: { systemPrompt?: unknown }) => Promise<unknown>;
    const result = await hook({ systemPrompt: undefined });
    expect(result).toBeUndefined();
  });

  it('injects only STABLE goal fields on beforeLLMCall (cache safety)', async () => {
    await service.setGoal({ objective: 'Make tests green', verifyCommand: 'pnpm test', maxRounds: 3 });
    await service.recordRound();
    await service.setProgress('Fixed 2 of 5 tests');

    const plugin = createGoalEnginePlugin({ service });
    const ctx = createFakeContext();
    await plugin.initialize(ctx as never);

    const hook = (ctx.hooks.get('beforeLLMCall') ?? [])[0] as (input: { systemPrompt?: unknown }) => Promise<{ systemPrompt: unknown }>;
    const result = await hook({ systemPrompt: { append: 'base prompt' } });

    const append = (result?.systemPrompt as { append: string }).append;
    expect(append).toContain('## Active Goal (Goal Plugin)');
    expect(append).toContain('Make tests green');
    expect(append).toContain('Host verification command: pnpm test');
    expect(append).toContain('Do not stop early');
    // Dynamic per-round state must NOT ride the system prompt — it would break
    // provider prefix caching on every continuation round.
    expect(append).not.toContain('Continuation rounds used');
    expect(append).not.toContain('Rounds used');
    expect(append).not.toContain('Last progress');
    expect(append).not.toContain('Fixed 2 of 5 tests');
  });

  it('does not inject after the goal is completed', async () => {
    await service.setGoal({ objective: 'Done soon' });
    await service.completeGoal({ summary: 'All done' });

    const plugin = createGoalEnginePlugin({ service });
    const ctx = createFakeContext();
    await plugin.initialize(ctx as never);

    const hook = (ctx.hooks.get('beforeLLMCall') ?? [])[0] as (input: { systemPrompt?: unknown }) => Promise<unknown>;
    const result = await hook({ systemPrompt: undefined });
    expect(result).toBeUndefined();
  });

  it('goal_complete tool marks the goal completed and returns structured result', async () => {
    await service.setGoal({ objective: 'Ship it' });
    const plugin = createGoalEnginePlugin({ service });
    const ctx = createFakeContext();
    await plugin.initialize(ctx as never);

    const completeTool = ctx.tools.get('goal_complete') as { execute(input: { summary: string; evidence?: string[] }): Promise<unknown> };
    const result = await completeTool.execute({ summary: 'Shipped', evidence: ['build ok'] });

    expect(result).toEqual({
      completed: true,
      goalId: expect.any(String),
      summary: 'Shipped',
      storagePath: service.storagePath,
    });
    expect((await service.getGoal())?.status).toBe('completed');
  });
});

describe('appendSystemPrompt', () => {
  it('creates an append-only prompt from nothing', () => {
    expect(appendSystemPrompt(undefined, 'hello')).toEqual({ append: 'hello' });
  });

  it('merges into an existing append prompt', () => {
    expect(appendSystemPrompt({ append: 'base' }, 'extra')).toEqual({ append: 'base\n\nextra' });
  });

  it('handles string prompts', () => {
    expect(appendSystemPrompt('raw', 'extra')).toBe('raw\n\nextra');
  });

  it('handles function prompts', () => {
    const result = appendSystemPrompt(() => 'fn', 'extra') as () => string;
    expect(result()).toBe('fn\n\nextra');
  });

  it('returns base unchanged for empty append', () => {
    expect(appendSystemPrompt({ append: 'base' }, '   ')).toEqual({ append: 'base' });
  });
});
