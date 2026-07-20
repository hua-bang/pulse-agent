import { useEffect } from 'react';

import { CANVAS_AGENT_EXTERNAL_CHAT_REQUEST_EVENT } from '../../../../shared/agent-chat';

/** Opens the workspace chat before its scoped handler receives a live agent message. */
export function useExternalChatBridge(workspaceId: string, openChat: () => void): void {
  useEffect(() => {
    const onRequest = (event: Event) => {
      const detail = (event as CustomEvent<{ workspaceId?: unknown }>).detail;
      if (detail?.workspaceId === workspaceId) openChat();
    };
    window.addEventListener(CANVAS_AGENT_EXTERNAL_CHAT_REQUEST_EVENT, onRequest);
    return () => window.removeEventListener(CANVAS_AGENT_EXTERNAL_CHAT_REQUEST_EVENT, onRequest);
  }, [openChat, workspaceId]);
}
