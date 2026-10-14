import { BotAvatarIcon, WorkspaceIcon } from '../../../components/icons';
import { Button } from '../../../components/ui';
import { useI18n } from '../../../i18n';
import { sessionTitleText } from '../../../modules/chat/components/utils/sessionTitle';
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
          const preview = sessionTitleText(session.preview || '');
          return (
            <Button
              key={`${chat.storeId}:${session.sessionId}`}
              variant="secondary"
              className="launcher__chat"
              onClick={() => onOpenChat(chat)}
              title={title}
            >
              <BotAvatarIcon size={16} />
              <span className="launcher__chat-body">
                <span className="launcher__chat-head">
                  <span className="launcher__chat-title">{title}</span>
                  {session.updatedAt ? (
                    <span className="launcher__chat-time">{formatRelativeTime(session.updatedAt, language)}</span>
                  ) : null}
                </span>
                <span className="launcher__chat-meta">
                  <span className="launcher__chat-scope">
                    {chat.isGlobal ? <BotAvatarIcon size={11} /> : <WorkspaceIcon size={11} />}
                    {chat.scopeName}
                  </span>
                  <span>{t('chat.toolCalls.messageCount', { count: session.messageCount })}</span>
                  {preview && preview !== title ? <span className="launcher__chat-preview">{preview}</span> : null}
                </span>
              </span>
            </Button>
          );
        })}
      </div>
    </section>
  );
};
