import type { AgentScope } from './types';

/** Dock chat surface that continues a full-page conversation. */
export type DockChatHandoff =
  | { kind: 'scheduled'; taskId: string }
  | { kind: 'chat' };

/**
 * Which dock chat surface takes over when the user moves the full-page chat
 * into the right dock's Pulse AI tab.
 *
 * A scheduled task's chat is its own session store, so the hand-off MUST carry
 * the task id: `openChat()` clears `scheduledChatTaskId`, which would silently
 * swap in the active workspace's conversation instead of the task's own. Other
 * scopes have no dedicated dock projection and land on the plain chat tab.
 *
 * The hand-off always leaves the full-page route as well — that page is
 * exactly where `isDockChatTabEnabled` is false, so a dock open without the
 * exit would target a tab the current route hides.
 */
export const resolveDockChatHandoff = (scope: AgentScope): DockChatHandoff => (
  scope.kind === 'scheduled' ? { kind: 'scheduled', taskId: scope.taskId } : { kind: 'chat' }
);
