import { useEffect, useRef } from 'react';
import type { AgentScope } from '../../../types';
import { useI18n } from '../../../i18n';
import { useAppShell } from '../AppShellProvider';
import {
  clearConversationCompletion,
  isConversationVisible,
  markConversationCompletionNotified,
  useConversationCompletions,
} from '../../../modules/chat/completion';

interface Props {
  onOpenSessionInScope: (scope: AgentScope, sessionId: string, scopeLabel: string) => void | Promise<void>;
}

/** Always-mounted, low-interruption feedback for genuinely background turns. */
export const ConversationCompletionToastBridge = ({ onOpenSessionInScope }: Props) => {
  const openRef = useRef(onOpenSessionInScope);
  openRef.current = onOpenSessionInScope;
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
        action: {
          label: t('scheduled.openChat'),
          onClick: async () => {
            const { scopeFromSessionStoreId } = await import('../../../modules/chat/session');
            await openRef.current(
              scopeFromSessionStoreId(activity.key.storeId),
              activity.key.sessionId,
              activity.title || t('chat.newAiChat'),
            );
          },
        },
      });
      markConversationCompletionNotified(activity.key);
    }
  }, [activities, notify, t]);

  return null;
};
