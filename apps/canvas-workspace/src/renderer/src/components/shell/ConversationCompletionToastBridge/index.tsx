import { useEffect } from 'react';
import { useI18n } from '../../../i18n';
import { useAppShell } from '../AppShellProvider';
import {
  clearConversationCompletion,
  isConversationVisible,
  markConversationCompletionNotified,
  useConversationCompletions,
} from '../../../modules/chat/completion';

/** Always-mounted, low-interruption feedback for genuinely background turns. */
export const ConversationCompletionToastBridge = () => {
  const activities = useConversationCompletions();
  const { notify } = useAppShell();
  const { t } = useI18n();

  useEffect(() => {
    for (const activity of activities) {
      if (isConversationVisible(activity.key)) {
        clearConversationCompletion(activity.key);
        continue;
      }
      if (activity.notified) continue;
      notify({
        tone: activity.status === 'failed' ? 'error' : 'info',
        title: t(`chat.background.${activity.status}`, {
          title: activity.title || t('chat.newAiChat'),
        }),
        autoCloseMs: activity.status === 'failed' ? 4200 : 2600,
      });
      markConversationCompletionNotified(activity.key);
    }
  }, [activities, notify, t]);

  return null;
};
