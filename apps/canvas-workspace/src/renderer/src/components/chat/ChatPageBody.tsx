import { useCallback, useEffect, useMemo, useRef, type KeyboardEventHandler } from 'react';
import type { CanvasNode } from '../../types';
import { CloseIcon, PlusIcon, SettingsIcon, SparklesIcon } from '../icons';
import type { SettingsSection } from '../Settings';
import './ChatPage.css';
import './ChatPanel.css';
import { ChatAnchors } from './ChatAnchors';
import { ChatSessionsRail, type UnifiedSession } from './ChatSessionsRail';
import { sessionTitleText } from './utils/sessionTitle';
import { ChatView } from './ChatView';
import { SessionBackBar, type SessionBackEntry } from './SessionBackBar';
import { useChatComposerState } from './hooks/useChatComposerState';
import { useAppShell } from '../AppShellProvider';
import type { AgentScope, WorkspaceOption } from './types';
import { buildAnchorElementId, buildChatAnchors } from './utils/anchors';
import { useI18n } from '../../i18n';
import { isImeComposing } from '../../utils/ime';

const RailToggleIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
    <rect x="1.5" y="2.5" width="13" height="11" rx="2" stroke="currentColor" strokeWidth="1.3" />
    <path d="M6 2.5v11" stroke="currentColor" strokeWidth="1.3" />
  </svg>
);

export interface ChatPageBodyProps {
  agentScope: AgentScope;
  /** Initial session to load on mount (only read at mount time, via ref). */
  initialPendingSessionId: string | null;
  /** Reactive pendingSessionId for same-workspace clicks after mount. */
  pendingSessionId: string | null;
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
}

export const ChatPageBody = ({
  agentScope,
  initialPendingSessionId,
  pendingSessionId,
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
}: ChatPageBodyProps) => {
  const { t } = useI18n();
  const { notify } = useAppShell();
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
  // Snapshot at mount: the caller might change pendingSessionId later (e.g.
  // for a same-workspace click), but on mount we only care about the value
  // we saw when this body was constructed (after a workspace switch).
  const initialPendingRef = useRef(initialPendingSessionId);

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
    pendingClarify,
    regenerateAssistantMessage,
    removeAttachment,
    selectMention,
    sendMessage,
    sessions,
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
    // If we're about to load a specific session on mount, don't also fetch
    // the current active-session history — it would race with the pending
    // load and potentially overwrite it.
    skipInitialHistory: initialPendingRef.current !== null,
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

  // Load the pending session whenever it's set. This uniformly handles both
  // cases:
  //   - Cross-workspace mount: body was just created with a non-null
  //     pendingSessionId from the parent, so the effect fires on first run.
  //   - Same-workspace click after mount: parent bumps pendingSessionId from
  //     null to something, so the effect fires on the subsequent render.
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
    if (notConfigured) {
      openModelSettingsWithHint();
      return false;
    }
    return await submitCurrentInput();
  }, [notConfigured, openModelSettingsWithHint, submitCurrentInput]);

  const handleComposerKeyDown = useCallback<KeyboardEventHandler<HTMLDivElement>>((event) => {
    const mentionSelecting = mentionOpen && mentionItems.length > 0;
    const hasDraft = Boolean(input.trim() || attachments.length > 0);
    if (
      notConfigured
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

  // Merge sessions from the current workspace with sessions from every other
  // workspace into a single list, sorted by date (newest first).
  const allSessions: UnifiedSession[] = useMemo(() => {
    const currentWorkspaceName =
      workspaceId
        ? allWorkspaces.find((w) => w.id === workspaceId)?.name ?? workspaceId
        : 'Global Chat';
    const currentSessionWorkspaceId = workspaceId ?? '__global_chat__';

    const unified: UnifiedSession[] = [
      ...sessions.map((s) => ({
        sessionId: s.sessionId,
        workspaceId: currentSessionWorkspaceId,
        workspaceName: currentWorkspaceName,
        date: s.date,
        messageCount: s.messageCount,
        preview: s.preview,
        isCurrent: s.isCurrent,
      })),
      ...otherSessions.map((os) => ({
        sessionId: os.sessionId,
        workspaceId: os.sourceWorkspaceId,
        workspaceName: os.workspaceName,
        date: os.date,
        messageCount: os.messageCount,
        preview: os.preview,
        isCurrent: false,
      })),
    ];

    unified.sort((a, b) => b.date.localeCompare(a.date));
    return unified;
  }, [sessions, otherSessions, workspaceId, allWorkspaces]);

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
    <>
    <div className="chat-page">
      <div className={`chat-page-rail-wrapper${railCollapsed ? ' chat-page-rail-wrapper--collapsed' : ''}`}>
        <ChatSessionsRail
          allSessions={allSessions}
          onNewSession={handleRailNewSession}
          onSelectSession={handleRailSelectSession}
        />
      </div>

      <div className="chat-page-main">
        <div className="chat-page-topbar">
          <button
            className="chat-panel-action-btn"
            onClick={onToggleRail}
            title={railCollapsed ? t('chat.showSessionList') : t('chat.hideSessionList')}
            aria-label={railCollapsed ? t('chat.showSessionList') : t('chat.hideSessionList')}
          >
            <RailToggleIcon size={16} />
          </button>
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
          <button
            className="chat-panel-action-btn"
            onClick={() => void handleRailNewSession()}
            title={t('chat.newAiChat')}
            aria-label={t('chat.newAiChat')}
          >
            <PlusIcon size={16} strokeWidth={1.3} />
          </button>
          <button
            className="chat-panel-action-btn"
            onClick={onExit}
            title={t('chat.backToCanvasEsc')}
            aria-label={t('chat.backToCanvas')}
          >
            <CloseIcon size={16} strokeWidth={1.3} />
          </button>
        </div>

        <ChatView
          className="chat-page-body"
          banner={backEntry && onBackToSession ? (
            <SessionBackBar entry={backEntry} disabled={loading} onBack={onBackToSession} />
          ) : undefined}
          messages={messages}
          loading={loading}
          workspaceId={anchorScopeId}
          streamingTools={streamingTools}
          messageTools={messageTools}
          collapsedSections={collapsedSections}
          expandedTools={expandedTools}
          pendingClarify={pendingClarify}
          clarifyInput={clarifyInput}
          onClarifyInputChange={setClarifyInput}
          onAnswerClarification={answerClarification}
          onToggleSection={toggleSection}
          onToggleToolExpand={toggleToolExpand}
          onAddImageToCanvas={addImageToCanvas}
          nodes={nodes}
          onNodeFocus={handleNodeFocus}
          onQuickAction={handleQuickAction}
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
    </>
  );
};
