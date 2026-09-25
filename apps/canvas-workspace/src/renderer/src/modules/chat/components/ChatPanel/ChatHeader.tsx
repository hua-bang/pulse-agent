import { useCallback, useId, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { CopyIcon, ExternalLinkIcon, ListLinesIcon, PlusIcon, SpinnerIcon } from '../../../../components/icons';
import type { OtherWorkspaceSession } from '../../../../types';
import { useI18n } from '../../../../i18n';
import { useMenuKeyboardNav } from '../../../../hooks/useMenuKeyboardNav';
import { SessionTitle } from '../SessionTitle';
import { Button } from '../../../../components/ui';
import { ChatSessionRailItem } from '../ChatSessionsRail/ChatSessionRailItem';

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
    isPinned?: boolean;
  }>;
  otherSessions: OtherWorkspaceSession[];
  /** User-facing owner label used to distinguish the current scope. */
  scopeLabel?: string;
  scopeStoreId?: string;
  onToggleSessionMenu: () => Promise<void>;
  onCloseSessionMenu: () => void;
  onNewSession: () => Promise<void>;
  onLoadSession: (sessionId: string, sourceWorkspaceId?: string) => Promise<void>;
  onRenameSession?: (sessionId: string, title: string) => Promise<unknown>;
  onDeleteSession?: (sessionId: string) => Promise<unknown>;
  onToggleSessionPinned?: (sessionId: string, pinned: boolean) => Promise<unknown>;
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
  scopeLabel,
  scopeStoreId = '',
  onToggleSessionMenu,
  onCloseSessionMenu,
  onNewSession,
  onLoadSession,
  onRenameSession,
  onDeleteSession,
  onToggleSessionPinned,
  onOpenOriginalSession,
  onCopyOtherSession,
  onClose,
  anchors,
}: ChatHeaderProps) => {
  const { t } = useI18n();
  const menuId = useId();
  const [editingSessionIds, setEditingSessionIds] = useState<Set<string>>(() => new Set());
  const handleEditingChange = useCallback((sessionId: string, editing: boolean) => {
    setEditingSessionIds(current => {
      if (current.has(sessionId) === editing) return current;
      const next = new Set(current);
      if (editing) next.add(sessionId);
      else next.delete(sessionId);
      return next;
    });
  }, []);
  const titleButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const closeSessionMenuAndRestoreFocus = useCallback(() => {
    onCloseSessionMenu();
    titleButtonRef.current?.focus();
  }, [onCloseSessionMenu]);

  useMenuKeyboardNav(menuRef, closeSessionMenuAndRestoreFocus, sessionMenuOpen && editingSessionIds.size === 0);

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
                <div className="chat-session-menu-label">
                  {t('chat.recent')}
                  {scopeLabel && <span className="chat-session-menu-label-detail"> · {scopeLabel}</span>}
                </div>
                <div className="chat-session-menu-list">
                  {sessions.map(session => (
                    <ChatSessionRailItem
                      key={session.sessionId}
                      session={{
                        ...session,
                        preview: session.title || session.preview,
                        workspaceId: scopeStoreId,
                        workspaceName: scopeLabel ?? '',
                      }}
                      menuItem
                      disabled={disabled}
                      onEditingChange={handleEditingChange}
                      onSelectSession={() => {
                        if (session.isCurrent) onCloseSessionMenu();
                        else void onLoadSession(session.sessionId);
                      }}
                      onRenameSession={onRenameSession
                        ? async (item, title) => { await onRenameSession(item.sessionId, title); }
                        : undefined}
                      onDeleteSession={onDeleteSession
                        ? async item => { await onDeleteSession(item.sessionId); }
                        : undefined}
                      onTogglePinSession={onToggleSessionPinned
                        ? async item => { await onToggleSessionPinned(item.sessionId, !item.isPinned); }
                        : undefined}
                    />
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
