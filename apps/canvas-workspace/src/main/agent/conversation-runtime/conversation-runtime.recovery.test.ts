import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentChatMessage } from '../../../shared/agent-chat';
import { conversationKey } from '../../../shared/conversation-runtime';
import { ConversationRuntime, type ConversationRuntimeDeps, type TurnRunnerContext } from './conversation-runtime';

const key = conversationKey({ kind: 'workspace', workspaceId: 'ws-a' }, 'session-a');

/** A runner the test drives step by step through the turn context. */
function controlledRun() {
  let ctx!: TurnRunnerContext;
  let finish!: (response: string) => void;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const runTurn: ConversationRuntimeDeps['runTurn'] = (turn) => {
    ctx = turn;
    markStarted();
    return new Promise(resolve => { finish = (response) => resolve({ response }); });
  };
  return {
    runTurn,
    started,
    ctx: () => ctx,
    finish: (response: string) => finish(response),
  };
}

function makeDeps(runTurn: ConversationRuntimeDeps['runTurn'], checkpointMs = 0) {
  const persisted: AgentChatMessage[][] = [];
  const deps: ConversationRuntimeDeps = {
    key,
    loadMessages: async () => [],
    persist: async (messages) => { persisted.push(messages.map(message => ({ ...message }))); },
    runTurn,
    checkpointMs,
  };
  return { deps, persisted };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ConversationRuntime recovery state', () => {
  it('exposes the streaming reply and tools in the snapshot until the turn settles', async () => {
    const run = controlledRun();
    const { deps } = makeDeps((ctx) => run.runTurn(ctx));
    const runtime = new ConversationRuntime(deps);
    await runtime.open();

    const done = runtime.sendAndWait({ message: 'hello' });
    await run.started;
    run.ctx().onText?.('Partial ');
    run.ctx().onToolCall?.({ name: 'bash', args: { command: 'ls' }, toolCallId: 'call-1' });
    run.ctx().onText?.('answer');

    const live = runtime.getSnapshot();
    expect(live.status).toBe('running');
    expect(live.messages.map(message => message.content)).toEqual(['hello']);
    expect(live.draft).toMatchObject({ role: 'assistant', content: 'Partial answer' });
    expect(live.draft?.contentBlocks).toEqual([
      { type: 'text', text: 'Partial ' },
      { type: 'tool', toolId: 1, toolCallId: 'call-1' },
      { type: 'text', text: 'answer' },
    ]);
    expect(live.streamingTools).toMatchObject([{ name: 'bash', status: 'running', toolCallId: 'call-1' }]);

    run.finish('Partial answer');
    await done;
    const settled = runtime.getSnapshot();
    expect(settled.draft).toBeNull();
    expect(settled.streamingTools).toEqual([]);
    expect(settled.messages.at(-1)).toMatchObject({ role: 'assistant', content: 'Partial answer' });
  });

  it('checkpoints the partial reply as interrupted and replaces it on finish', async () => {
    vi.useFakeTimers();
    const run = controlledRun();
    const { deps, persisted } = makeDeps((ctx) => run.runTurn(ctx), 1_000);
    const runtime = new ConversationRuntime(deps);
    await runtime.open();

    const done = runtime.sendAndWait({ message: 'hello' });
    await run.started;
    expect(persisted).toHaveLength(1);

    // Nothing streamed yet: no checkpoint.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(persisted).toHaveLength(1);

    run.ctx().onText?.('Half of the');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(persisted).toHaveLength(2);
    expect(persisted[1].at(-1)).toMatchObject({
      role: 'assistant',
      content: 'Half of the',
      turnStatus: 'failed',
      failureKind: 'interrupted',
      retryable: true,
    });

    // Unchanged content is not written again.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(persisted).toHaveLength(2);

    run.ctx().onText?.(' answer');
    run.finish('Half of the answer');
    await done;
    const final = persisted.at(-1)!;
    expect(final.map(message => message.content)).toEqual(['hello', 'Half of the answer']);
    expect(final.at(-1)?.turnStatus).toBeUndefined();

    const writes = persisted.length;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(persisted).toHaveLength(writes);
  });
});
