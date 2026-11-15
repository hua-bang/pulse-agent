import { useCallback } from 'react';
import type { AgentChatMessage } from '../../../types';
import { useAppShell } from '../../../shared/appShell';
import { noteTitleFromMarkdown, requestAddCanvasNote } from '../../../shared/canvasNoteRequest';
import { useI18n } from '../../../i18n';

export interface AddReplyToCanvasOptions {
  /** Canvas nodes the question referenced; the note connects to the first. */
  sourceNodeIds?: string[];
}

export type AddReplyToCanvas = (content: string, options?: AddReplyToCanvasOptions) => void;

/**
 * Ids of the canvas nodes that the question before `replyIndex` referenced.
 * The turn context snapshot records the nodes selected when it was sent.
 */
export const askedNodeIds = (
  messages: readonly AgentChatMessage[],
  replyIndex: number,
): string[] => {
  for (let index = replyIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'user') continue;
    return (message.contextSnapshot?.selectedNodes ?? []).map((node) => node.id);
  }
  return [];
};

/**
 * The text the user selected inside `container`, or an empty string. A
 * selection that starts or ends outside the container does not count.
 */
export const selectedTextWithin = (container: HTMLElement | null): string => {
  const selection = window.getSelection();
  if (!container || !selection || selection.isCollapsed) return '';
  const { anchorNode, focusNode } = selection;
  if (!anchorNode || !focusNode) return '';
  if (!container.contains(anchorNode) || !container.contains(focusNode)) return '';
  return selection.toString().trim();
};

/**
 * Keep an assistant reply on the workspace canvas as a markdown note.
 * Returns undefined for chats without a workspace canvas, which hides the
 * action. The canvas must be mounted; otherwise the user is told to open it.
 */
export const useAddReplyToCanvas = (
  workspaceId: string | undefined,
): AddReplyToCanvas | undefined => {
  const { notify } = useAppShell();
  const { t } = useI18n();
  const add = useCallback<AddReplyToCanvas>((content, options) => {
    if (!workspaceId) return;
    const added = requestAddCanvasNote({
      workspaceId,
      title: noteTitleFromMarkdown(content, t('chat.addToCanvasFallbackTitle')),
      content,
      sourceNodeIds: options?.sourceNodeIds,
    });
    notify(added
      ? { tone: 'success', title: t('chat.addToCanvasDone'), autoCloseMs: 2200 }
      : { tone: 'error', title: t('chat.addToCanvasUnavailable') });
  }, [notify, t, workspaceId]);
  return workspaceId ? add : undefined;
};
