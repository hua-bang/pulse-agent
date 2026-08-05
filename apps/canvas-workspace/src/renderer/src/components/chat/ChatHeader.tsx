import { useCallback, useId, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { AvatarIcon, CopyIcon, ExternalLinkIcon, ListLinesIcon, PlusIcon, SettingsIcon, SparklesIcon, SpinnerIcon } from '../icons';
import type { OtherWorkspaceSession } from './types';
import { useI18n } from '../../i18n';
import { useMenuKeyboardNav } from '../../hooks/useMenuKeyboardNav';
import { SessionTitle } from './SessionTitle';
import { Button } from '../ui';

interface ChatHeaderProps {
  title: ReactNode;
  sessionMenuOpen: boolean;
  sessionMenuRef: RefObject<HTMLDivElement>;
  /** True while the session list is being (re)fetched. */
  sessionsLoading?: boolean;
  /** Prevents session navigation/mutation while the active thread is opening. */
  disabled?: boolean;
  sessions: Array<{
    sessionId: string;
    date: string;
    messageCount: number;
    isCurrent: boolean;
    preview?: string;
    title?: string;
  }>;
  otherSessions: OtherWorkspaceSession[];
  onToggleSessionMenu: () => Promise<void>;
  onCloseSessionMenu: () => void;
  onNewSession: () => Promise<void>;
  onLoadSession: (sessionId: string, sourceWorkspaceId?: string) => Promise<void>;
  onOpenOriginalSession?: (session: OtherWorkspaceSession) => void;
  onCopyOtherSession?: (session: OtherWorkspaceSession) => Promise<void>;
  onOpenSettings: () => void;
  settingsLabel: string;
  onOpenPromptSettings: () => void;
  /** Opens the chat-roles Settings section (multi-role group chat personas). */
  onOpenRolesSettings?: () => void;
  onClose: () => void;
  /** Slot for the in-chat anchor / TOC control. */
  anchors?: ReactNode;
}

export const ChatHeader = ({
  title,
  sessionMenuOpen,
  sessionMenuRef,
  sessionsLoading = false,
  disabled = false,
  sessions,
  otherSessions,
  onToggleSessionMenu,
  onCloseSessionMenu,
  onNewSession,
  onLoadSession,
  onOpenOriginalSession,
  onCopyOtherSession,
  onOpenSettings,
  settingsLabel,
  onOpenPromptSettings,
  onOpenRolesSettings,
  onClose,
  anchors,
}: ChatHeaderProps) => {
  const { t } = useI18n();
  const menuId = useId();
  const titleButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const closeSessionMenuAndRestoreFocus = useCallback(() => {
    onCloseSessionMenu();
    titleButtonRef.current?.focus();
  }, [onCloseSessionMenu]);

  useMenuKeyboardNav(menuRef, closeSessionMenuAndRestoreFocus, sessionMenuOpen);

  const handleTitleButtonKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      event.stopPropagation();
      if (!sessionMenuOpen) {
        void onToggleSessionMenu();
        return;
      }
      const items = Array.from(
        menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
      );
      const target = event.key === 'ArrowUp' ? items[items.length - 1] : items[0];
      target?.focus();
    },
    [onToggleSessionMenu, sessionMenuOpen],
  );

  return (
    <div className="chat-panel-header">
      <div className="chat-panel-title-wrapper" ref={sessionMenuRef}>
        <button
          ref={titleButtonRef}
          type="button"
          className="chat-panel-title-btn"
          onClick={() => void onToggleSessionMenu()}
          onKeyDown={handleTitleButtonKeyDown}
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={sessionMenuOpen}
          aria-controls={sessionMenuOpen ? menuId : undefined}
          aria-label={sessionMenuOpen ? t('chat.hideSessionList') : t('chat.showSessionList')}
        >
          <span className="chat-panel-title-text">{title}</span>
          {sessionsLoading ? (
            <SpinnerIcon size={12} className="chat-panel-title-chevron chat-spin" />
          ) : (
            <svg className="chat-panel-title-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
        {sessionMenuOpen && (
          <div
            ref={menuRef}
            id={menuId}
            className="chat-session-menu"
            role="menu"
            aria-label={t('chat.showSessionList')}
          >
            <button
              type="button"
              className="chat-session-menu-new"
              role="menuitem"
              onClick={() => void onNewSession()}
              disabled={disabled}
            >
              <PlusIcon size={14} strokeWidth={1.3} />
              <span>{t('chat.newAiChat')}</span>
            </button>
            {sessionsLoading && sessions.length === 0 && otherSessions.length === 0 && (
              <div className="chat-session-menu-loading">
                <SpinnerIcon size={14} className="chat-spin" />
                <span>{t('chat.loadingSessions')}</span>
              </div>
            )}
            {sessions.length > 0 && (
              <>
                <div className="chat-session-menu-divider" />
                <div className="chat-session-menu-label">{t('chat.recent')}</div>
                <div className="chat-session-menu-list">
                  {sessions.map(session => (
                    <button
                      key={session.sessionId}
                      type="button"
                      className={`chat-session-menu-item${session.isCurrent ? ' chat-session-menu-item--active' : ''}`}
                      role="menuitem"
                      aria-current={session.isCurrent ? 'true' : undefined}
                      data-menu-autofocus={session.isCurrent ? 'true' : undefined}
                      disabled={disabled}
                      onClick={() => {
                        if (!session.isCurrent) {
                          void onLoadSession(session.sessionId);
                          return;
                        }
                        onCloseSessionMenu();
                      }}
                    >
                      <ListLinesIcon size={14} />
                      <span className="chat-session-menu-item-text">
                        {session.title || session.preview
                          ? <SessionTitle value={session.title ?? session.preview ?? ''} />
                          : (session.isCurrent ? t('chat.currentChat') : session.date)}
                      </span>
                      <span className="chat-session-menu-item-count">{session.messageCount}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            {otherSessions.length > 0 && (onOpenOriginalSession || onCopyOtherSession) && (
              <>
                <div className="chat-session-menu-divider" />
                <div className="chat-session-menu-label">{t('chat.otherConversations')}</div>
                <div className="chat-session-menu-list">
                  {otherSessions.map(session => (
                    <div
                      key={session.sessionId}
                      className="chat-session-menu-item chat-session-menu-item--other-ws chat-session-menu-item--actions"
                      role="group"
                      aria-label={session.workspaceName}
                    >
                      <ListLinesIcon size={14} />
                      <span className="chat-session-menu-item-text">
                        {session.title || session.preview
                          ? <SessionTitle value={session.title ?? session.preview ?? ''} />
                          : session.date}
                      </span>
                      <span className="chat-session-menu-item-ws">{session.workspaceName}</span>
                      <span className="chat-session-menu-item-count">{session.messageCount}</span>
                      <span className="chat-session-menu-item-actions">
                        {onOpenOriginalSession && (
                          <Button
                            variant="icon"
                            size="xs"
                            role="menuitem"
                            title={t('chat.openInScope')}
                            aria-label={t('chat.openInScope')}
                            disabled={disabled}
                            onClick={() => onOpenOriginalSession(session)}
                          >
                            <ExternalLinkIcon size={13} />
                          </Button>
                        )}
                        {onCopyOtherSession && (
                          <Button
                            variant="icon"
                            size="xs"
                            role="menuitem"
                            title={t('chat.copyToCurrent')}
                            aria-label={t('chat.copyToCurrent')}
                            disabled={disabled}
                            onClick={() => void onCopyOtherSession(session)}
                          >
                            <CopyIcon size={13} />
                          </Button>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
      <div className="chat-panel-actions">
        {anchors}
        {onOpenRolesSettings && (
          <button
            className="chat-panel-action-btn"
            onClick={onOpenRolesSettings}
            title={t('chat.rolesSettings')}
            aria-label={t('chat.rolesSettings')}
          >
            <AvatarIcon size={16} strokeWidth={1.25} />
          </button>
        )}
        <button
          className="chat-panel-action-btn"
          onClick={onOpenPromptSettings}
          title={t('chat.replyStyleSettings')}
          aria-label={t('chat.replyStyleSettings')}
        >
          <SparklesIcon size={16} strokeWidth={1.25} />
        </button>
        <button
          className="chat-panel-action-btn"
          onClick={onOpenSettings}
          title={settingsLabel}
          aria-label={settingsLabel}
        >
          <SettingsIcon size={16} strokeWidth={1.25} />
        </button>
        <button
          className="chat-panel-action-btn"
          onClick={() => void onNewSession()}
          disabled={disabled}
          title={t('chat.newAiChat')}
          aria-label={t('chat.newAiChat')}
        >
          <PlusIcon size={16} strokeWidth={1.3} />
        </button>
        {/* Close hidden — this panel is now a persistent dock tab, and the
            dock's own collapse control (⇥) already closes it; a second,
            panel-local close button was redundant. `onClose` is left wired
            so this is a one-line revert if the tab strip ever stops
            covering that case. */}
      </div>
    </div>
  );
};
