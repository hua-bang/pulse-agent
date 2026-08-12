import { beforeEach, describe, expect, it, vi } from 'vitest';

const { publish } = vi.hoisted(() => ({ publish: vi.fn() }));
vi.mock('../../../plugins/main', () => ({ publishAgentTraceEvent: publish }));

import { createPiGenerationObserver } from './pi-generation-events';

const assistantMessage = (stopReason: 'stop' | 'error' = 'stop') => ({
  role: 'assistant' as const,
  content: [],
  api: 'test',
  provider: 'test',
  model: 'pi-test',
  usage: {},
  stopReason,
  timestamp: 1,
  ...(stopReason === 'error' ? { errorMessage: 'provider failed' } : {}),
});

describe('Pi generation observability', () => {
  beforeEach(() => publish.mockReset());

  it('records each assistant provider message as one Pi generation', () => {
    const observer = createPiGenerationObserver('run-pi');
    observer.onEvent({ type: 'message_start', message: assistantMessage() } as any);
    observer.onEvent({ type: 'message_end', message: assistantMessage() } as any);
    observer.onEvent({ type: 'message_start', message: assistantMessage() } as any);
    observer.onEvent({ type: 'message_end', message: assistantMessage('error') } as any);

    expect(publish.mock.calls.map(([event]) => [event.type, event.generationId])).toEqual([
      ['generation.started', 'run-pi:generation:1'],
      ['generation.completed', 'run-pi:generation:1'],
      ['generation.started', 'run-pi:generation:2'],
      ['generation.completed', 'run-pi:generation:2'],
    ]);
    expect(publish.mock.calls.at(-1)?.[0]).toMatchObject({
      owner: 'pi',
      finishReason: 'error',
      error: 'provider failed',
    });
  });

  it('ignores user messages and runs without an observability id', () => {
    const observer = createPiGenerationObserver(undefined);
    observer.onEvent({ type: 'message_start', message: assistantMessage() } as any);
    createPiGenerationObserver('run-pi').onEvent({
      type: 'message_start',
      message: { role: 'user', content: 'hello', timestamp: 1 },
    } as any);

    expect(publish).not.toHaveBeenCalled();
  });
});
