import { join } from 'node:path';
import { homedir } from 'node:os';
import { CanvasAgent } from './canvas-agent';
import { scopeSessionStoreId } from '../../shared/agent-chat';
import { scopeServiceKey } from './active-session-groups';
import type { ScopeActivationGate } from './scope-activation-gate';
import type { AgentScope } from './types';
import { assertWorkspaceAvailable } from './workspace-runtime-guard';

/** Durable visibility is checked even when the Agent or its initialization is cached. */
export async function activateAgentScope(
  scope: AgentScope,
  agents: Map<string, CanvasAgent>,
  gate: ScopeActivationGate,
): Promise<void> {
  await assertWorkspaceAvailable(scope);
  const key = scopeServiceKey(scope);
  if (agents.has(key)) return;
  await gate.run(key, async () => {
    await assertWorkspaceAvailable(scope);
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
      await assertWorkspaceAvailable(scope);
      agents.set(key, agent);
    } catch (error) {
      await agent.destroy?.().catch(() => undefined);
      throw error;
    }
  });
  await assertWorkspaceAvailable(scope);
}
