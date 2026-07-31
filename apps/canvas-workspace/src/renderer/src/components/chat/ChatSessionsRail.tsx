import { useEffect, useId, useMemo, useState } from 'react';
import {
  ChevronRightIcon,
  PlusIcon,
  SpinnerIcon,
} from '../icons';
import { Button, TextField } from '../ui';
import { useI18n } from '../../i18n';
import { ChatSessionRailItem } from './ChatSessionRailItem';

export interface UnifiedSession {
  sessionId: string;
  workspaceId: string;
  workspaceName: string;
  date: string;
  messageCount: number;
  preview?: string;
  isCurrent?: boolean;
  isPinned?: boolean;
}

export interface ChatSessionsRailProps {
  allSessions: UnifiedSession[];
  /** True while the session list is being (re)fetched, e.g. after a scope switch. */
  loading?: boolean;
  /** Prevents session mutations/navigation while a thread pointer is changing. */
  disabled?: boolean;
  onNewSession: () => void | Promise<void>;
  onSelectSession: (session: UnifiedSession) => void;
  onRenameSession?: (session: UnifiedSession, title: string) => void | Promise<void>;
  onDeleteSession?: (session: UnifiedSession) => void | Promise<void>;
  onTogglePinSession?: (session: UnifiedSession) => void | Promise<void>;
}

/**
 * Always-visible sessions rail for ChatPage. Shows a single unified list of
 * sessions from all workspaces — the chat page does not have a "selected
 * workspace" concept, each session carries its own workspace as metadata.
 *
 * Layout: "New chat" stays pinned at the top while the session list scrolls.
 */
export const ChatSessionsRail = ({
  allSessions,
  loading = false,
  disabled = false,
  onNewSession,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
  onTogglePinSession,
}: ChatSessionsRailProps) => {
  const { t } = useI18n();
  const railId = useId().replace(/:/g, '');
  const [searchQuery, setSearchQuery] = useState('');
  const allSessionGroups = useMemo(() => {
    const groups = new Map<string, { id: string; name: string; sessions: UnifiedSession[] }>();
    for (const session of allSessions) {
      const group = groups.get(session.workspaceId);
      if (group) group.sessions.push(session);
      else groups.set(session.workspaceId, {
        id: session.workspaceId,
        name: session.workspaceName,
        sessions: [session],
      });
    }
    return Array.from(groups.values())
      .sort((left, right) => {
        const globalRank = (group: { id: string }) => group.id === '__global_chat__' ? 0 : 1;
        return globalRank(left) - globalRank(right)
          || left.name.localeCompare(right.name)
          || left.id.localeCompare(right.id);
      })
      .map((group) => ({
        ...group,
        sessions: group.sessions.slice().sort((left, right) => (
          Number(Boolean(right.isPinned)) - Number(Boolean(left.isPinned))
          || right.date.localeCompare(left.date)
          || right.sessionId.localeCompare(left.sessionId)
        )),
      }));
  }, [allSessions]);
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  const sessionGroups = useMemo(() => {
    if (!normalizedQuery) return allSessionGroups;
    return allSessionGroups.flatMap((group) => {
      const groupMatches = group.name.toLocaleLowerCase().includes(normalizedQuery);
      const sessions = groupMatches
        ? group.sessions
        : group.sessions.filter((session) => (
            session.preview?.toLocaleLowerCase().includes(normalizedQuery)
            || session.date.toLocaleLowerCase().includes(normalizedQuery)
          ));
      return sessions.length > 0 ? [{ ...group, sessions }] : [];
    });
  }, [allSessionGroups, normalizedQuery]);
  const activeGroupId = sessionGroups.find((group) => group.sessions.some((session) => session.isCurrent))?.id;
  const openGroupId = activeGroupId ?? sessionGroups[0]?.id;
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(() => new Set(
    sessionGroups.filter((group) => group.id !== openGroupId).map((group) => group.id),
  ));
  useEffect(() => {
    if (!openGroupId) return;
    setCollapsedGroupIds(new Set(
      sessionGroups.filter((group) => group.id !== openGroupId).map((group) => group.id),
    ));
  }, [openGroupId, sessionGroups]);
  const toggleGroup = (groupId: string) => {
    setCollapsedGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  return (
    <aside className="chat-page-rail" aria-label={t('chat.sessionList')}>
      <button
        type="button"
        className="chat-page-rail-new"
        onClick={() => void onNewSession()}
        disabled={disabled}
      >
        <PlusIcon size={14} strokeWidth={1.3} />
        <span>{t('chat.newChat')}</span>
      </button>

      <TextField
        type="search"
        className="chat-page-rail-search"
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
        aria-label={t('chat.searchSessions')}
        placeholder={t('chat.searchSessions')}
        disabled={disabled}
      />

      <div className="chat-page-rail-scroll">
        {loading && allSessions.length === 0 ? (
          <div className="chat-page-rail-loading" role="status">
            <SpinnerIcon size={14} className="chat-spin" />
            <span>{t('chat.loadingSessions')}</span>
          </div>
        ) : allSessions.length === 0 ? (
          <div className="chat-page-rail-empty" role="status">{t('chat.noPreviousChats')}</div>
        ) : sessionGroups.length === 0 ? (
          <div className="chat-page-rail-empty" role="status">{t('chat.noMatchingSessions')}</div>
        ) : (
          sessionGroups.map((group, groupIndex) => {
            const listId = `${railId}-sessions-${groupIndex}`;
            const collapsed = !normalizedQuery && collapsedGroupIds.has(group.id);
            return (
              <section className="chat-page-rail-group" key={group.id}>
                <Button
                  variant="secondary"
                  size="xs"
                  className="chat-page-rail-folder"
                  onClick={() => toggleGroup(group.id)}
                  aria-expanded={!collapsed}
                  aria-controls={listId}
                  disabled={disabled}
                >
                  <ChevronRightIcon
                    size={11}
                    className={`chat-page-rail-folder-chevron${collapsed ? '' : ' chat-page-rail-folder-chevron--expanded'}`}
                  />
                  <span className="chat-page-rail-folder-name">{group.name}</span>
                  <span className="chat-page-rail-folder-count">{group.sessions.length}</span>
                </Button>
                <div id={listId} className="chat-page-rail-list" role="list">
                  {!collapsed && group.sessions.map((session) => (
                    <div
                      key={`${session.workspaceId}:${session.sessionId}`}
                      className="chat-page-rail-item-row"
                      role="listitem"
                    >
                      <ChatSessionRailItem
                        session={session}
                        onSelectSession={onSelectSession}
                        onRenameSession={onRenameSession}
                        onDeleteSession={onDeleteSession}
                        onTogglePinSession={onTogglePinSession}
                        disabled={disabled}
                      />
                    </div>
                  ))}
                </div>
              </section>
            );
          })
        )}
      </div>
    </aside>
  );
};
