/**
 * Main-process bridge between PTY sessions and the agent-teams service.
 *
 * Team agent output used to round-trip through the renderer: PTY (main) →
 * xterm controller (renderer) → reportAgentOutput IPC → main. Marker parsing
 * and exit detection therefore stopped whenever the window was closed or the
 * agent node was unmounted, stalling the whole team state machine.
 *
 * Team agent nodes spawn their PTY with PULSE_CANVAS_TEAM_ID /
 * PULSE_CANVAS_NODE_ID / PULSE_CANVAS_WORKSPACE_ID in the session env, so the
 * bridge can identify them at spawn time and feed their output and exit
 * events straight into the service — independent of any renderer.
 */

import { isIntentionalPtyShutdown, registerPtyObserver, type PtySessionInfo } from '../terminal/pty-manager';
import { getCanvasAgentTeamsService } from './service';

interface TeamNodeTarget {
  workspaceId: string;
  nodeId: string;
}

const teamNodeOf = (info: PtySessionInfo): TeamNodeTarget | null => {
  if (!info.env.PULSE_CANVAS_TEAM_ID) return null;
  const workspaceId = info.workspaceId || info.env.PULSE_CANVAS_WORKSPACE_ID;
  const nodeId = info.env.PULSE_CANVAS_NODE_ID;
  if (!workspaceId || !nodeId) return null;
  return { workspaceId, nodeId };
};

// Serialize service calls per node: the output parser keeps a rolling line
// buffer per node, and concurrently interleaved async calls could append to
// it out of order. The exit report goes through the same queue so it runs
// after all pending output for that node.
const nodeQueues = new Map<string, Promise<void>>();

const enqueue = (key: string, run: () => Promise<unknown>): void => {
  const previous = nodeQueues.get(key) ?? Promise.resolve();
  const next = previous
    .then(() => run())
    .then(() => undefined, () => undefined);
  nodeQueues.set(key, next);
};

let unregister: (() => void) | null = null;

export const setupAgentTeamPtyBridge = (
  log?: (message: string, detail: string) => void,
): void => {
  if (unregister) return;
  unregister = registerPtyObserver({
    onData(info, data) {
      const target = teamNodeOf(info);
      if (!target) return;
      enqueue(`${target.workspaceId}:${target.nodeId}`, () =>
        getCanvasAgentTeamsService()
          .reportAgentOutput(target.workspaceId, target.nodeId, data)
          .catch((err) => {
            log?.('agent-team pty bridge output failed', String(err));
          }));
    },
    onExit(info, exitCode) {
      const target = teamNodeOf(info);
      if (!target) return;
      // App-driven teardown (window close / quit) is not a crash: tasks stay
      // in_progress and resume when the renderer relaunches the agents.
      // Reporting these exits would flip every task to needs_review and queue
      // stale review prompts into the (equally dead) lead node.
      if (isIntentionalPtyShutdown()) return;
      const key = `${target.workspaceId}:${target.nodeId}`;
      enqueue(key, async () => {
        try {
          await getCanvasAgentTeamsService().reportAgentExit(target.workspaceId, target.nodeId, exitCode);
        } catch (err) {
          log?.('agent-team pty bridge exit failed', String(err));
        } finally {
          nodeQueues.delete(key);
        }
      });
    },
  });
};

export const teardownAgentTeamPtyBridge = (): void => {
  unregister?.();
  unregister = null;
  nodeQueues.clear();
};
