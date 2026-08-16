import { afterAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { Engine } from '../../Engine.js';
import { builtInPlanModePlugin } from './index.js';
import type { PlanModeEvent } from './index.js';
import { WriteTool } from '../../tools/index.js';

const createLogger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

const makeEngine = async () => {
  const engine = new Engine({
    disableBuiltInPlugins: true,
    enginePlugins: { plugins: [builtInPlanModePlugin], scan: false },
    userConfigPlugins: { scan: false },
    builtInTools: {
      read: {
        name: 'read',
        description: 'Read a file.',
        inputSchema: z.object({ path: z.string() }),
        execute: async ({ path }: { path: string }) => ({ content: `content of ${path}` }),
      },
      write: WriteTool,
      bash: {
        name: 'bash',
        description: 'Execute a bash command.',
        inputSchema: z.object({ command: z.string() }),
        execute: async ({ command }: { command: string }) => {
          // Never really executes in tests; this fake records the call so the
          // test can prove planning mode blocked it BEFORE execution.
          return { output: `EXECUTED:${command}`, exitCode: 0 };
        },
      },
      generate_image: {
        name: 'generate_image',
        description: 'Generate an image.',
        inputSchema: z.object({ prompt: z.string() }),
        execute: async () => ({ ok: true }),
      },
    },
    logger: createLogger(),
  });
  await engine.initialize();
  return engine;
};

describe('built-in plan mode hard blocking', () => {
  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('blocks mutating tools in planning mode with a synthetic result', async () => {
    const engine = await makeEngine();
    expect(engine.setMode('planning')).toBe(true);

    const session = await engine.createToolSession({ messages: [] });
    const output = (await session.executeTool('write', {
      filePath: '/tmp/plan-mode-blocked.txt',
      content: 'nope',
    })) as { success?: boolean; blockedByPlanMode?: boolean; error?: string };

    expect(output.blockedByPlanMode).toBe(true);
    expect(output.success).toBe(false);
    expect(output.error).toContain('planning mode');
  });

  it('blocks generate_image (mutating disk write) in planning mode', async () => {
    const engine = await makeEngine();
    engine.setMode('planning');

    const session = await engine.createToolSession({ messages: [] });
    const output = (await session.executeTool('generate_image', {
      prompt: 'a cat',
    })) as { blockedByPlanMode?: boolean };

    expect(output.blockedByPlanMode).toBe(true);
  });

  it('allows read tools in planning mode', async () => {
    const engine = await makeEngine();
    engine.setMode('planning');

    const session = await engine.createToolSession({ messages: [] });
    const output = await session.executeTool('read', { path: 'src/index.ts' });
    expect(output).toEqual({ content: 'content of src/index.ts' });
  });

  it('blocks non-read-only bash commands in planning mode', async () => {
    const engine = await makeEngine();
    engine.setMode('planning');

    const session = await engine.createToolSession({ messages: [] });
    const output = (await session.executeTool('bash', {
      command: 'rm -rf /tmp/plan-mode-rm',
    })) as { output?: string; error?: string; exitCode?: number };

    expect(output.exitCode).toBe(1);
    expect(output.error).toContain('Blocked by planning mode');
    expect(output.output).toBe('');
  });

  it('allows read-only bash commands in planning mode', async () => {
    const engine = await makeEngine();
    engine.setMode('planning');

    const session = await engine.createToolSession({ messages: [] });
    const output = (await session.executeTool('bash', {
      command: 'ls -la',
    })) as { output?: string; exitCode?: number };

    // Fake bash echoes EXECUTED:... — proves it was NOT blocked.
    expect(output.output).toContain('EXECUTED:ls -la');
  });

  it('allows mutating tools in executing mode', async () => {
    const engine = await makeEngine();
    engine.setMode('executing');

    const session = await engine.createToolSession({ messages: [] });
    const output = (await session.executeTool('write', {
      filePath: '/tmp/plan-mode-executing.txt',
      content: 'allowed',
    })) as { success?: boolean };

    expect(output.success).toBe(true);
  });

  it('emits disallowed_tool_attempt_in_planning when a tool is blocked', async () => {
    const engine = await makeEngine();
    engine.setMode('planning');

    const events: PlanModeEvent[] = [];
    engine.events.on('disallowed_tool_attempt_in_planning', (event: PlanModeEvent) => {
      events.push(event);
    });

    const session = await engine.createToolSession({ messages: [] });
    await session.executeTool('bash', { command: 'rm -rf /tmp/x' });

    expect(events.length).toBe(1);
    expect(events[0].payload).toMatchObject({
      toolName: 'bash',
      category: 'execute',
    });
  });

  it('does not block read-only bash in planning mode with compound commands', async () => {
    const engine = await makeEngine();
    engine.setMode('planning');

    const session = await engine.createToolSession({ messages: [] });
    const output = (await session.executeTool('bash', {
      command: 'cd src && grep -r TODO .',
    })) as { output?: string };

    expect(output.output).toContain('EXECUTED:cd src && grep -r TODO .');
  });
});
