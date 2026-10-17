import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV3 } from 'ai/test';
import { z } from 'zod';

import { Engine } from '../../Engine.js';
import { SubAgentPlugin } from './index.js';

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

const toolCallStream = (toolName: string, input: unknown) => ({
  stream: new ReadableStream({ start(controller) {
    controller.enqueue({ type: 'tool-call', toolCallId: `${toolName}-call`, toolName, input: JSON.stringify(input) });
    controller.enqueue({ type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool-calls' }, usage });
    controller.close();
  } }),
});

const textStream = (text: string) => ({
  stream: new ReadableStream({ start(controller) {
    controller.enqueue({ type: 'text-start', id: 't' });
    controller.enqueue({ type: 'text-delta', id: 't', delta: text });
    controller.enqueue({ type: 'text-end', id: 't' });
    controller.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage });
    controller.close();
  } }),
});

function agentDir(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'sub-agent-'));
  const dir = path.join(root, 'agents');
  mkdirSync(dir);
  writeFileSync(path.join(dir, 'reviewer.md'), '---\nname: reviewer\ndescription: Reviews code\n---\nYou review code.\n');
  return dir;
}

describe('sub-agent runs inherit the parent run', () => {
  it('uses the parent provider and model, the host tool table and the engine tool hooks', async () => {
    const responses = [
      toolCallStream('reviewer_agent', { task: 'review the diff' }),
      toolCallStream('ping', {}),
      textStream('child done'),
      textStream('parent done'),
    ];
    const model = new MockLanguageModelV3({ doStream: async () => responses.shift()! });
    const provider = vi.fn(() => model);
    const beforeToolCall = vi.fn(() => undefined);

    const engine = new Engine({
      disableBuiltInPlugins: true,
      enginePlugins: {
        scan: false,
        plugins: [
          new SubAgentPlugin({ agentDirs: [agentDir()] }),
          {
            name: 'test/tool-hook',
            version: '1.0.0',
            async initialize(context) {
              context.registerHook('beforeToolCall', beforeToolCall);
            },
          },
        ],
      },
      builtInTools: {
        ping: { name: 'ping', description: 'Ping.', inputSchema: z.object({}), execute: async () => 'pong' },
      },
      llmProvider: provider,
      model: 'parent-model',
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    await engine.initialize();

    const result = await engine.run({ messages: [{ role: 'user', content: 'review please' }] });

    expect(result).toBe('parent done');
    // Every model call, the child's included, went to the parent's provider and model.
    expect(provider).toHaveBeenCalledTimes(4);
    expect(new Set(provider.mock.calls.map(([name]) => name))).toEqual(new Set(['parent-model']));

    const toolNames = model.doStreamCalls.map((call) => (call.tools ?? []).map((tool: any) => tool.name).sort());
    expect(toolNames[0]).toEqual(['ping', 'reviewer_agent']);
    // The child cannot delegate again.
    expect(toolNames[1]).toEqual(['ping']);

    // The engine's beforeToolCall hook saw the child's tool call too.
    expect(beforeToolCall.mock.calls.map(([input]: any[]) => input.name)).toEqual(['reviewer_agent', 'ping']);
  });
});
