/**
 * Memory plugin — main half.
 *
 * Contributes the chat-memory tools (`canvas_memory_recall` / `_record` /
 * `_promote`) and verbatim session-retrieval tools (`canvas_session_list` /
 * `_read`) to every agent (workspace + global), and sediments each completed
 * turn into workspace-bucket memory by subscribing to the agent bus.
 *
 * Reuses `pulse-coder-memory-plugin` (workspace / global memory buckets) — see
 * docs/chat-memory-design.md. The plugin owns all wiring; canvas-agent only
 * emits the `turnComplete` event it listens to.
 */

import type { AgentScope } from '../../../main/agent/types';
import type { MainCanvasPlugin } from '../../types';
import { registerMemoryAdminIpc } from './admin-ipc';
import { sedimentTurn } from './canvas-memory';
import { createCanvasMemoryTools } from './memory-tools';
import { createSessionRetrievalTools } from './session-retrieval';

/** Shape of the `turnComplete` event payload emitted by canvas-agent. */
interface TurnSedimentPayload {
  scope: AgentScope;
  userText: string;
  assistantText: string;
}

function scopeForWorkspaceId(workspaceId: string): AgentScope {
  // An empty workspaceId is the host's signal for global chat.
  return workspaceId ? { kind: 'workspace', workspaceId } : { kind: 'global' };
}

export const MemoryMainPlugin: MainCanvasPlugin = {
  id: 'memory',
  activate(ctx) {
    // Tools are built once per agent at canvas-agent construction. The current
    // session id is read lazily (per call) from the agent service so it always
    // reflects the live session.
    ctx.registerCanvasTool((workspaceId) => {
      const scope = scopeForWorkspaceId(workspaceId);
      const getSessionId = () =>
        ctx.getAgentService().getCurrentSessionIdForScope(scope) ?? undefined;
      return {
        ...createCanvasMemoryTools({ scope, getSessionId }),
        ...createSessionRetrievalTools({ scope }),
      };
    });

    // Sediment every completed turn into the workspace bucket (serves session +
    // workspace recall). Fire-and-forget — memory must never break chat.
    ctx.onAgent('turnComplete', (turn) => {
      const payload = turn.data as TurnSedimentPayload | undefined;
      if (!payload || !turn.sessionId) return;
      void sedimentTurn({
        scope: payload.scope,
        sessionId: turn.sessionId,
        userText: payload.userText,
        assistantText: payload.assistantText,
      }).catch((err) => console.warn('[memory] sediment failed:', err));
    });

    // Renderer-facing admin IPC backing the memory panel UI (Phase 2).
    registerMemoryAdminIpc(ctx);
  },
};
