import { BotAvatarIcon } from '../../../components/icons';
import { Button } from '../../../components/ui';
import { useI18n } from '../../../i18n';
import { formatRelativeTime } from './relativeTime';
import type { RecentChat } from './useLauncherData';

interface Props {
  chats: RecentChat[] | null;
  onOpenChat: (chat: RecentChat) => void;
}

/** The latest conversations across every scope; a row reopens its session. */
export const RecentChats = ({ chats, onOpenChat }: Props) => {
  const { t, language } = useI18n();
  if (chats === null) return null;

  return (
    <section className="launcher__section" aria-labelledby="launcher-chats">
      <h2 id="launcher-chats" className="launcher__section-title">{t('launcher.recentChats')}</h2>
      <div className="launcher__chats">
        {chats.length === 0 && <p className="launcher__chats-empty">{t('launcher.noChats')}</p>}
        {chats.map((chat) => {
          const { session } = chat;
          const title = session.title || session.preview || t('launcher.untitledChat');
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
