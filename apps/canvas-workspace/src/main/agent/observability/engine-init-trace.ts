import { recordScopeActivationStep, traceScopeActivationStep } from './host-run';

interface TimingEventSource {
  on(event: string, listener: (payload: unknown) => void): unknown;
  off(event: string, listener: (payload: unknown) => void): unknown;
}

interface InitializableEngine {
  initialize(): Promise<void>;
  events?: TimingEventSource;
}

interface PluginInitTiming {
  pluginName: string;
  startedAt: number;
  durationMs: number;
  ok: boolean;
}

interface McpServerTiming {
  serverName: string;
  startedAt: number;
  durationMs: number;
  ok: boolean;
  connectMs?: number;
  listToolsMs?: number;
}

const isTiming = (value: unknown): value is { startedAt: number; durationMs: number } => (
  !!value
  && typeof (value as { startedAt?: unknown }).startedAt === 'number'
  && typeof (value as { durationMs?: unknown }).durationMs === 'number'
);

const mcpDetail = (timing: McpServerTiming): string => {
  const stages = [
    timing.connectMs === undefined ? undefined : `connect ${timing.connectMs}ms`,
    timing.listToolsMs === undefined ? undefined : `tools ${timing.listToolsMs}ms`,
  ].filter(Boolean);
  const status = timing.ok ? '' : ' (failed)';
  return `${timing.serverName}${status}${stages.length ? ` · ${stages.join(' · ')}` : ''}`;
};

/**
 * Initialize the Engine as the `engine-init` scope step, with one nested step
 * per engine plugin and per MCP server from the Engine's timing events.
 */
export async function traceEngineInitialize(engine: InitializableEngine): Promise<void> {
  const events = engine.events;
  const onPlugin = (payload: unknown) => {
    if (!isTiming(payload)) return;
    const timing = payload as PluginInitTiming;
    recordScopeActivationStep({
      step: 'canvas.scope.engine-plugin-init',
      startedAt: timing.startedAt,
      finishedAt: timing.startedAt + timing.durationMs,
      detail: timing.ok ? timing.pluginName : `${timing.pluginName} (failed)`,
    });
  };
  const onMcpServer = (payload: unknown) => {
    if (!isTiming(payload)) return;
    const timing = payload as McpServerTiming;
    recordScopeActivationStep({
      step: 'canvas.scope.mcp-server',
      startedAt: timing.startedAt,
      finishedAt: timing.startedAt + timing.durationMs,
      detail: mcpDetail(timing),
    });
  };
  events?.on('pluginInitTiming', onPlugin);
  events?.on('mcpServerTiming', onMcpServer);
  try {
    await traceScopeActivationStep('canvas.scope.engine-init', () => engine.initialize());
  } finally {
    events?.off('pluginInitTiming', onPlugin);
    events?.off('mcpServerTiming', onMcpServer);
  }
}
