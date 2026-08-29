import type { AgentScope } from './types';

const scopeKey = (scope: AgentScope): string => {
  if (scope.kind === 'workspace') return `workspace:${scope.workspaceId}`;
  if (scope.kind === 'scheduled') return `scheduled:${scope.taskId}`;
  return 'global';
};

export class McpAppSessionApprovals {
  private readonly bySender = new Map<number, Set<string>>();

  has(senderId: number, scope: AgentScope, serverName: string): boolean {
    return this.bySender.get(senderId)?.has(`${scopeKey(scope)}:${serverName}`) ?? false;
  }

  grant(senderId: number, scope: AgentScope, serverName: string): void {
    const approvals = this.bySender.get(senderId) ?? new Set<string>();
    approvals.add(`${scopeKey(scope)}:${serverName}`);
    this.bySender.set(senderId, approvals);
  }

  clear(senderId: number): void {
    this.bySender.delete(senderId);
  }
}
