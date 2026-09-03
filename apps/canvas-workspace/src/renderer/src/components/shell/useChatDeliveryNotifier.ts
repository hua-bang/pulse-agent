import { useCallback } from 'react';
import { useI18n } from '../../i18n';
import { useAppShell } from './AppShellProvider';
import type { ChatDeliveryReceipt } from '../../modules/chat';

export type ChatDeliveryNotice = ChatDeliveryReceipt | {
  status: 'failed';
  target: null;
  error?: string;
};

export const useChatDeliveryNotifier = () => {
  const { t } = useI18n();
  const { notify } = useAppShell();

  return useCallback((receipt: ChatDeliveryNotice, subject?: string) => {
    if (receipt.status === 'failed' && !receipt.target) {
      notify({
        tone: 'error',
        title: t('chat.delivery.failedGeneric'),
        description: receipt.error ?? subject,
        autoCloseMs: 3600,
      });
      return;
    }
    if (receipt.status === 'unavailable' || !receipt.target) {
      notify({
        tone: 'error',
        title: t('chat.delivery.unavailable'),
        description: subject,
        autoCloseMs: 3600,
      });
      return;
    }

    const target = receipt.target.contextSnapshot.label;
    const isUnassigned = receipt.target.scope.kind === 'global';
    notify({
      tone: receipt.status === 'delivered'
        ? 'success'
        : receipt.status === 'queued'
          ? 'info'
          : 'error',
      title: t(
        isUnassigned
          ? receipt.status === 'delivered'
            ? 'chat.delivery.deliveredAiChat'
            : receipt.status === 'queued'
              ? 'chat.delivery.queuedAiChat'
              : 'chat.delivery.failedGeneric'
          : receipt.status === 'delivered'
            ? 'chat.delivery.delivered'
            : receipt.status === 'queued'
              ? 'chat.delivery.queued'
              : 'chat.delivery.failed',
        { target },
      ),
      description: receipt.status === 'failed' ? receipt.error ?? subject : subject,
      autoCloseMs: receipt.status === 'failed' ? 3600 : 2200,
    });
  }, [notify, t]);
};
