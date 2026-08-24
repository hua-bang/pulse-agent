import { useEffect, useRef } from 'react';
import { MENTION_GROUP_LABEL_KEY, getMentionGroupKey } from './constants';
import type { MentionItem } from './types';
import { MentionNodeIcon, tabMentionIconType } from './utils/mentions';
import { roleColorSoft } from './utils/roleColors';
import { useI18n } from '../../i18n';
import { SessionTitle } from './SessionTitle';
import { sessionTitleText } from './utils/sessionTitle';
import { pluginMentionIconMarkup } from './utils/pluginMentionIcons';

interface ChatMentionPopupProps {
  mentionItems: MentionItem[];
  mentionIndex: number;
  onSelectMention: (item: MentionItem) => void;
  onMentionIndexChange: (index: number) => void;
}

export const CHAT_MENTION_LISTBOX_ID = 'chat-mention-listbox';
export const chatMentionOptionId = (index: number): string => `chat-mention-option-${index}`;

export const ChatMentionPopup = ({
  mentionItems,
  mentionIndex,
  onSelectMention,
  onMentionIndexChange,
}: ChatMentionPopupProps) => {
  const { t } = useI18n();
  const popupRef = useRef<HTMLDivElement>(null);

  // Keep the keyboard-highlighted row visible — the popup scrolls at
  // max-height 240px, so arrowing past the fold must follow the selection.
  useEffect(() => {
    const active = popupRef.current?.querySelector('.chat-mention-item--active');
    active?.scrollIntoView({ block: 'nearest' });
  }, [mentionIndex]);

  return (
    <div
      className="chat-mention-popup"
      id={CHAT_MENTION_LISTBOX_ID}
      ref={popupRef}
      role="listbox"
      aria-label={t('chat.mention.suggestions')}
    >
      {mentionItems.map((item, index) => {
        const pluginIcon = item.type === 'plugin'
          ? pluginMentionIconMarkup(item.label, item.pluginIconKey, 16)
          : '';
        const groupKey = getMentionGroupKey(item);
        const previousGroupKey = index > 0 ? getMentionGroupKey(mentionItems[index - 1]) : null;
        const showHeader = previousGroupKey !== groupKey;
        const nodeType = item.type === 'role'
          ? 'role'
          : item.type === 'workspace'
            ? 'workspace'
            : item.type === 'plugin'
              ? 'plugin'
            : item.type === 'skill'
              ? 'skill'
              : item.type === 'folder'
                ? 'folder'
                : item.type === 'session'
                  ? 'session'
                  : item.type === 'tab'
                    ? tabMentionIconType(item.tab?.kind)
                    : item.type === 'node'
                      ? item.nodeType ?? 'file'
                      : 'file';

        return (
          <div
            key={`${item.type}-${item.nodeType ?? ''}-${item.workspaceId ?? ''}-${item.label}-${index}`}
            role="presentation"
          >
            {showHeader && (
              <div className="chat-mention-group-header" role="presentation">
                {t(MENTION_GROUP_LABEL_KEY[groupKey])}
              </div>
            )}
            <button
              type="button"
              id={chatMentionOptionId(index)}
              role="option"
              aria-selected={index === mentionIndex}
              tabIndex={-1}
              className={`chat-mention-item${item.type === 'session' ? ' chat-mention-item--session' : ''}${index === mentionIndex ? ' chat-mention-item--active' : ''}`}
              title={item.type === 'session' && item.description ? `${sessionTitleText(item.label)} · ${item.description}` : undefined}
              onMouseDown={(event) => {
                event.preventDefault();
                onSelectMention(item);
              }}
              onMouseEnter={() => onMentionIndexChange(index)}
            >
              {item.type !== 'skill' && (
                <span
                  className="chat-mention-item-icon"
                  style={item.type === 'role' && item.roleColor
                    ? { color: item.roleColor, background: roleColorSoft(item.roleColor) }
                    : undefined}
                >
                  {item.type === 'tag'
                    ? <span className="chat-mention-chip-hash">#</span>
                    : pluginIcon
                      ? <span className="chat-plugin-brand-icon" dangerouslySetInnerHTML={{ __html: pluginIcon }} />
                    : <MentionNodeIcon size={14} nodeType={nodeType} />}
                </span>
              )}
              <span className="chat-mention-item-label">
                {item.type === 'session' ? <SessionTitle value={item.label} /> : item.label}
              </span>
              {item.description && (
                <span className="chat-mention-item-description">{item.description}</span>
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
};
