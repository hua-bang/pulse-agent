import { useCallback } from 'react';
import { useAppShell } from '../../../shared/appShell';
import { noteTitleFromMarkdown, requestAddCanvasNote } from '../../../shared/canvasNoteRequest';
import { useI18n } from '../../../i18n';

/**
 * Keep an assistant reply on the workspace canvas as a markdown note.
 * Returns undefined for chats without a workspace canvas, which hides the
 * action. The canvas must be mounted; otherwise the user is told to open it.
 */
export const useAddReplyToCanvas = (
  workspaceId: string | undefined,
): ((content: string) => void) | undefined => {
  const { notify } = useAppShell();
  const { t } = useI18n();
  const add = useCallback((content: string) => {
    if (!workspaceId) return;
    const added = requestAddCanvasNote({
      workspaceId,
      title: noteTitleFromMarkdown(content, t('chat.addToCanvasFallbackTitle')),
      content,
    });
    notify(added
      ? { tone: 'success', title: t('chat.addToCanvasDone'), autoCloseMs: 2200 }
      : { tone: 'error', title: t('chat.addToCanvasUnavailable') });
  }, [notify, t, workspaceId]);
  return workspaceId ? add : undefined;
};
