import { describe, expect, it, vi } from 'vitest';
import type { AgentChatMessage } from '../../../shared/agent-chat';
import { conversationKey, type ConversationKey } from '../../../shared/conversation-runtime';
import { ConversationRuntime, type ConversationRuntimeDeps, type TurnRunnerResult } from './conversation-runtime';
import { ConversationRuntimeRegistry } from './conversation-runtime-registry';

const workspace = { kind: 'workspace', workspaceId: 'ws-a' } as const;
const keyA: ConversationKey = conversationKey(workspace, 'session-a');
const keyB: ConversationKey = conversationKey(workspace, 'session-b');

const user = (content: string): AgentChatMessage => ({ role: 'user', content, timestamp: 0 });
const assistant = (content: string): AgentChatMessage => ({ role: 'assistant', content, timestamp: 0 });

/** A controllable fake engine runner for exercising async + clarification. */
function makeRunner() {
  const calls: Array<{ message: string; signal: AbortSignal }> = [];
  let behavior: (message: string, signal: AbortSignal) => Promise<TurnRunnerResult> = async (message) => ({
    response: `echo:${message}`,
  });
  const runTurn: ConversationRuntimeDeps['runTurn'] = (ctx) => {
    calls.push({ message: ctx.message, signal: ctx.signal });
    return behavior(ctx.message, ctx.signal);
  };
  return {
    calls,
    runTurn,
    setBehavior: (next: typeof behavior) => { behavior = next; },
  };
}

interface TestDeps extends ConversationRuntimeDeps {
  stored: AgentChatMessage[];
  persisted: AgentChatMessage[][];
}

function makeDeps(key: ConversationKey, runner: ReturnType<typeof makeRunner>): TestDeps {
  const persisted: AgentChatMessage[][] = [];
  let stored: AgentChatMessage[] = [];
  return {
    key,
    get stored() { return stored; },
    persisted,
    loadMessages: async () => [...stored],
    persist: async (messages) => { stored = [...messages]; persisted.push([...messages]); },
    runTurn: runner.runTurn,
  };
}

