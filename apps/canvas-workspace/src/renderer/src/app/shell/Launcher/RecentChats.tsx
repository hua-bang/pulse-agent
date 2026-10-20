import { useMemo } from 'react';
import { conversationKeyId } from '../../../../../shared/conversation-runtime';
import { BotAvatarIcon, SpinnerIcon } from '../../../components/icons';
import { Button } from '../../../components/ui';
import { useI18n } from '../../../i18n';
import { sessionTitleText } from '../../../modules/chat/components/utils/sessionTitle';
import { useRunningConversationKeys } from '../../../modules/chat/sessions/useScopeRunningSessions';
import { formatRelativeTime } from './relativeTime';
import type { RecentChat } from './useLauncherData';

interface Props {
  chats: RecentChat[] | null;
  onOpenChat: (chat: RecentChat) => void;
  onOpenAll: () => void;
}

/**
 * The latest conversations across every scope; a row reopens its session.
 * "View all" opens the chat page, whose session list has the rest.
 */
export const RecentChats = ({ chats, onOpenChat, onOpenAll }: Props) => {
  const { t, language } = useI18n();
  const storeIds = useMemo(() => (chats ?? []).map((chat) => chat.storeId), [chats]);
  const running = useRunningConversationKeys(storeIds);
  if (chats === null) return null;

  return (
    <section className="launcher__section launcher__section--chats" aria-labelledby="launcher-chats">
      <div className="launcher__section-header">
        <h2 id="launcher-chats" className="launcher__section-title">{t('launcher.recentChats')}</h2>
        <Button size="xs" className="launcher__view-all" onClick={onOpenAll}>
          {t('launcher.viewAllChats')}
        </Button>
      </div>
      <div className="launcher__chats">
        {chats.length === 0 && <p className="launcher__chats-empty">{t('launcher.noChats')}</p>}
        {chats.map((chat) => {
          const { session } = chat;
          const title = sessionTitleText(session.title || session.preview || '') || t('launcher.untitledChat');
          const isRunning = running.has(conversationKeyId({ storeId: chat.storeId, sessionId: session.sessionId }));
          return (
            <Button
              key={`${chat.storeId}:${session.sessionId}`}
              variant="secondary"
              className="launcher__chat"
              onClick={() => onOpenChat(chat)}
              title={title}
            >
              <BotAvatarIcon size={14} />
              <span className="launcher__chat-title">{title}</span>
              {isRunning && (
                <span className="launcher__chat-running" role="status">
                  <SpinnerIcon size={11} className="launcher__chat-running-spinner" />
                  {t('chat.sessionRunning')}
                </span>
              )}
              <span className="launcher__chat-meta">
                {chat.scopeName}
                {session.updatedAt ? ` · ${formatRelativeTime(session.updatedAt, language)}` : ''}
              </span>
            </Button>
          );
        })}
      </div>
    </section>
  );
};
