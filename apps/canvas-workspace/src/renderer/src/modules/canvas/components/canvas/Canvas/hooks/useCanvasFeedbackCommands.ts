import { useCallback } from 'react';
import type { CanvasNode } from '../../../../../../types';
import type { CanvasClipboard } from '../../../../../../types/ui-interaction';
import { useAppShell } from '../../../../../../shared/appShell';
import { useI18n } from '../../../../../../i18n';

interface Options {
  undo: () => boolean;
  redo: () => boolean;
  pasteReferenceNodes: (clipboard: CanvasClipboard) => CanvasNode[];
}

export const useCanvasFeedbackCommands = ({ undo, redo, pasteReferenceNodes }: Options) => {
  const { notify } = useAppShell();
  const { t } = useI18n();
  const undoWithFeedback = useCallback(() => {
    if (!undo()) notify({ tone: 'info', title: t('canvas.nothingToUndo'), autoCloseMs: 1500 });
  }, [notify, t, undo]);
  const redoWithFeedback = useCallback(() => {
    if (!redo()) notify({ tone: 'info', title: t('canvas.nothingToRedo'), autoCloseMs: 1500 });
  }, [notify, redo, t]);
  const pasteReferencesWithFeedback = useCallback((clipboard: CanvasClipboard) => {
    const created = pasteReferenceNodes(clipboard);
    if (created.length > 0) {
      notify({
        tone: 'info',
        title: t('canvas.pastedReferences', { count: created.length }),
        description: t('canvas.pastedReferencesDescription'),
      });
    }
    return created;
  }, [notify, pasteReferenceNodes, t]);
  return { undoWithFeedback, redoWithFeedback, pasteReferencesWithFeedback };
};
