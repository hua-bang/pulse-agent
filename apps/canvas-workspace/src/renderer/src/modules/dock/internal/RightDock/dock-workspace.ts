import { GLOBAL_CHAT_STORE_ID } from '../../../../../../shared/agent-chat';

export function resolveDockWorkspaceId(
  activeView: string,
  activeCanvasWorkspaceId: string,
  chatWorkspaceId: string | null,
): string {
  return activeView === 'chat'
    ? chatWorkspaceId ?? GLOBAL_CHAT_STORE_ID
    : activeCanvasWorkspaceId;
}
