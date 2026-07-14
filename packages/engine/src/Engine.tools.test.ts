import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { Engine } from './Engine.js';
import { ReadTool } from './tools/index.js';

const createLogger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

describe('Engine built-in tool policy', () => {
  it('lets a host replace the built-in tool set while preserving custom tools', async () => {
    const engine = new Engine({
      disableBuiltInPlugins: true,
      enginePlugins: { scan: false },
      userConfigPlugins: { scan: false },
      builtInTools: { read: ReadTool },
      tools: {
        host_answer: {
          name: 'host_answer',
          description: 'Answer a host-specific question.',
          inputSchema: z.object({ question: z.string() }),
          execute: async ({ question }: { question: string }) => question,
        },
      },
      logger: createLogger(),
    });

    await engine.initialize();

    expect(Object.keys(engine.getTools()).sort()).toEqual(['host_answer', 'read']);
  });
});
