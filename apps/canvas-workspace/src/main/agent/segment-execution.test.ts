import type { Engine } from 'pulse-coder-engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentRoleDefinition } from '../../shared/agent-roles';
import { createFailedTurnToolTracker } from './chat-failure-persistence';
import { ENGINE_ABORT_SENTINEL, settleStoppedToolCalls } from './chat-stop';

const runExternalRoleSegment = vi.hoisted(() => vi.fn());

vi.mock('./external/segment', () => ({ runExternalRoleSegment }));

import { executeCanvasAgentSegment } from './segment-execution';

describe('executeCanvasAgentSegment', () => {
  beforeEach(() => {
    // These cases pin the Engine/external executor contracts. Keep them
    // independent from a developer's active Pi experimental setting.
    vi.stubEnv('PULSE_CANVAS_AGENT_RUNTIME', 'engine');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('normalizes an aborted external driver into stopped text and cancelled live tools', async () => {
    const abortController = new AbortController();
    const toolTracker = createFailedTurnToolTracker();
    const role: AgentRoleDefinition = {
      id: 'external-role',
      name: 'External',
      color: '#2383e2',
      prompt: 'Run external work.',
      external: { family: 'claude-code' },
      createdAt: 0,
      updatedAt: 0,
    };
    runExternalRoleSegment.mockImplementationOnce(async options => {
      options.onText?.('partial result');
      options.onToolCall?.({
        name: 'external_exec',
        args: { command: 'long-task' },
        toolCallId: 'external-1',
      });
      abortController.abort();
      throw new Error('External agent run aborted');
    });

    const result = await executeCanvasAgentSegment({
      engine: {} as Engine,
      context: { messages: [] },
      role,
      chatSessionId: 'session-1',
      history: [],
      currentAsk: 'continue',
      handoffNames: [],
      abortSignal: abortController.signal,
      executionMode: 'auto',
      onText: vi.fn(),
      ...toolTracker.callbacks,
      modelConfig: {
        providerType: 'openai',
        provider: vi.fn(),
        model: 'test-model',
        modelLabel: 'Test model',
      },
      systemPrompt: 'system',
      appendMessages: vi.fn(),
      replaceMessages: vi.fn(),
    });
    const tools = result.externalToolCalls ?? [];
    settleStoppedToolCalls(tools, toolTracker.snapshot());

    expect(result).toMatchObject({
      resultText: ENGINE_ABORT_SENTINEL,
      streamedText: 'partial result',
    });
    expect(tools).toEqual([expect.objectContaining({
      name: 'external_exec',
      toolCallId: 'external-1',
      status: 'cancelled',
      error: 'Operation cancelled by user',
    })]);
  });

  it('accumulates engine-path text deltas so a hard stop preserves the partial', async () => {
    const abortController = new AbortController();
    const onText = vi.fn();
    const engine = {
      run: vi.fn(async (_context: unknown, loopOptions: any) => {
        loopOptions.onText?.('engine partial');
        abortController.abort();
        return ENGINE_ABORT_SENTINEL;
      }),
    } as unknown as Engine;

    const result = await executeCanvasAgentSegment({
      engine,
      context: { messages: [] },
      role: null,
      chatSessionId: 'session-2',
      history: [],
      currentAsk: 'continue',
      handoffNames: [],
      abortSignal: abortController.signal,
      executionMode: 'auto',
      onText,
      modelConfig: {
        providerType: 'openai',
        provider: vi.fn(),
        model: 'test-model',
        modelLabel: 'Test model',
      },
      systemPrompt: 'system',
      appendMessages: vi.fn(),
      replaceMessages: vi.fn(),
    });

    expect(result.resultText).toBe(ENGINE_ABORT_SENTINEL);
    expect(result.streamedText).toBe('engine partial');
    expect(onText).toHaveBeenCalledWith('engine partial');
  });

  it('collects engine onResponse messages through the shared recorder', async () => {
    const appended: unknown[] = [];
    const engine = {
      run: vi.fn(async (_context: unknown, loopOptions: any) => {
        loopOptions.onResponse?.([{ role: 'assistant', content: 'done' }]);
        return 'done';
      }),
    } as unknown as Engine;

    const result = await executeCanvasAgentSegment({
      engine,
      context: { messages: [] },
      role: null,
      chatSessionId: 'session-3',
      history: [],
      currentAsk: 'go',
      handoffNames: [],
      abortSignal: new AbortController().signal,
      executionMode: 'auto',
      modelConfig: {
        providerType: 'openai',
        provider: vi.fn(),
        model: 'test-model',
        modelLabel: 'Test model',
      },
      systemPrompt: 'system',
      appendMessages: messages => appended.push(...messages),
      replaceMessages: vi.fn(),
    });

    expect(result.resultText).toBe('done');
    expect(result.responseMessages).toEqual([{ role: 'assistant', content: 'done' }]);
    expect(appended).toEqual([{ role: 'assistant', content: 'done' }]);
  });
});
