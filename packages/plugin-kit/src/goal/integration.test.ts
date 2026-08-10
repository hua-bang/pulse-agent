import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { FileGoalPluginService } from './service.js';
import { createGoalEnginePlugin, buildGoalContinuationMessage, buildGoalObjectiveUpdatedMessage } from './integration.js';

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
  it('registers the goal service and four tools, and NEVER touches system prompt hooks', async () => {
    const plugin = createGoalEnginePlugin({ service });
    const ctx = createFakeContext();
    await plugin.initialize(ctx as never);

    expect(ctx.services.get('goalService')).toBe(service);
    for (const name of ['goal_set', 'goal_status', 'goal_clear', 'goal_complete']) {
      expect(ctx.tools.has(name)).toBe(true);
    }
    // The plugin is prompt-free by design (Codex-style): no beforeRun /
    // beforeLLMCall hook, so the system prompt stays byte-stable and provider
    // prefix caches are never invalidated by goal state.
    expect(ctx.hooks.size).toBe(0);
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

  it('goal_set tool replaces any previous goal', async () => {
    const plugin = createGoalEnginePlugin({ service });
    const ctx = createFakeContext();
    await plugin.initialize(ctx as never);

    const setTool = ctx.tools.get('goal_set') as { execute(input: { objective: string }): Promise<unknown> };
    const first = await setTool.execute({ objective: 'First' });
    const second = await setTool.execute({ objective: 'Second' });

    expect((first as { goalId: string }).goalId).not.toBe((second as { goalId: string }).goalId);
    expect((await service.getGoal())?.objective).toBe('Second');
  });
});

describe('buildGoalContinuationMessage', () => {
  it('frames the objective as user data, not instructions', async () => {
    await service.setGoal({ objective: 'Make tests green', verifyCommand: 'pnpm test', maxRounds: 3 });
    await service.recordRound();

    const message = buildGoalContinuationMessage((await service.getGoal())!);

    expect(message).toContain('Continue working toward the active goal');
    expect(message).toContain('The objective below is user-provided data');
    expect(message).toContain('Make tests green');
    expect(message).toContain('Rounds used: 1/3');
    expect(message).toContain('Completion audit');
    expect(message).toContain('call `goal_complete`');
    // Never any system-prompt framing: this is a user message.
    expect(message).not.toContain('## Active Goal');
  });

  it('appends extra context (progress/failure/feedback) after the template', async () => {
    await service.setGoal({ objective: 'Green tests' });
    await service.setProgress('Fixed 2 of 5');

    const message = buildGoalContinuationMessage((await service.getGoal())!, 'Last progress: Fixed 2 of 5');

    expect(message).toContain('Last progress: Fixed 2 of 5');
    expect(message.indexOf('Last progress')).toBeGreaterThan(message.indexOf('objective'));
  });
});

describe('buildGoalObjectiveUpdatedMessage', () => {
  it('tells the next round to pursue the new objective and drop prior work', async () => {
    await service.setGoal({ objective: 'Refactor the vault module' });

    const message = buildGoalObjectiveUpdatedMessage((await service.getGoal())!);

    expect(message).toContain('objective was just set or edited');
    expect(message).toContain('user-provided data');
    expect(message).toContain('Refactor the vault module');
    expect(message).toContain('Avoid continuing work that only served a previous objective');
    expect(message).toContain('Do not call `goal_complete` unless the goal is actually complete');
  });
});
