import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { AgentChatMessage, AgentTurnContextSnapshot } from '../../../types';
import { friendlyChatFailure } from './chatTurnOutcome';
import { useI18n } from '../../../i18n';

export function useChatMessageActions(
  workspaceId: string | undefined,
  setMessages: Dispatch<SetStateAction<AgentChatMessage[]>>,
) {
  const { t } = useI18n();
  const appendTurnFailure = useCallback((error: unknown) => {
    const failure = friendlyChatFailure(
      error instanceof Error ? error.message : String(error),
    );
    setMessages(previous => [...previous, {
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      turnStatus: 'failed',
      errorDetails: failure.details,
      failureKind: failure.kind,
      retryable: failure.retryable,
    }]);
  }, [setMessages]);

  const applyResolvedModel = useCallback((
    timestamp: number,
    resolution: Pick<AgentTurnContextSnapshot, 'modelProvider' | 'modelId' | 'modelLabel'>,
  ) => {
    setMessages(previous => previous.map(message => (
      message.role === 'user'
      && message.timestamp === timestamp
      && message.contextSnapshot
        ? {
            ...message,
            contextSnapshot: { ...message.contextSnapshot, ...resolution },
          }
        : message
    )));
  }, [setMessages]);

  const addImageToCanvas = useCallback(async (imagePath: string, title?: string) => {
    if (!workspaceId) return;
    const result = await window.canvasWorkspace.agent.addImageToCanvas(
      workspaceId,
      imagePath,
      title,
    );
    if (!result.ok) {
      setMessages(previous => [...previous, {
        role: 'assistant',
        content: t('chat.addImageFailed', {
          error: result.error ?? t('chat.unknownError'),
        }),
        timestamp: Date.now(),
      }]);
    }
  }, [setMessages, t, workspaceId]);

  return { addImageToCanvas, appendTurnFailure, applyResolvedModel };
}
