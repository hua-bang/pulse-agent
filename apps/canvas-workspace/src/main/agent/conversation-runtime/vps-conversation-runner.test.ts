import { describe, expect, it, vi } from 'vitest';
import type { AgentChatMessage } from '../../../shared/agent-chat';
import { conversationKey } from '../../../shared/conversation-runtime';
import { ConversationRuntime } from './conversation-runtime';
import { attachRemoteRun, createVpsConversationRunner, type VpsRunnerDeps } from './vps-conversation-runner';

const frame = (id: number, event: string, data: unknown) => `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

function sse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const pending = [...chunks];
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = pending.shift();
      if (next !== undefined) controller.enqueue(encoder.encode(next));
      else controller.close();
    },
  }), { status: 200 });
}

const target = {
  workspaceId: 'ws-local',
  remoteWorkspaceId: 'ws-remote',
  endpoint: 'http://vps',
  token: 'tok',
};

function deps(fetchImpl: typeof fetch): VpsRunnerDeps {
  return { resolveTarget: async () => target, clientId: 'c_self', senderName: () => 'Jasper', fetchImpl };
}

const key = conversationKey({ kind: 'workspace', workspaceId: 'ws-local' }, 'sess-1');
const user = (content: string): AgentChatMessage => ({ role: 'user', content, timestamp: 0 });

describe('VPS conversation runner', () => {
  it('runs the turn on the daemon and leaves persistence to it', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return sse([
        frame(1, 'started', {}),
        frame(2, 'tool_call', { toolCallId: 't1', name: 'bash', args: { command: 'ls' } }),
        frame(3, 'tool_result', { toolCallId: 't1', name: 'bash', status: 'succeeded', result: 'a.txt' }),
        frame(4, 'text_delta', { delta: 'done' }),
        frame(5, 'complete', { ok: true, runId: 'x', response: 'done' }),
      ]);
    }) as unknown as typeof fetch;
    const persist = vi.fn(async () => undefined);
    const runtime = new ConversationRuntime({
      key,
      loadMessages: async () => [],
      persist,
      persistence: 'runner',
      checkpointMs: 0,
      resolveSenderName: () => 'Jasper',
      runTurn: createVpsConversationRunner(deps(fetchImpl)),
    });
    await runtime.open();
    const result = await runtime.sendAndWait({ message: 'list files' });

    expect(result.response).toBe('done');
    expect(bodies[0]).toMatchObject({
      workspaceId: 'ws-remote',
      sessionId: 'sess-1',
      message: 'list files',
      senderName: 'Jasper',
      clientId: 'c_self',
    });
    expect(persist).not.toHaveBeenCalled();
    const messages = runtime.getSnapshot().messages;
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(messages[1].toolCalls?.[0]).toMatchObject({ name: 'bash', status: 'succeeded', result: 'a.txt' });
  });

  it('commits only the recovery cut before an edited turn', async () => {
    const fetchImpl = vi.fn(async () => sse([frame(1, 'complete', { ok: true, response: 'again' })])) as unknown as typeof fetch;
    const persist = vi.fn(async () => undefined);
    const runtime = new ConversationRuntime({
      key,
      loadMessages: async () => [user('first'), { role: 'assistant', content: 'one', timestamp: 0 }],
      persist,
      persistence: 'runner',
      checkpointMs: 0,
      runTurn: createVpsConversationRunner(deps(fetchImpl)),
    });
    await runtime.open();
    await runtime.sendAndWait({ message: 'first, edited', truncateAt: 0 });
    // History before the edited message; the daemon appends the new user turn.
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith([]);
  });

  it('asks the daemon to stop the run and reports the stopped reply', async () => {
    const urls: string[] = [];
    let release!: () => void;
    const fetchImpl = vi.fn(async (url: string) => {
      urls.push(url);
      if (url.endsWith('/v1/agent/abort')) {
        release();
        return new Response(JSON.stringify({ ok: true, aborted: true }));
      }
      const encoder = new TextEncoder();
      let sent = false;
      return new Response(new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (!sent) {
            sent = true;
            controller.enqueue(encoder.encode(frame(1, 'text_delta', { delta: 'par' })));
            return;
          }
          await new Promise<void>((resolve) => { release = resolve; });
          controller.enqueue(encoder.encode(frame(2, 'complete', { ok: true, stopped: true, response: 'par' })));
          controller.close();
        },
      }));
    }) as unknown as typeof fetch;
    const runtime = new ConversationRuntime({
      key,
      loadMessages: async () => [],
      persist: async () => undefined,
      persistence: 'runner',
      checkpointMs: 0,
      runTurn: createVpsConversationRunner(deps(fetchImpl)),
    });
    await runtime.open();
    const turn = runtime.sendAndWait({ message: 'long task' });
    await vi.waitFor(() => expect(runtime.getSnapshot().draft?.content).toBe('par'));
    expect(runtime.abort()).toBe(true);
    const result = await turn;
    expect(result.stopped).toBe(true);
    expect(urls.some((url) => url.endsWith('/v1/agent/abort'))).toBe(true);
    expect(runtime.getSnapshot().messages.at(-1)).toMatchObject({ role: 'assistant', content: 'par', turnStatus: 'stopped' });
  });

  it('attaches to a run another member started, from the snapshot onward', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.startsWith('http://vps/v1/agent/runs?')) {
        return new Response(JSON.stringify({
          ok: true,
          active: {
            runId: 'peer-run',
            seq: 7,
            prompt: 'peer question',
            senderName: 'Mac',
            clientId: 'admin:other',
            status: 'running',
            text: 'Partial ',
            tools: [{ toolCallId: 't1', name: 'grep', status: 'running' }],
          },
        }));
      }
      expect(url).toBe('http://vps/v1/agent/runs/peer-run/events?after=7');
      return sse([
        frame(8, 'tool_result', { toolCallId: 't1', name: 'grep', status: 'succeeded', result: 'hit' }),
        frame(9, 'text_delta', { delta: 'answer' }),
        frame(10, 'complete', { ok: true, runId: 'peer-run', response: 'Partial answer' }),
      ]);
    }) as unknown as typeof fetch;
    const text: string[] = [];
    const results: string[] = [];
    const attached = await attachRemoteRun(
      deps(fetchImpl),
      key,
      async () => [user('peer question')],
      { onText: (delta) => text.push(delta), onToolResult: (r) => results.push(r.toolCallId) },
    );
    expect(attached?.snapshot).toMatchObject({
      status: 'running',
      runId: 'peer-run',
      draft: { role: 'assistant', content: 'Partial ' },
      streamingTools: [{ toolCallId: 't1', name: 'grep', status: 'running' }],
    });
    // The prompt is already persisted, so it is not duplicated.
    expect(attached?.snapshot.messages).toHaveLength(1);
    const done = await attached!.done;
    expect(done.response).toBe('Partial answer');
    expect(text).toEqual(['answer']);
    expect(results).toEqual(['t1']);
  });
});
