import { join } from 'node:path';
import { homedir } from 'node:os';
import { CanvasAgent } from './canvas-agent';
import { scopeSessionStoreId } from '../../shared/agent-chat';
import { scopeServiceKey } from './active-session-groups';
import type { ScopeActivationGate } from './scope-activation-gate';
import type { AgentScope } from './types';
import { traceScopeActivationStep } from './observability/host-run';
import { tracedAssertWorkspaceAvailable } from './traced-workspace-availability';

/** Durable visibility is checked even when the Agent or its initialization is cached. */
export async function activateAgentScope(
  scope: AgentScope,
  agents: Map<string, CanvasAgent>,
  gate: ScopeActivationGate,
): Promise<void> {
  await tracedAssertWorkspaceAvailable(scope);
  const key = scopeServiceKey(scope);
  if (agents.has(key)) return;
  // Joining an in-flight activation (usually the composer warm-up) is waiting,
  // not initialization owned by this run.
  const step = gate.isPending(key) ? 'canvas.scope.agent-init-wait' : 'canvas.scope.agent-init';
  await traceScopeActivationStep(step, () => gate.run(key, async () => {
    await tracedAssertWorkspaceAvailable(scope);
    if (agents.has(key)) return;
    const workspaceId = scope.kind === 'workspace' ? scope.workspaceId : undefined;
    const agent = new CanvasAgent({
      scope,
      sessionStoreId: scopeSessionStoreId(scope),
      workspaceId,
      workspaceDir: workspaceId ? join(homedir(), '.pulse-coder', 'canvas', workspaceId) : undefined,
    });
    try {
      await agent.initialize();
      await tracedAssertWorkspaceAvailable(scope);
      agents.set(key, agent);
    } catch (error) {
      await agent.destroy?.().catch(() => undefined);
      throw error;
    }
  }));
  await tracedAssertWorkspaceAvailable(scope);
}
