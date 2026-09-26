import type {
  CanvasAgentDebugRunDetail,
  CanvasAgentDebugRunSummary,
  CanvasAgentDebugTrace,
} from '../../main/agent/types';
import type { MainCanvasPlugin } from '../types';
import { LocalAgentTraceSink } from './local-agent-trace-sink';

interface StoredRun {
  summary: CanvasAgentDebugRunSummary;
  detail: CanvasAgentDebugRunDetail;
}

interface TurnTracePayload {
  trace: CanvasAgentDebugTrace;
  assistantPreview: string;
  workspaceId: string;
  workspaceName: string;
}

const runKey = (runId: string) => `runs/${runId}`;

function buildStoredRun(payload: TurnTracePayload): StoredRun {
  const { trace, assistantPreview, workspaceId, workspaceName } = payload;
  const modelLabel =
    [trace.model?.provider, trace.model?.model].filter(Boolean).join(' / ') || undefined;
  const summary: CanvasAgentDebugRunSummary = {
    workspaceId,
    workspaceName,
    sessionId: trace.sessionId,
    runId: trace.runId,
    turnId: trace.turnId,
    // The plugin store does not track message ordering, so this field is
    // a fixed placeholder. The UI does not display it; it remains in the
    // type for compatibility with the original (session-store-backed)
    // shape.
    messageIndex: 0,
    startedAt: trace.startedAt,
    durationMs: trace.durationMs,
    userPromptPreview: trace.request.userPromptPreview,
    assistantPreview,
    toolCount: trace.toolCalls.length,
    readNodeCount: trace.readNodes.length,
    modelLabel,
    runtimeId: trace.runtime?.id,
    // Per-run "is current session" was meaningful when runs were derived
    // by walking session files. Plugin-stored runs have no such notion.
    isCurrent: false,
  };
  // userMessage/assistantMessage stay undefined — the renderer reads the
  // previews off summary, and the full message objects are not needed.
  const detail: CanvasAgentDebugRunDetail = { ...summary, trace };
  return { summary, detail };
}

// Main half of the Canvas Agent DevTools plugin. Subscribes to the
// agent bus to capture finalized traces into the plugin's own store,
// and serves the renderer half via IPC. The plugin no longer reaches
// into session-store; canvas-agent and this plugin only share the
// event bus contract.
//
// Always activates — `setupCanvasPlugins` only runs once at main-process
// startup, but the trace flag (`canvas-agent-debug-trace`) can be flipped
// later from Settings → Experimental + window reload, with no full app
// restart. If we gated activation on the flag's startup value we'd never
// register the `turnEnd` listener or `list-runs`/`get-run` IPC handlers
// for users who turned it on after launching. The built-in plugin loader keeps
// this entire plugin development-only and behind the observability master switch.
export const DevtoolsMainPlugin: MainCanvasPlugin = {
  id: 'devtools',
  activate(ctx) {
    const traceSink = new LocalAgentTraceSink();
    let writes: Promise<void> = Promise.resolve();
    const serialize = <T,>(operation: () => Promise<T>): Promise<T> => {
      const next = writes.then(operation);
      writes = next.then(() => undefined, error => console.error('[devtools] trace persistence failed', error));
      return next;
    };
    ctx.registerAgentObservabilitySubscriber({
      id: traceSink.id,
      async onEvent(event) {
        traceSink.onEvent(event);
        if (event.type !== 'run.completed' && event.type !== 'milestone') return;
        await serialize(async () => {
          let stored = await ctx.store.get<StoredRun>(runKey(event.runId));
          const events = traceSink.snapshot(event.runId);
          const start = events.find(item => item.type === 'run.started');
          if (!stored && start?.type === 'run.started' && event.type === 'run.completed') {
            stored = buildStoredRun({
              workspaceId: '', workspaceName: start.scope, assistantPreview: '',
              trace: {
                runId: event.runId, turnId: event.runId, sessionId: start.sessionId ?? '',
                createdAt: start.timestamp, startedAt: start.timestamp, finishedAt: event.timestamp,
                durationMs: event.timestamp - start.timestamp,
                request: { userPromptPreview: '', attachmentCount: 0, selectedNodes: [], mentionedCanvases: [] },
                prompt: { systemPromptPreview: '', systemPromptChars: 0 },
                toolCalls: [], readNodes: [], contextReads: [],
              },
            });
          }
          if (!stored) return;
          stored.detail.trace.observabilityEvents = events;
          const completed = events.find(item => item.type === 'run.completed');
          if (completed) {
            const submitted = events.find(item => item.type === 'milestone' && item.milestone === 'ui.request-dispatched');
            const durationMs = Math.max(0, completed.timestamp - (submitted?.timestamp ?? start?.timestamp ?? stored.summary.startedAt));
            stored.summary.durationMs = durationMs;
            stored.detail.durationMs = durationMs;
            stored.detail.trace.durationMs = durationMs;
            stored.detail.trace.finishedAt = completed.timestamp;
          }
          await ctx.store.set(runKey(event.runId), stored);
        });
      },
    });
    ctx.onAgent('turnEnd', async (turn) => {
      const payload = turn.data as TurnTracePayload | undefined;
      if (!payload?.trace) return;
      payload.trace.observabilityEvents = traceSink.snapshot(payload.trace.runId);
      const stored = buildStoredRun(payload);
      try {
        await serialize(() => ctx.store.set(runKey(turn.runId), stored));
      } catch (err) {
        console.error('[devtools] failed to persist trace', err);
      }
    });

    ctx.handle('list-runs', () => serialize(async () => {
      const keys = await ctx.store.list('runs/');
      const records = await Promise.all(
        keys.map((key) => ctx.store.get<StoredRun>(key)),
      );
      return records
        .filter((r): r is StoredRun => Boolean(r))
        .map((r) => r.summary)
        .sort((a, b) => b.startedAt - a.startedAt);
    }));

    ctx.handle('get-run', (_event, runId) => serialize(async () => {
      if (typeof runId !== 'string') {
        throw new Error('devtools.get-run: runId must be a string');
      }
      const stored = await ctx.store.get<StoredRun>(runKey(runId));
      if (!stored) throw new Error(`devtools.get-run: ${runId} not found`);
      const latestEvents = traceSink.snapshot(runId);
      if (latestEvents.length > 0) stored.detail.trace.observabilityEvents = latestEvents;
      return stored.detail;
    }));
  },
};
