import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  publish: vi.fn(),
  initialize: vi.fn(async (): Promise<void> => undefined),
}));
vi.mock('../../plugins/main', () => ({ publishAgentTraceEvent: state.publish }));
vi.mock('./sqlite-session-backend', async importOriginal => ({
  ...await importOriginal<typeof import('./sqlite-session-backend')>(),
  getSqliteSessionStorage: async () => ({ workspaces: { getTrashed: async () => null } }),
}));
vi.mock('./canvas-agent', () => ({
  CanvasAgent: vi.fn().mockImplementation(() => ({ initialize: state.initialize, destroy: vi.fn() })),
}));

import type { CanvasAgent } from './canvas-agent';
import { traceCanvasScopeActivation, traceScopeActivationStep } from './observability/host-run';
import type { CanvasAgentPerformanceTiming } from './debug-trace';
import { ScopeActivationGate } from './scope-activation-gate';
import { activateAgentScope } from './scope-agent-activation';

const timing = (runId: string): CanvasAgentPerformanceTiming => ({
  runId, requestStartedAt: 0, laneEnteredAt: 0, scopeReadyAt: 0, contextReadyAt: 0,
});
const stepsFor = (runId: string): string[] => state.publish.mock.calls
  .map(([event]) => event)
  .filter(event => event.runId === runId)
  .map(event => event.phase);

describe('scope activation step tracing', () => {
  beforeEach(() => {
    state.publish.mockReset();
    state.initialize.mockReset().mockResolvedValue(undefined);
  });

  it('separates owned initialization from joining an in-flight warm-up', async () => {
    let finishInit!: () => void;
    state.initialize.mockImplementation(() => traceScopeActivationStep(
      'canvas.scope.engine-init',
      () => new Promise<void>(done => { finishInit = done; }),
    ));
    const agents = new Map<string, CanvasAgent>();
    const gate = new ScopeActivationGate();
    const scope = { kind: 'workspace', workspaceId: 'ws' } as const;

    const warmup = traceCanvasScopeActivation(timing('warmup'), () => activateAgentScope(scope, agents, gate));
    await vi.waitFor(() => expect(state.initialize).toHaveBeenCalled());
    const chat = traceCanvasScopeActivation(timing('chat'), () => activateAgentScope(scope, agents, gate));
    await Promise.resolve();
    finishInit();
    await Promise.all([warmup, chat]);

    expect(stepsFor('warmup')).toContain('canvas.scope.agent-init');
    expect(stepsFor('chat')).toContain('canvas.scope.agent-init-wait');
    expect(stepsFor('chat')).not.toContain('canvas.scope.agent-init');
    expect(stepsFor('chat')).toContain('canvas.scope.availability-check');
    // The run that only waited still sees what the shared init spent its time on.
    expect(stepsFor('chat')).toContain('canvas.scope.engine-init');
    expect(stepsFor('warmup')).toContain('canvas.scope.engine-init');
  });

  it('reports a warm-up without its own trace through the run that waits on it', async () => {
    let finishInit!: () => void;
    state.initialize.mockImplementation(() => traceScopeActivationStep(
      'canvas.scope.engine-init',
      () => new Promise<void>(done => { finishInit = done; }),
    ));
    const agents = new Map<string, CanvasAgent>();
    const gate = new ScopeActivationGate();
    const scope = { kind: 'workspace', workspaceId: 'ws-2' } as const;

    const untracedWarmup = activateAgentScope(scope, agents, gate);
    await vi.waitFor(() => expect(state.initialize).toHaveBeenCalled());
    const chat = traceCanvasScopeActivation(timing('chat-2'), () => activateAgentScope(scope, agents, gate));
    await Promise.resolve();
    finishInit();
    await Promise.all([untracedWarmup, chat]);

    expect(stepsFor('chat-2')).toEqual(expect.arrayContaining([
      'canvas.scope.agent-init-wait',
      'canvas.scope.engine-init',
    ]));
  });

  it('does not time availability checks for scopes without durable trash state', async () => {
    const agents = new Map<string, CanvasAgent>();
    await traceCanvasScopeActivation(timing('global'), () => (
      activateAgentScope({ kind: 'global' }, agents, new ScopeActivationGate())
    ));
    expect(stepsFor('global')).toEqual(['canvas.scope.agent-init']);
  });
});
