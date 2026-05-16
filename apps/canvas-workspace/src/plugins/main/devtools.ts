import {
  isCanvasAgentDebugTraceEnabled,
} from '../../main/canvas-agent/debug-trace';
import type {
  CanvasAgentDebugRunDetail,
  CanvasAgentDebugRunSummary,
  CanvasAgentDebugTrace,
} from '../../main/canvas-agent/types';
import type { MainCanvasPlugin } from '../types';

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

const runKey = (sessionId: string, runId: string) => `runs/${sessionId}/${runId}`;

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
export const DevtoolsMainPlugin: MainCanvasPlugin = {
  id: 'devtools',
  enabledWhen: isCanvasAgentDebugTraceEnabled,
  activate(ctx) {
    ctx.onAgent('turnEnd', (turn) => {
      const payload = turn.data as TurnTracePayload | undefined;
      if (!payload?.trace) return;
      const stored = buildStoredRun(payload);
      void ctx.store
        .set(runKey(turn.sessionId, turn.runId), stored)
        .catch((err) => {
          console.error('[devtools] failed to persist trace', err);
        });
    });

    ctx.handle('list-runs', async () => {
      const keys = await ctx.store.list('runs/');
      const records = await Promise.all(
        keys.map((key) => ctx.store.get<StoredRun>(key)),
      );
      return records
        .filter((r): r is StoredRun => Boolean(r))
        .map((r) => r.summary)
        .sort((a, b) => b.startedAt - a.startedAt);
    });

    ctx.handle('get-run', async (_event, sessionId, runId) => {
      if (typeof sessionId !== 'string' || typeof runId !== 'string') {
        throw new Error('devtools.get-run: sessionId and runId must be strings');
      }
      const stored = await ctx.store.get<StoredRun>(runKey(sessionId, runId));
      if (!stored) throw new Error(`devtools.get-run: ${sessionId}/${runId} not found`);
      return stored.detail;
    });
  },
};