describe('ConversationRuntime (main, async owner)', () => {
  it('keeps two conversations in one workspace independent, including streaming state', async () => {
    const runnerA = makeRunner();
    const runnerB = makeRunner();
    let resolveA!: (r: TurnRunnerResult) => void;
    let resolveB!: (r: TurnRunnerResult) => void;
    runnerA.setBehavior(() => new Promise(res => { resolveA = res; }));
    runnerB.setBehavior(() => new Promise(res => { resolveB = res; }));

    const a = new ConversationRuntime(makeDeps(keyA, runnerA));
    const b = new ConversationRuntime(makeDeps(keyB, runnerB));
    await a.open();
    await b.open();

    a.send({ message: 'A' });
    b.send({ message: 'B' });

    expect(a.getSnapshot().status).toBe('running');
    expect(b.getSnapshot().status).toBe('running');
    expect(a.getSnapshot().messages.map(m => m.content)).toEqual(['A']);
    expect(b.getSnapshot().messages.map(m => m.content)).toEqual(['B']);

    resolveA({ response: 'reply-A' });
    resolveB({ response: 'reply-B' });
    // Let both settle.
    await Promise.resolve();
    await Promise.resolve();

    expect(a.getSnapshot().messages.map(m => m.content)).toEqual(['A', 'reply-A']);
    expect(b.getSnapshot().messages.map(m => m.content)).toEqual(['B', 'reply-B']);
  });

  it('queues a second send on the same conversation instead of interleaving', async () => {
    const runner = makeRunner();
    let resolveFirst!: (r: TurnRunnerResult) => void;
    runner.setBehavior(() => new Promise(res => { resolveFirst = res; }));

    const rt = new ConversationRuntime(makeDeps(keyA, runner));
    await rt.open();

    expect(rt.send({ message: 'first' })).toBe(true);
    expect(rt.send({ message: 'second' })).toBe(true);
    expect(runner.calls.length).toBe(1);

    resolveFirst({ response: 'one' });
    await Promise.resolve();
    await Promise.resolve();

    // The queued turn starts after the first settles.
    expect(runner.calls.length).toBe(2);
    expect(runner.calls.map(c => c.message)).toEqual(['first', 'second']);
  });

  it('aborts one conversation without touching another', async () => {
    const runnerA = makeRunner();
    const runnerB = makeRunner();
    let resolveB!: (r: TurnRunnerResult) => void;
    runnerA.setBehavior((_m, signal) => new Promise((_res, rej) => {
      signal.addEventListener('abort', () => rej(new Error('Aborted')));
    }));
    runnerB.setBehavior(() => new Promise(res => { resolveB = res; }));

    const a = new ConversationRuntime(makeDeps(keyA, runnerA));
    const b = new ConversationRuntime(makeDeps(keyB, runnerB));
    await a.open();
    await b.open();

    a.send({ message: 'A' });
    b.send({ message: 'B' });

    expect(a.abort()).toBe(true);
    expect(b.getSnapshot().status).toBe('running');

    resolveB({ response: 'reply-B' });
    await Promise.resolve();
    await Promise.resolve();

    expect(b.getSnapshot().messages.map(m => m.content)).toEqual(['B', 'reply-B']);
  });

  it('isolates clarification between conversations', async () => {
    const runner = makeRunner();
    let answer!: (v: string) => void;
    runner.setBehavior(async () => {
      // Runner drives a clarification then returns the answer as the response.
      const a = await new Promise<string>(resolve => { answer = resolve; });
      return { response: a };
    });

    const rt = new ConversationRuntime(makeDeps(keyA, runner));
    await rt.open();

    rt.send({ message: 'ask' });
    await Promise.resolve();

    // The runtime folds a clarification request into its snapshot.
    const request = { id: 'clar-1', question: 'confirm?' };
    // Simulate the runner emitting a clarification before awaiting.
    await Promise.resolve();
    expect(rt.getSnapshot().clarification).toBeNull();

    rt.answerClarification('clar-1', 'yes');
    expect(rt.answerClarification('clar-1', 'yes')).toBe(false);
  });

  it('persists the full message list after a settled turn', async () => {
    const runner = makeRunner();
    const deps = makeDeps(keyA, runner) as ReturnType<typeof makeDeps> & {
      stored: AgentChatMessage[]; persisted: AgentChatMessage[][];
    };
    const rt = new ConversationRuntime(deps);
    await rt.open();

    rt.send({ message: 'hello' });
    await Promise.resolve();
    await Promise.resolve();

    expect(deps.stored.map(m => m.content)).toEqual(['hello', 'echo:hello']);
  });

  it('persists turn context, attachments, tool results, and assistant metadata', async () => {
    const deps = makeDeps(keyA, makeRunner());
    deps.runTurn = async (ctx) => {
      ctx.onToolCall?.({ name: 'canvas_read_node', args: { id: 'n1' }, toolCallId: 'tool-1' });
      ctx.onToolResult?.({
        name: 'canvas_read_node',
        result: 'node content',
        toolCallId: 'tool-1',
        status: 'succeeded',
      });
      return {
        response: 'done',
        runId: 'run-1',
        speakerRole: { id: 'reviewer', name: 'Reviewer', color: '#123456' },
      };
    };
    const rt = new ConversationRuntime(deps);
    await rt.open();
    const attachment = { id: 'image-1', path: '/tmp/image.png' };
    const contextSnapshot = {
      scope: workspace,
      scopeLabel: 'Workspace A',
      executionMode: 'ask' as const,
      modelLabel: 'Test Model',
      capturedAt: 1,
    };

    await rt.sendAndWait({
      message: 'inspect this',
      attachments: [attachment],
      requestContext: { contextSnapshot },
    });

    expect(deps.stored[0]).toMatchObject({ attachments: [attachment], contextSnapshot });
    expect(deps.stored[1]).toMatchObject({
      runId: 'run-1',
      speakerRoleId: 'reviewer',
      speakerRoleName: 'Reviewer',
      speakerRoleColor: '#123456',
      toolCalls: [{
        name: 'canvas_read_node',
        toolCallId: 'tool-1',
        status: 'succeeded',
        result: 'node content',
      }],
    });
  });
});

describe('ConversationRuntimeRegistry', () => {
  it('opens once per key and reuses the same runtime', async () => {
    const runner = makeRunner();
    const registry = new ConversationRuntimeRegistry({
      create: (key) => makeDeps(key, runner) as ConversationRuntimeDeps,
    });

    const first = await registry.open(keyA);
    const second = await registry.open(keyA);
    expect(first).toBe(second);
    expect(registry.size).toBe(1);

    const other = await registry.open(keyB);
    expect(other).not.toBe(first);
    expect(registry.size).toBe(2);
  });

  it('disposes a single key without clearing others', async () => {
    const runner = makeRunner();
    const registry = new ConversationRuntimeRegistry({
      create: (key) => makeDeps(key, runner) as ConversationRuntimeDeps,
    });

    const a = await registry.open(keyA);
    const b = await registry.open(keyB);
    await registry.dispose(keyA);

    expect(registry.get(keyA)).toBeUndefined();
    expect(registry.get(keyB)).toBe(b);
    expect(registry.size).toBe(1);
    expect(a.getSnapshot().messages).toEqual([]);
  });

  it('reports only conversation ids whose runtimes are running', async () => {
    const runner = makeRunner();
    let finish!: (result: TurnRunnerResult) => void;
    runner.setBehavior(() => new Promise(resolve => { finish = resolve; }));
    const registry = new ConversationRuntimeRegistry({
      create: (key) => makeDeps(key, runner) as ConversationRuntimeDeps,
    });
    const a = await registry.open(keyA);
    await registry.open(keyB);

    a.send({ message: 'running' });
    expect((registry as unknown as { runningSessionIds(): string[] }).runningSessionIds())
      .toEqual(['session-a']);

    finish({ response: 'done' });
    await vi.waitFor(() => {
      expect((registry as unknown as { runningSessionIds(): string[] }).runningSessionIds())
        .toEqual([]);
    });
  });
});
