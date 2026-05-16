import {
  isCanvasAgentDebugTraceEnabled,
} from '../../main/canvas-agent/debug-trace';
import { SessionStore } from '../../main/canvas-agent/session-store';
import type { MainCanvasPlugin } from '../types';

// Main half of the Canvas Agent DevTools plugin. Owns the IPC for
// reading captured debug runs; the trace data itself is still built and
// persisted by canvas-agent via session-store, since the trace is woven
// into the per-turn engine callbacks. This plugin only owns the
// read-side surface (list/detail) plus the renderer entrypoints.
export const DevtoolsMainPlugin: MainCanvasPlugin = {
  id: 'devtools',
  enabledWhen: isCanvasAgentDebugTraceEnabled,
  activate(ctx) {
    ctx.handle('list-runs', async () => {
      return SessionStore.listDebugRuns();
    });
    ctx.handle('get-run', async (_event, sessionId, runId) => {
      if (typeof sessionId !== 'string' || typeof runId !== 'string') {
        throw new Error('devtools.get-run: sessionId and runId must be strings');
      }
      const run = await SessionStore.readDebugRun(sessionId, runId);
      if (!run) throw new Error(`devtools.get-run: ${sessionId}/${runId} not found`);
      return run;
    });
  },
};
