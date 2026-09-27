import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { publish } = vi.hoisted(() => ({ publish: vi.fn() }));
vi.mock('../../../plugins/main', () => ({ publishAgentTraceEvent: publish }));

import type { CanvasAgentPerformanceTiming } from '../debug-trace';
import { traceEngineInitialize } from './engine-init-trace';
import { traceCanvasScopeActivation } from './host-run';

const timing: CanvasAgentPerformanceTiming = {
  runId: 'run-1', requestStartedAt: 0, laneEnteredAt: 0, scopeReadyAt: 0, contextReadyAt: 0,
};

describe('Engine initialization trace', () => {
  beforeEach(() => publish.mockReset());

  it('records engine init with one nested step per plugin and MCP server', async () => {
    const events = new EventEmitter();
    const engine = {
      events,
      initialize: async () => {
        events.emit('mcpServerTiming', {
          serverName: 'exa', startedAt: 100, durationMs: 1_500, ok: true, connectMs: 1_200, listToolsMs: 300,
        });
        events.emit('mcpServerTiming', { serverName: 'slow', startedAt: 1_600, durationMs: 4_000, ok: false });
        events.emit('pluginInitTiming', {
          pluginName: 'pulse-coder-engine/built-in-mcp', startedAt: 90, durationMs: 5_600, ok: true,
        });
      },
    };

    await traceCanvasScopeActivation(timing, () => traceEngineInitialize(engine));

    expect(publish.mock.calls.map(([event]) => [event.phase, event.detail, event.finishedAt - event.startedAt]))
      .toEqual([
        ['canvas.scope.mcp-server', 'exa · connect 1200ms · tools 300ms', 1_500],
        ['canvas.scope.mcp-server', 'slow (failed)', 4_000],
        ['canvas.scope.engine-plugin-init', 'pulse-coder-engine/built-in-mcp', 5_600],
        ['canvas.scope.engine-init', undefined, expect.any(Number)],
      ]);
    expect(events.listenerCount('mcpServerTiming')).toBe(0);
    expect(events.listenerCount('pluginInitTiming')).toBe(0);
  });

  it('still initializes an engine without an event bus', async () => {
    const initialize = vi.fn(async () => undefined);
    await traceCanvasScopeActivation(timing, () => traceEngineInitialize({ initialize }));
    expect(initialize).toHaveBeenCalledOnce();
    expect(publish.mock.calls.map(([event]) => event.phase)).toEqual(['canvas.scope.engine-init']);
  });
});
