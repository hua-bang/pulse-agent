import { describe, expect, it, vi } from 'vitest';
import { LangfuseAgentTraceSubscriber } from './langfuse-agent-trace-subscriber';
import type {
  LangfuseObservationHandle,
  LangfuseTraceAdapter,
} from './langfuse-agent-trace-subscriber';

const makeHandle = (): LangfuseObservationHandle => ({
  end: vi.fn(),
  setAttributes: vi.fn(),
  spanContext: () => ({ traceId: '1'.repeat(32), spanId: '2'.repeat(16), traceFlags: 1 }),
  update: vi.fn(),
});

const setup = () => {
  const root = makeHandle();
  const children: Array<{ kind: string; name: string; handle: LangfuseObservationHandle }> = [];
  const adapter: LangfuseTraceAdapter = {
    createRoot: vi.fn(async () => root),
    start: vi.fn((_parent, name, kind) => {
      const handle = makeHandle();
      children.push({ kind, name, handle });
      return handle;
    }),
    shutdown: vi.fn(async () => undefined),
  };
  return { adapter, children, root, subscriber: new LangfuseAgentTraceSubscriber(adapter) };
};

describe('LangfuseAgentTraceSubscriber', () => {
  it('maps one run into Canvas root, runtime, generation, tool and milestone observations', async () => {
    const { children, root, subscriber } = setup();
    await subscriber.onEvent({
      type: 'run.started', runId: 'run-1', timestamp: 100, sessionId: 'session-1', scope: 'workspace', host: 'canvas',
    });
    await subscriber.onEvent({ type: 'runtime.resolved', runId: 'run-1', timestamp: 120, runtimeId: 'pi', owner: 'pi' });
    await subscriber.onEvent({ type: 'generation.started', runId: 'run-1', timestamp: 130, generationId: 'gen-1', owner: 'pi', model: 'model' });
    await subscriber.onEvent({ type: 'milestone', runId: 'run-1', timestamp: 150, milestone: 'runtime.first-text', owner: 'pi' });
    await subscriber.onEvent({ type: 'tool.started', runId: 'run-1', timestamp: 160, toolCallId: 'tool-1', toolName: 'read', owner: 'pi' });
    await subscriber.onEvent({ type: 'tool.completed', runId: 'run-1', timestamp: 170, toolCallId: 'tool-1', toolName: 'read', owner: 'pi', status: 'done' });
    await subscriber.onEvent({ type: 'generation.completed', runId: 'run-1', timestamp: 180, generationId: 'gen-1', owner: 'pi', finishReason: 'stop' });
    await subscriber.onEvent({ type: 'run.completed', runId: 'run-1', timestamp: 200, status: 'success' });

    expect(children.map(({ kind, name }) => `${kind}:${name}`)).toEqual([
      'agent:runtime.pi', 'generation:pi.generation', 'event:runtime.first-text', 'tool:read',
    ]);
    expect(children[1].handle.update).toHaveBeenCalledWith({ completionStartTime: new Date(150) });
    expect(children[1].handle.end).toHaveBeenCalledWith(new Date(180));
    expect(root.setAttributes).toHaveBeenCalledWith(expect.objectContaining({ 'session.id': 'session-1' }));
    expect(root.end).toHaveBeenCalledWith(new Date(200));
  });

  it('records phase timestamps and closes unfinished observations during shutdown', async () => {
    const { adapter, children, root, subscriber } = setup();
    await subscriber.onEvent({ type: 'run.started', runId: 'run-2', timestamp: 100, scope: 'global', host: 'canvas' });
    await subscriber.onEvent({
      type: 'phase.completed', runId: 'run-2', timestamp: 130, phase: 'canvas.queue', owner: 'canvas-host', startedAt: 105, finishedAt: 125,
    });
    await subscriber.onEvent({ type: 'tool.started', runId: 'run-2', timestamp: 140, toolCallId: 'tool-2', toolName: 'grep', owner: 'engine' });
    await subscriber.shutdown();

    expect(children[0].handle.end).toHaveBeenCalledWith(new Date(125));
    expect(children[1].handle.update).toHaveBeenCalledWith(expect.objectContaining({ level: 'ERROR' }));
    expect(root.end).toHaveBeenCalledOnce();
    expect(adapter.shutdown).toHaveBeenCalledOnce();
  });
});
