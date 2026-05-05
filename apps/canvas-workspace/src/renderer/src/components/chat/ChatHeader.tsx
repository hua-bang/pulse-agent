import { CloseIcon, ListLinesIcon, PlusIcon } from '../icons';
import type { OtherWorkspaceSession } from './types';

interface ChatHeaderProps {
  title: string;
  sessionMenuOpen: boolean;
  sessionMenuRef: React.RefObject<HTMLDivElement>;
  sessions: Array<{
    sessionId: string;
    date: string;
    messageCount: number;
    isCurrent: boolean;
    preview?: string;
  }>;
  otherSessions: OtherWorkspaceSession[];
  onToggleSessionMenu: () => Promise<void>;
  onNewSession: () => Promise<void>;
  onLoadSession: (sessionId: string, sourceWorkspaceId?: string) => Promise<void>;
  onClose: () => void;
}

const PulseCanvasMark = () => (
  <span className="chat-panel-brand-mark" aria-hidden="true">
    <svg width="20" height="20" viewBox="0 0 512 512" fill="none">
      <rect x="32" y="32" width="448" height="448" rx="96" ry="96" fill="#fff" />
      <path
        d="M80 268H188L228 178L260 370L292 148L328 268H432"
        stroke="currentColor"
        strokeWidth="22"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  </span>
);

export const ChatHeader = ({
  title,
  sessionMenuOpen,
  sessionMenuRef,
  sessions,
  otherSessions,
  onToggleSessionMenu,
  onNewSession,
  onLoadSession,
  onClose,
}: ChatHeaderProps) => (
  <div className="chat-panel-header">
    <div className="chat-panel-title-wrapper" ref={sessionMenuRef}>
      <button className="chat-panel-title-btn" onClick={() => void onToggleSessionMenu()}>
        <PulseCanvasMark />
        <span className="chat-panel-title-text">{title}</span>
        <svg className="chat-panel-title-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {sessionMenuOpen && (
        <div className="chat-session-menu">
          <button className="chat-session-menu-new" onClick={() => void onNewSession()}>
            <PlusIcon size={14} strokeWidth={1.3} />
            <span>New AI chat</span>
          </button>
          {sessions.length > 0 && (
            <>
              <div className="chat-session-menu-divider" />
              <div className="chat-session-menu-label">Recent</div>
              <div className="chat-session-menu-list">
                {sessions.map(session => (
                  <button
                    key={session.sessionId}
                    className={`chat-session-menu-item${session.isCurrent ? ' chat-session-menu-item--active' : ''}`}
                    onClick={() => {
                      if (!session.isCurrent) {
                        void onLoadSession(session.sessionId);
                        return;
                      }
                      void onToggleSessionMenu();
                    }}
                  >
                    <ListLinesIcon size={14} />
                    <span className="chat-session-menu-item-text">
                      {session.preview || (session.isCurrent ? 'Current chat' : session.date)}
                    </span>
                    <span className="chat-session-menu-item-count">{session.messageCount}</span>
                  </button>
                ))}
              </div>
            </>
          )}
          {otherSessions.length > 0 && (
            <>
              <div className="chat-session-menu-divider" />
              <div className="chat-session-menu-label">Other Workspaces</div>
              <div className="chat-session-menu-list">
                {otherSessions.map(session => (
                  <button
                    key={session.sessionId}
                    className="chat-session-menu-item chat-session-menu-item--other-ws"
                    onClick={() => void onLoadSession(session.sessionId, session.sourceWorkspaceId)}
                  >
                    <ListLinesIcon size={14} />
                    <span className="chat-session-menu-item-text">
                      {session.preview || session.date}
                    </span>
                    <span className="chat-session-menu-item-ws">{session.workspaceName}</span>
                    <span className="chat-session-menu-item-count">{session.messageCount}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
    <div className="chat-panel-actions">
      <button
        className="chat-panel-action-btn"
        onClick={() => void onNewSession()}
        title="New AI chat"
        aria-label="New AI chat"
      >
        <PlusIcon size={16} strokeWidth={1.3} />
      </button>
      <button className="chat-panel-action-btn" onClick={onClose} title="收起面板" aria-label="收起面板">
        <CloseIcon size={16} strokeWidth={1.3} />
      </button>
    </div>
  </div>
);
