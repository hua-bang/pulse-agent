import { useEffect, useMemo, useState } from 'react';
import { ChevronRightIcon, ListLinesIcon, PlusIcon, SpinnerIcon } from '../icons';
import { Button } from '../ui';
import { useI18n } from '../../i18n';
import { SessionTitle } from './SessionTitle';
import { sessionTitleText } from './utils/sessionTitle';

export interface UnifiedSession {
  sessionId: string;
  workspaceId: string;
  workspaceName: string;
  date: string;
  messageCount: number;
  preview?: string;
  isCurrent?: boolean;
}

interface ChatSessionsRailProps {
  allSessions: UnifiedSession[];
  /** True while the session list is being (re)fetched, e.g. after a scope switch. */
  loading?: boolean;
  onNewSession: () => void | Promise<void>;
  onSelectSession: (session: UnifiedSession) => void;
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
  onNewSession,
  onSelectSession,
}: ChatSessionsRailProps) => {
  const { t } = useI18n();
  const sessionGroups = useMemo(() => {
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
          right.date.localeCompare(left.date)
          || right.sessionId.localeCompare(left.sessionId)
        )),
      }));
  }, [allSessions]);
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
    <aside className="chat-page-rail">
      <button
        className="chat-page-rail-new"
        onClick={() => void onNewSession()}
      >
        <PlusIcon size={14} strokeWidth={1.3} />
        <span>{t('chat.newChat')}</span>
      </button>

      <div className="chat-page-rail-scroll">
        {loading && allSessions.length === 0 ? (
          <div className="chat-page-rail-loading">
            <SpinnerIcon size={14} className="chat-spin" />
            <span>{t('chat.loadingSessions')}</span>
          </div>
        ) : allSessions.length === 0 ? (
          <div className="chat-page-rail-empty">{t('chat.noPreviousChats')}</div>
        ) : (
          sessionGroups.map((group) => (
            <section className="chat-page-rail-group" key={group.id}>
              <Button
                variant="secondary"
                size="xs"
                className="chat-page-rail-folder"
                onClick={() => toggleGroup(group.id)}
                aria-expanded={!collapsedGroupIds.has(group.id)}
              >
                <ChevronRightIcon
                  size={11}
                  className={`chat-page-rail-folder-chevron${collapsedGroupIds.has(group.id) ? '' : ' chat-page-rail-folder-chevron--expanded'}`}
                />
                <span className="chat-page-rail-folder-name">{group.name}</span>
                <span className="chat-page-rail-folder-count">{group.sessions.length}</span>
              </Button>
              {!collapsedGroupIds.has(group.id) && <div className="chat-page-rail-list">
                {group.sessions.map((session) => (
                  <button
                    key={`${session.workspaceId}:${session.sessionId}`}
                    className={`chat-page-rail-item${session.isCurrent ? ' chat-page-rail-item--active' : ''}`}
                    onClick={() => onSelectSession(session)}
                    title={session.preview ? sessionTitleText(session.preview) : session.date}
                  >
                    <ListLinesIcon size={14} />
                    <span className="chat-page-rail-item-text">
                      {session.preview ? <SessionTitle value={session.preview} /> : session.date}
                    </span>
                  </button>
                ))}
              </div>}
            </section>
          ))
        )}
      </div>
    </aside>
  );
};
