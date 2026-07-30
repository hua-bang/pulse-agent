import type { Engine } from 'pulse-coder-engine';
import { describe, expect, it, vi } from 'vitest';

import type { AgentRoleDefinition } from '../../shared/agent-roles';
import { createFailedTurnToolTracker } from './chat-failure-persistence';
import { ENGINE_ABORT_SENTINEL, settleStoppedToolCalls } from './chat-stop';

const runExternalRoleSegment = vi.hoisted(() => vi.fn());

vi.mock('./external/segment', () => ({ runExternalRoleSegment }));

import { executeCanvasAgentSegment } from './segment-execution';

describe('executeCanvasAgentSegment', () => {
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
});
