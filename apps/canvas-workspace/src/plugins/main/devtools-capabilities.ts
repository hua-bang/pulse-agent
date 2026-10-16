import { z } from 'zod';
import type { CanvasAgentDebugRunDetail, CanvasAgentDebugRunSummary } from '../../main/agent/types';
import { CapabilityError, type AnyCapabilityDefinition } from '../../main/runtime/capabilities/types';
import { getRuntimeWindowPort } from '../../main/runtime/window-port';

interface DevtoolsQueries {
  listRuns(): Promise<CanvasAgentDebugRunSummary[]>;
  getRun(runId: string): Promise<CanvasAgentDebugRunDetail | undefined>;
}

const id = z.string().trim().min(1).max(256).regex(/^[a-zA-Z0-9_-]+$/);
const selector = z.union([
  z.object({ runId: id, sessionId: z.never().optional() }).strict(),
  z.object({ sessionId: id, runId: z.never().optional() }).strict(),
]);
type Selector = z.infer<typeof selector>;

export function createDevtoolsCapabilities(queries: DevtoolsQueries): AnyCapabilityDefinition[] {
  const query = async (input: Selector, workspaceId: string) => {
    if (input.runId) {
      const run = await queries.getRun(input.runId);
      if (!run || run.workspaceId !== workspaceId) {
        throw new CapabilityError('run_not_found', `No recorded run ${input.runId} in workspace ${workspaceId}.`);
      }
      return { runs: [run] };
    }
    const summaries = (await queries.listRuns()).filter(run => (
      run.sessionId === input.sessionId && run.workspaceId === workspaceId
    ));
    const runs = await Promise.all(summaries.map(run => queries.getRun(run.runId)));
    return { runs: runs.filter((run): run is CanvasAgentDebugRunDetail => Boolean(run)) };
  };
  return [
    {
      name: 'devtools.logs.query',
      description: 'Read recorded DevTools traces by runId or sessionId in the selected workspace.',
      risk: 'read',
      inputSchema: selector,
      execute: (input, context) => query(input, context.workspaceId),
    },
    {
      name: 'devtools.logs.open',
      description: 'Open the existing DevTools UI at a recorded run or session in the selected workspace.',
      risk: 'operate',
      inputSchema: selector,
      execute: async (input, context) => {
        const { runs } = await query(input, context.workspaceId);
        if (!runs.length) {
          throw new CapabilityError('session_not_found', `No recorded runs for session ${input.sessionId}.`);
        }
        if (context.abortSignal?.aborted) throw new CapabilityError('aborted', 'Capability call was aborted');
        const window = getRuntimeWindowPort().getCanvasWindow();
        if (!window || window.isDestroyed()) {
          throw new CapabilityError('window_unavailable', 'No Canvas window is open.');
        }
        const params = new URLSearchParams({ workspaceId: context.workspaceId });
        if (input.runId) params.set('runId', input.runId);
        else params.set('sessionId', input.sessionId!);
        const route = `/debug?${params.toString()}`;
        await window.webContents.executeJavaScript(`window.location.hash = ${JSON.stringify(route)}; void 0;`);
        window.show();
        window.focus();
        return { opened: true, route };
      },
    },
  ];
}
