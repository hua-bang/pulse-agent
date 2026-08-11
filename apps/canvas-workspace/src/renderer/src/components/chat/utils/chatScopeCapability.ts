import type { AgentScope } from '../types';

export type ChatScopeCapability = 'read-only' | 'editable' | 'scheduled';

/** Canvas mutation capability communicated beside every chat composer. */
export const chatScopeCapability = (scope: AgentScope): ChatScopeCapability => (
  scope.kind === 'workspace' ? 'editable' : scope.kind === 'scheduled' ? 'scheduled' : 'read-only'
);
