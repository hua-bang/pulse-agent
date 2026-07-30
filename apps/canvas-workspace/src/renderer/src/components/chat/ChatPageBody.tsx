import { useCallback, useEffect, useMemo, type KeyboardEventHandler, type ReactNode } from 'react';
import type { CanvasNode } from '../../types';
import { ColumnsPlusRight } from '@phosphor-icons/react';
import { PlusIcon, SettingsIcon, SparklesIcon } from '../icons';
import { useRightDock } from '../RightDock/context';
import type { SettingsSection } from '../Settings';
import './ChatPage.css';
import './ChatPanel.css';
import { ChatAnchors } from './ChatAnchors';
import { ChatSessionsRail, type UnifiedSession } from './ChatSessionsRail';
import { RailToggleIcon } from './RailToggleIcon';
import { sessionTitleText } from './utils/sessionTitle';
import { ChatView } from './ChatView';
import { SessionBackBar, type SessionBackEntry } from './SessionBackBar';
import { useChatComposerState } from './hooks/useChatComposerState';
import { isExternalOnlyRoleMessage } from './hooks/roleMentionItems';
import { useAppShell } from '../AppShellProvider';
import type { AgentScope, WorkspaceOption } from './types';
import { buildAnchorElementId, buildChatAnchors } from './utils/anchors';
import { useI18n } from '../../i18n';
import { isImeComposing } from '../../utils/ime';
import { resolveDockChatHandoff } from './dockChatHandoff';
import { useStableSessionRail } from './hooks/useStableSessionRail';

export interface ChatPageBodyProps {
  agentScope: AgentScope;
  /** Session selected while entering a different scope. */
  initialPendingSessionId: string | null;
  /** Reactive pendingSessionId for same-workspace clicks after mount. */
  pendingSessionId: string | null;
  /** Session chosen by the user, updated synchronously before its thread loads. */
  selectedSessionKey?: string | null;
  onSessionConsumed: () => void;
  onSelectSession: (session: UnifiedSession) => void;
  /** Like onSelectSession but for chip jumps — does NOT reset the back stack. */
  onJumpToSession?: (session: { sessionId: string; workspaceId: string }) => void;
  /** Top of the parent-owned session back stack (newest jump origin). */
  backEntry?: SessionBackEntry | null;
  onPushBackEntry?: (entry: SessionBackEntry) => void;
  onBackToSession?: () => void;
  onClearBackStack?: () => void;
  onNewGlobalSession: () => void;
  newSessionRequest: number;
  onWorkspaceContextRequest?: (workspaceId: string) => void;
  allWorkspaces: WorkspaceOption[];
  nodes?: CanvasNode[];
  rootFolder?: string;
  onExit: () => void;
  onNodeFocus?: (workspaceId: string, nodeId: string) => void;
  railCollapsed: boolean;
  onToggleRail: () => void;
  /** Opens the global Settings drawer focused on the given section. */
  onOpenAppSettings: (section: SettingsSection) => void;
  /** Opens per-workspace settings when the chat scope is workspace-bound. */
  onOpenWorkspaceSettings?: (workspaceId: string) => void;
  /** Fixed-task chats hide the cross-session rail/new-chat controls. */
  fixedChat?: {
    title: string;
    banner?: ReactNode;
  };
}

