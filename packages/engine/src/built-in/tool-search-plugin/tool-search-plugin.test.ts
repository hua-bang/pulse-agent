import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { Engine } from '../../Engine.js';
import { builtInToolSearchPlugin } from './tool-search-plugin.js';
import type { Tool } from '../../shared/types.js';

const createLogger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });

const tool = (name: string, deferred = false): Tool => ({
  name,
  description: `${name} tool`,
  inputSchema: z.object({}),
  ...(deferred ? { defer_loading: true } : {}),
  execute: async () => `${name} ran`,
});

describe('tool search state isolation', () => {
  const previousThreshold = process.env.PULSE_CODER_TOOL_SEARCH_THRESHOLD;

  beforeEach(() => {
    // Threshold 0 forces the defer + search path instead of loading upfront.
    process.env.PULSE_CODER_TOOL_SEARCH_THRESHOLD = '0';
  });

  afterEach(() => {
    if (previousThreshold === undefined) delete process.env.PULSE_CODER_TOOL_SEARCH_THRESHOLD;
    else process.env.PULSE_CODER_TOOL_SEARCH_THRESHOLD = previousThreshold;
  });

  it('keeps tools one run discovered when another run starts on the same engine', async () => {
    const engine = new Engine({
      disableBuiltInPlugins: true,
      enginePlugins: { plugins: [builtInToolSearchPlugin], scan: false },
      builtInTools: { ping: tool('ping'), deferred_alpha: tool('deferred_alpha', true) },
      logger: createLogger(),
    });
    await engine.initialize();

    const first = await engine.createToolSession({ messages: [] });
    expect(first.getTools()).not.toHaveProperty('deferred_alpha');
    await first.executeTool('tool_search_tool_regex', { query: 'deferred_alpha' });
    expect(first.getTools()).toHaveProperty('deferred_alpha');
    // Move past the search result so nothing re-derives the tool from history.
    await first.executeTool('ping', {});

    // A second, concurrent run starts: its beforeRun used to clear the
    // engine-wide loaded set for everyone.
    const second = await engine.createToolSession({ messages: [] });
    await first.executeTool('ping', {});

    expect(first.getTools()).toHaveProperty('deferred_alpha');
    expect(second.getTools()).not.toHaveProperty('deferred_alpha');
    await first.dispose();
    await second.dispose();
  });
});
