import { traceScopeActivationStep } from './observability/host-run';
import type { AgentScope } from './types';
import { assertWorkspaceAvailable } from './workspace-runtime-guard';

/** Only workspace scopes read durable trash state; other scopes return immediately. */
export const tracedAssertWorkspaceAvailable = (scope: AgentScope): Promise<void> => (
  scope.kind === 'workspace'
    ? traceScopeActivationStep('canvas.scope.availability-check', () => assertWorkspaceAvailable(scope))
    : assertWorkspaceAvailable(scope)
);