export const ChatPageBody = ({
  agentScope,
  initialPendingSessionId,
  pendingSessionId,
  selectedSessionKey = null,
  onSessionConsumed,
  onSelectSession,
  onJumpToSession,
  backEntry,
  onPushBackEntry,
  onBackToSession,
  onClearBackStack,
  onNewGlobalSession,
  newSessionRequest,
  onWorkspaceContextRequest,
  allWorkspaces,
  nodes,
  rootFolder,
  onExit,
  onNodeFocus,
  railCollapsed,
  onToggleRail,
  onOpenAppSettings,
  onOpenWorkspaceSettings,
  fixedChat,
}: ChatPageBodyProps) => {
  const { t } = useI18n();
  const { notify } = useAppShell();
  const dock = useRightDock();
  const workspaceId = agentScope.kind === 'workspace' ? agentScope.workspaceId : undefined;
  const anchorScopeId = workspaceId ?? 'global';
  const settingsButtonLabel = workspaceId && onOpenWorkspaceSettings
    ? t('workspaceSettings.ariaLabel')
    : t('chat.modelSettings');
  const handleOpenScopeSettings = useCallback(() => {
    if (workspaceId && onOpenWorkspaceSettings) {
      onOpenWorkspaceSettings(workspaceId);
      return;
    }
    onOpenAppSettings('models');
  }, [onOpenAppSettings, onOpenWorkspaceSettings, workspaceId]);
  // Replaces the old close button: leaving the full-page chat is only worth a
  // click if the conversation survives it, so the exit and the dock open ship
  // together (see resolveDockChatHandoff for why the scope matters).
  const handleOpenInDockTab = useCallback(() => {
    const handoff = resolveDockChatHandoff(agentScope);
    if (handoff.kind === 'scheduled') dock.openScheduledChat(handoff.taskId);
    else dock.openChat();
    onExit();
  }, [agentScope, dock, onExit]);
  const {
    abort,
    addImageToCanvas,
    answerClarification,
    attachments,
    canvasModels,
    clarifyInput,
    clearInput,
    collapsedSections,
    editableRef,
    editUserMessage,
    expandedTools,
    focusInput,
    handleAttachFiles,
    handleInput,
    handleKeyDown,
    handleLoadSession,
    handleNewSession,
    handlePaste,
    input,
    loading,
    mentionIndex,
    mentionItems,
    mentionOpen,
    messageTools,
    messages,
    otherSessions,
    currentScopeName,
    pendingClarify,
    regenerateAssistantMessage,
    relay,
    stopRelay,
    removeAttachment,
    selectMention,
    sendMessage,
    sessions, sessionsLoading, sessionLoading,
    setClarifyInput,
    setMentionIndex,
    streamingTools,
    submitCurrentInput,
    toggleSection,
    toggleToolExpand,
  } = useChatComposerState({
    agentScope,
    allWorkspaces,
    nodes,
    rootFolder,
    eagerLoad: true,
    // If a specific session is being selected, don't also fetch the scope's
    // current active history. ChatPageBody now stays mounted across scopes,
    // so this must follow the prop rather than a mount-time snapshot.
    skipInitialHistory: initialPendingSessionId !== null || pendingSessionId !== null,
  });

  useEffect(() => {
    if (!workspaceId) return;
    onWorkspaceContextRequest?.(workspaceId);
  }, [onWorkspaceContextRequest, workspaceId]);

  useEffect(() => {
    if (agentScope.kind !== 'global') return;
    if (newSessionRequest <= 0) return;
    void handleNewSession();
  }, [agentScope.kind, handleNewSession, newSessionRequest]);

  // Load the pending session whenever it changes. The body no longer remounts
  // for cross-workspace picks, so both same- and cross-scope navigation follow
  // this single path.
  useEffect(() => {
    if (pendingSessionId === null) return;
    void handleLoadSession(pendingSessionId).then(() => {
      onSessionConsumed();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSessionId]);

  // See ChatPanel for the rationale; treat loading state as configured to
  // avoid bouncing the user to Settings before status loads.
  const notConfigured = canvasModels.status !== undefined && !canvasModels.status.apiKeyPresent;

  const openModelSettingsWithHint = useCallback(() => {
    onOpenAppSettings('models');
    notify({
      tone: 'info',
      title: t('chat.configureModelToastTitle'),
      description: t('chat.configureModelToastDescription'),
      autoCloseMs: 2200,
    });
  }, [notify, onOpenAppSettings, t]);

  const openModelSettingsFromSwitcher = useCallback(() => {
    if (notConfigured) {
      openModelSettingsWithHint();
      return;
    }
    onOpenAppSettings('models');
  }, [notConfigured, onOpenAppSettings, openModelSettingsWithHint]);

  const handleQuickAction = useCallback(async (prompt: string) => {
    if (notConfigured) {
      openModelSettingsWithHint();
      return;
    }
    if (!prompt) {
      focusInput();
      return;
    }

    const ok = await sendMessage(prompt);
    if (ok) {
      clearInput();
    }
  }, [clearInput, focusInput, notConfigured, openModelSettingsWithHint, sendMessage]);

  const handleSubmit = useCallback(async () => {
    if (notConfigured && !isExternalOnlyRoleMessage(input)) {
      openModelSettingsWithHint();
      return false;
    }
    return await submitCurrentInput();
  }, [input, notConfigured, openModelSettingsWithHint, submitCurrentInput]);

  const handleComposerKeyDown = useCallback<KeyboardEventHandler<HTMLDivElement>>((event) => {
    const mentionSelecting = mentionOpen && mentionItems.length > 0;
    const hasDraft = Boolean(input.trim() || attachments.length > 0);
    if (
      notConfigured
      && !isExternalOnlyRoleMessage(input)
      && hasDraft
      && !mentionSelecting
      && event.key === 'Enter'
      && !event.shiftKey
      && !isImeComposing(event)
    ) {
      event.preventDefault();
      openModelSettingsWithHint();
      return;
    }
    handleKeyDown(event);
  }, [attachments.length, handleKeyDown, input, mentionItems.length, mentionOpen, notConfigured, openModelSettingsWithHint]);

  // Clicking a mention chip should jump back to the canvas and focus the node.
  const handleNodeFocus = useCallback((nodeId: string) => {
    if (!workspaceId) return;
    onNodeFocus?.(workspaceId, nodeId);
    onExit();
  }, [onExit, onNodeFocus, workspaceId]);

  // Short label for the conversation currently on screen — recorded into the
  // back stack when a chip jump navigates away from it.
  const currentSessionLabel = useMemo(() => {
    const firstUser = messages.find((m) => m.role === 'user')?.content.trim();
    if (!firstUser) return '';
    const cleaned = sessionTitleText(firstUser);
    return cleaned.length > 24 ? `${cleaned.slice(0, 23)}…` : cleaned;
  }, [messages]);

  const handleSessionJump = useCallback(async (sessionId: string, jumpWorkspaceId: string, messageIndex?: number) => {
    // Record where the jump started so the back bar can return here.
    try {
      const current = await window.canvasWorkspace.agent.getCurrentSession({ scope: agentScope });
      if (current.ok && current.sessionId && current.sessionId !== sessionId) {
        onPushBackEntry?.({
          sessionId: current.sessionId,
          workspaceId: workspaceId ?? '__global_chat__',
          label: currentSessionLabel,
        });
      }
    } catch {
      // Back entry is best-effort; the jump itself still proceeds.
    }

    // Cross-workspace switches remount the body with the correct workspace
    // scope (routed by the parent WITHOUT resetting the back stack). For
    // same-workspace sessions we can load in-place.
    const isSameScope = jumpWorkspaceId === (workspaceId ?? '__global_chat__');
    if (isSameScope) {
      await handleLoadSession(sessionId);
    } else if (onJumpToSession) {
      onJumpToSession({ sessionId, workspaceId: jumpWorkspaceId });
    } else {
      onSelectSession({
        sessionId,
        workspaceId: jumpWorkspaceId,
        workspaceName: allWorkspaces.find(w => w.id === jumpWorkspaceId)?.name ?? jumpWorkspaceId,
        date: '',
        messageCount: 0,
        preview: '',
        isCurrent: false,
      });
    }
    if (messageIndex !== undefined && messageIndex >= 0) {
      window.setTimeout(() => {
        const id = buildAnchorElementId(anchorScopeId, messageIndex);
        const el = document.getElementById(id);
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        el.classList.add('chat-message--anchor-flash');
        window.setTimeout(() => el.classList.remove('chat-message--anchor-flash'), 1200);
      }, 200);
    }
  }, [agentScope, allWorkspaces, anchorScopeId, currentSessionLabel, handleLoadSession, onJumpToSession, onPushBackEntry, onSelectSession, workspaceId]);

  const anchors = useMemo(() => buildChatAnchors(messages), [messages]);

  const handleJumpAnchor = useCallback((messageIndex: number) => {
    const id = buildAnchorElementId(anchorScopeId, messageIndex);
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.add('chat-message--anchor-flash');
    window.setTimeout(() => {
      el.classList.remove('chat-message--anchor-flash');
    }, 1200);
  }, [anchorScopeId]);

  const handleEditUserMessage = useCallback(
    (messageIndex: number, newContent: string) => editUserMessage(messageIndex, newContent),
    [editUserMessage],
  );

  const handleRegenerate = useCallback(
    (messageIndex: number) => regenerateAssistantMessage(messageIndex),
    [regenerateAssistantMessage],
  );

  const allSessions = useStableSessionRail({
    agentScope,
    allWorkspaces,
    currentScopeName,
    loading: sessionsLoading,
    otherSessions,
    selectedSessionKey,
    sessions,
  });

  // Session switches are blocked while a turn is streaming — swapping the
  // message list mid-generation would let the in-flight stream write into
  // the newly loaded session. Same rule as the session-ref chips.
  const handleRailNewSession = useCallback(async () => {
    if (loading) return;
    onClearBackStack?.();
    if (agentScope.kind !== 'global') {
      onNewGlobalSession();
      return;
    }
    await handleNewSession();
  }, [agentScope.kind, handleNewSession, loading, onClearBackStack, onNewGlobalSession]);

  const handleRailSelectSession = useCallback((session: UnifiedSession) => {
    if (loading) return;
    onSelectSession(session);
  }, [loading, onSelectSession]);

  return (
    <div className="chat-page">
      {!fixedChat && (
        <div className={`chat-page-rail-wrapper${railCollapsed ? ' chat-page-rail-wrapper--collapsed' : ''}`}>
          <ChatSessionsRail
            allSessions={allSessions} loading={sessionsLoading}
            onNewSession={handleRailNewSession}
            onSelectSession={handleRailSelectSession}
          />
        </div>
      )}

      <div className="chat-page-main">
        <div className="chat-page-topbar">
          {fixedChat ? (
            <strong className="chat-page-topbar-title">{fixedChat.title}</strong>
          ) : (
            <button
              className="chat-panel-action-btn"
              onClick={onToggleRail}
              title={railCollapsed ? t('chat.showSessionList') : t('chat.hideSessionList')}
              aria-label={railCollapsed ? t('chat.showSessionList') : t('chat.hideSessionList')}
            >
              <RailToggleIcon size={16} />
            </button>
          )}
          <div className="chat-page-topbar-spacer" />
          <ChatAnchors anchors={anchors} onJump={handleJumpAnchor} />
          <button
            className="chat-panel-action-btn"
            onClick={() => onOpenAppSettings('reply-style')}
            title={t('chat.replyStyleSettings')}
            aria-label={t('chat.replyStyleSettings')}
          >
            <SparklesIcon size={16} strokeWidth={1.25} />
          </button>
          <button
            className="chat-panel-action-btn"
            onClick={handleOpenScopeSettings}
            title={settingsButtonLabel}
            aria-label={settingsButtonLabel}
          >
            <SettingsIcon size={16} strokeWidth={1.25} />
          </button>
          {!fixedChat && (
            <button
              className="chat-panel-action-btn"
              onClick={() => void handleRailNewSession()}
              title={t('chat.newAiChat')}
              aria-label={t('chat.newAiChat')}
            >
              <PlusIcon size={16} strokeWidth={1.3} />
            </button>
          )}
          <button
            className="chat-panel-action-btn"
            onClick={handleOpenInDockTab}
            title={t('chat.openInDockTab')}
            aria-label={t('chat.openInDockTab')}
          >
            <ColumnsPlusRight size={16} />
          </button>
        </div>

        <ChatView
          className="chat-page-body"
          banner={fixedChat?.banner ?? (backEntry && onBackToSession ? (
            <SessionBackBar entry={backEntry} disabled={loading} onBack={onBackToSession} />
          ) : undefined)}
          messages={messages}
          loading={loading} sessionLoading={sessionLoading}
          workspaceId={anchorScopeId}
          rootFolder={rootFolder}
          streamingTools={streamingTools}
          messageTools={messageTools}
          collapsedSections={collapsedSections}
          expandedTools={expandedTools}
          pendingClarify={pendingClarify}
          relay={relay}
          onStopRelay={stopRelay}
          clarifyInput={clarifyInput}
          onClarifyInputChange={setClarifyInput}
          onAnswerClarification={answerClarification}
          onToggleSection={toggleSection}
          onToggleToolExpand={toggleToolExpand}
          onAddImageToCanvas={addImageToCanvas}
          nodes={nodes}
          onNodeFocus={handleNodeFocus}
          onQuickAction={handleQuickAction}
          emptyState={fixedChat ? <div className="chat-page-empty-spacer" /> : undefined} inputPlaceholder={fixedChat ? t('scheduled.followUpPlaceholder') : undefined}
          input={input}
          attachments={attachments}
          editableRef={editableRef}
          mentionOpen={mentionOpen}
          mentionItems={mentionItems}
          mentionIndex={mentionIndex}
          onSelectMention={selectMention}
          onMentionIndexChange={setMentionIndex}
          onInput={handleInput}
          onKeyDown={handleComposerKeyDown}
          onPaste={handlePaste}
          onAttachFiles={handleAttachFiles}
          onRemoveAttachment={removeAttachment}
          onSubmit={handleSubmit}
          onAbort={abort}
          modelStatus={canvasModels.status}
          modelSelection={canvasModels.selection}
          modelLabel={canvasModels.selectedLabel}
          onSelectAutoModel={canvasModels.selectAuto}
          onSelectModel={canvasModels.selectModel}
          onOpenModelSettings={openModelSettingsFromSwitcher}
          contextComposer
          onEditUserMessage={handleEditUserMessage}
          onRegenerate={handleRegenerate}
          onSessionJump={handleSessionJump}
        />
      </div>
    </div>
  );
};
