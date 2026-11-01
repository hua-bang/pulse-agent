import { useEffect } from 'react';
import { useAppShell } from '../AppShellProvider';
import { useI18n } from '../../../i18n';

/**
 * Once per launch, say so if the previous quit left canvas edits unsaved.
 * The marker is cleared by the read, so a later launch stays quiet.
 */
export const useUnsavedQuitNotice = (): void => {
  const { notify } = useAppShell();
  const { t } = useI18n();
  useEffect(() => {
    void window.canvasWorkspace?.store?.consumeUnsavedQuit?.().then((result) => {
      if (result?.ok && result.pending) {
        notify({ tone: 'error', title: t('canvas.unsaved'), autoCloseMs: 0 });
      }
    }).catch(() => undefined);
  }, [notify, t]);
};
