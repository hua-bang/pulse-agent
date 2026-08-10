import { ColumnsPlusRight } from '@phosphor-icons/react';
import { useI18n } from '../../i18n';
import { PlusIcon, WorkspaceIcon } from '../icons';
import { Button } from '../ui';
import { ChatAnchors } from './ChatAnchors';
import { ChatSessionsRail, type ChatSessionsRailProps } from './ChatSessionsRail';
import { RailToggleIcon } from './RailToggleIcon';
import type { ChatAnchor } from './utils/anchors';

export const ChatPageRail = ({
  collapsed,
  rail,
}: {
  collapsed: boolean;
  rail: ChatSessionsRailProps;
}) => (
  <div
    id="chat-page-session-rail"
    className={`chat-page-rail-wrapper${collapsed ? ' chat-page-rail-wrapper--collapsed' : ''}`}
    aria-hidden={collapsed || undefined}
  >
    {!collapsed && <ChatSessionsRail {...rail} />}
  </div>
);

interface ChatPageTopbarProps {
  fixedTitle?: string;
  workspaceLabel?: string;
  railCollapsed: boolean;
  onToggleRail: () => void;
  anchors: ChatAnchor[];
  onJumpAnchor: (index: number) => void;
  onNewSession: () => void;
  newSessionDisabled: boolean;
  dockTabsVisible: boolean;
  onToggleDockTabs: () => void;
}

export const ChatPageTopbar = ({
  fixedTitle,
  workspaceLabel,
  railCollapsed,
  onToggleRail,
  anchors,
  onJumpAnchor,
  onNewSession,
  newSessionDisabled,
  dockTabsVisible,
  onToggleDockTabs,
}: ChatPageTopbarProps) => {
  const { t } = useI18n();
  const dockTabsLabel = dockTabsVisible ? t('chat.hideDockTabs') : t('chat.showDockTabs');

  return (
    <div className="chat-page-topbar">
      {fixedTitle ? (
        <strong className="chat-page-topbar-title">{fixedTitle}</strong>
      ) : (
        <Button
          variant="icon"
          size="md"
          className="chat-panel-action-btn"
          onClick={onToggleRail}
          aria-expanded={!railCollapsed}
          aria-controls="chat-page-session-rail"
          title={railCollapsed ? t('chat.showSessionList') : t('chat.hideSessionList')}
          aria-label={railCollapsed ? t('chat.showSessionList') : t('chat.hideSessionList')}
        >
          <RailToggleIcon size={16} />
        </Button>
      )}
      {!fixedTitle && workspaceLabel && (
        <div className="chat-page-topbar-workspace" title={workspaceLabel}>
          <WorkspaceIcon size={14} />
          <span>{workspaceLabel}</span>
        </div>
      )}
      <div className="chat-page-topbar-spacer" />
      <ChatAnchors anchors={anchors} onJump={onJumpAnchor} />
      {!fixedTitle && (
        <Button
          variant="icon"
          size="md"
          className="chat-panel-action-btn"
          onClick={onNewSession}
          disabled={newSessionDisabled}
          title={t('chat.newAiChat')}
          aria-label={t('chat.newAiChat')}
        >
          <PlusIcon size={16} strokeWidth={1.3} />
        </Button>
      )}
      <Button
        variant="icon"
        size="md"
        className="chat-panel-action-btn"
        data-active={dockTabsVisible}
        aria-pressed={dockTabsVisible}
        onClick={onToggleDockTabs}
        title={dockTabsLabel}
        aria-label={dockTabsLabel}
      >
        <ColumnsPlusRight size={16} />
      </Button>
    </div>
  );
};
