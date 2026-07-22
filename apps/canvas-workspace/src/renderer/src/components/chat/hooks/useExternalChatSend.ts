import { useEffect, useRef } from 'react';

import {
  CANVAS_AGENT_EXTERNAL_CHAT_REQUEST_EVENT,
  CANVAS_AGENT_EXTERNAL_CHAT_RESULT_EVENT,
  type AgentChatSender,
  type AgentRequestContext,
  type CanvasAgentExternalChatRequest,
  type CanvasAgentExternalChatResult,
  type ChatImageAttachment,
} from '../../../../../shared/agent-chat';

type SendMessage = (
  message: string,
  requestContext?: AgentRequestContext,
  attachments?: ChatImageAttachment[],
  sender?: AgentChatSender,
) => Promise<boolean>;

function isExternalChatRequest(value: unknown): value is CanvasAgentExternalChatRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as Partial<CanvasAgentExternalChatRequest>;
  return typeof request.requestId === 'string'
    && typeof request.workspaceId === 'string'
    && typeof request.message === 'string'
    && !!request.sender
    && (request.sender.agentType === 'claude-code' || request.sender.agentType === 'codex')
    && typeof request.sender.label === 'string';
}

/** Delivers a validated local-runtime chat request through this visible chat scope. */
export function useExternalChatSend(workspaceId: string | undefined, sendMessage: SendMessage): void {
  const sendRef = useRef(sendMessage);
  const inFlightRequestIds = useRef(new Set<string>());
  sendRef.current = sendMessage;

  useEffect(() => {
    if (!workspaceId) return;
    const onRequest = (event: Event) => {
      const request = (event as CustomEvent<unknown>).detail;
      if (!isExternalChatRequest(request) || request.workspaceId !== workspaceId) return;
      if (inFlightRequestIds.current.has(request.requestId)) return;
      inFlightRequestIds.current.add(request.requestId);
      void sendRef.current(request.message, undefined, [], request.sender)
        .then((accepted) => {
          const result: CanvasAgentExternalChatResult = { requestId: request.requestId, accepted };
          window.dispatchEvent(new CustomEvent(CANVAS_AGENT_EXTERNAL_CHAT_RESULT_EVENT, { detail: result }));
        })
        .finally(() => inFlightRequestIds.current.delete(request.requestId));
    };
    window.addEventListener(CANVAS_AGENT_EXTERNAL_CHAT_REQUEST_EVENT, onRequest);
    return () => window.removeEventListener(CANVAS_AGENT_EXTERNAL_CHAT_REQUEST_EVENT, onRequest);
  }, [workspaceId]);
}
