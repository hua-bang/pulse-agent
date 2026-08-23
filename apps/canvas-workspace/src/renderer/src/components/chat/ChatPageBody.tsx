import { useCallback, useEffect, useMemo, type KeyboardEventHandler, type ReactNode } from 'react';
import type { CanvasNode } from '../../types';
import { useRightDock, useRightDockState } from '../dock/RightDock/context';
import { isDockContentTabVisible, toggleFullPageDockContentTabs } from '../dock/RightDock/dock-content-tabs';
import type { SettingsSection } from '../settings/Settings';
import './ChatPage.css';
import './ChatPanel.css';
import type { UnifiedSession } from './ChatSessionsRail';
import { ChatView } from './ChatView';
import { SessionBackBar, type SessionBackEntry } from './SessionBackBar';
import { useChatComposerStateKeyed } from './hooks/useChatComposerStateKeyed';
import { isExternalOnlyRoleMessage } from './hooks/roleMentionItems';
import { useAppShell } from '../shell/AppShellProvider';
import type { AgentNewSessionResult, AgentScope, WorkspaceOption } from './types';
import { useI18n } from '../../i18n';
import { isImeComposing } from '../../utils/ime';
import type { ChatContextSnapshot, ChatExecutionPolicy, ChatTarget } from './ChatTargetContext';
import { chatScopeId } from './chatScope';
import { useRegisterChatTarget } from './useRegisterChatTarget';
import { ChatConversationStatus } from './ChatConversationStatus';
import { useChatPageTargetContext } from './hooks/useChatPageTargetContext';
import { useChatPageJumpNavigation } from './hooks/useChatPageJumpNavigation';
import { useChatPageSessionRail } from './hooks/useChatPageSessionRail';
import { useScopeRunningSessions } from './hooks/useScopeRunningSessions';
import { useChatPagePendingSession } from './hooks/useChatPagePendingSession';
import { useSubmitDomReviewComments } from './hooks/useSubmitDomReviewComments';
import { submitQuickAction } from './hooks/submitQuickAction';
import { ChatPageRail, ChatPageTopbar } from './ChatPageNavigationChrome';
import { scopeSessionStoreId } from '../../../../shared/agent-chat';
import { buildChatPageDockTabRefs } from './utils/chatPageDockTabs';
import { useChatPageNewSession } from './hooks/useChatPageNewSession';
import { useConversationCompletionNotices } from './hooks/useConversationCompletionNotices';

export interface ChatPageBodyProps {
  agentScope: AgentScope;
  /** Context inherited from the visible target that opened this page. */
  contextSnapshot?: ChatContextSnapshot;
  executionPolicy?: ChatExecutionPolicy;
  /** Initial and reactive session targets while a transition is pending. */
  initialPendingSessionId: string | null;
  pendingSessionId: string | null;
  pendingSessionIntentId: number | null;
  /** Committed body conversation and the requested target awaiting load. */
  selectedSessionKey?: string | null;
  pendingSessionKey?: string | null;
  onSessionConsumed: (intentId: number, loaded: boolean) => void;
  /** Creates a new session after the user selects another scope. */
  onCreateNewSessionInScope?: (scope: AgentScope) => Promise<AgentNewSessionResult>;
  /** Clears inherited context when the user explicitly starts a new chat. */
  onNewSessionCreated?: (scope: AgentScope) => void;
  onActiveSessionResolved?: (sessionId: string, workspaceId: string) => void;
  onSelectSession: (session: UnifiedSession) => void;
  /** Like onSelectSession but for chip jumps — does NOT reset the back stack. */
  onJumpToSession?: (session: { sessionId: string; workspaceId: string }) => void;
  /** Top of the parent-owned session back stack (newest jump origin). */
  backEntry?: SessionBackEntry | null;
  onPushBackEntry?: (entry: SessionBackEntry) => void;
  onBackToSession?: () => void;
  onClearBackStack?: () => void;
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
  fixedChat?: {
    title: string;
    banner?: ReactNode;
  };
}

export const ChatPageBody = ({
  agentScope,
  contextSnapshot,
  executionPolicy = agentScope.kind === 'scheduled' ? 'scheduled' : 'auto',
  initialPendingSessionId,
  pendingSessionId,
  pendingSessionIntentId,
  selectedSessionKey = null,
  pendingSessionKey = null,
  onSessionConsumed,
  onCreateNewSessionInScope,
  onNewSessionCreated,
  onActiveSessionResolved,
  onSelectSession,
  onJumpToSession,
  backEntry,
  onPushBackEntry,
  onBackToSession,
  onClearBackStack,
  onWorkspaceContextRequest,
  allWorkspaces,
  nodes,
  rootFolder,
  onExit,
  onNodeFocus,
  railCollapsed,
  onToggleRail,
  onOpenAppSettings,
  fixedChat,
}: ChatPageBodyProps) => {
  const { t } = useI18n();
  const { notify } = useAppShell();
  const dock = useRightDock();
  const dockState = useRightDockState();
  // The dock's Tab strip sits beside this page (chat tab hidden here), so the
  // control is a plain show/hide.
  const workspaceId = agentScope.kind === 'workspace' ? agentScope.workspaceId : undefined;
  const workspaceLabel = workspaceId
    ? allWorkspaces.find(workspace => workspace.id === workspaceId)?.name
    : undefined;
  const dockTabsVisible = isDockContentTabVisible(dockState);
  const dockTabs = useMemo(() => buildChatPageDockTabRefs(dockState), [dockState]);
  // Always actionable; empty scopes fall back to a fresh browser tab.
  const handleToggleDockTabs = useCallback(() => {
    toggleFullPageDockContentTabs(
      dockState,
      workspaceId ? {
        id: workspaceId,
        title: allWorkspaces.find(w => w.id === workspaceId)?.name ?? workspaceId,
      } : undefined,
      dock,
    );
  }, [allWorkspaces, dock, dockState, workspaceId]);
  const scopeId = chatScopeId(agentScope);
  const sessionStoreId = scopeSessionStoreId(agentScope);
  const {
    inheritedContextChips,
    removeInheritedContext,
    requestContext,
    resolvedContextSnapshot,
    scopeLabel,
  } = useChatPageTargetContext({
    agentScope,
    allWorkspaces,
    contextSnapshot,
    executionPolicy,
    fixedTitle: fixedChat?.title,
  });
  const {
    abort,
    activeSessionId,
    addImageToCanvas,
    answerClarification,
    attachmentSendBlocked,
    attachments,
    conversationError,
    busyElsewhere,
    canvasModels,
    clarifyInput,
    clarificationAnswering,
    clarificationError,
    clearInput,
    collapsedSections,
    deleteSession,
    disposeCurrentTurn,
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
    insertDomSelectionMention,
    insertNodeMention,
    insertSkillMention,
    insertTabMention,
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
    renameSession,
    retryAttachment,
    retrySession,
    runInputSubmitting,
    runQueue,
    selectMention,
    sendMessage,
    sessions, sessionsLoading, sessionsStoreId, sessionLoading,
    sessionError,
    setClarifyInput,
    setMentionIndex,
    streamingTools,
    submitCurrentInput,
    submitCurrentInputDuringRun,
    toggleSection,
    toggleSessionPinned,
    toggleToolExpand,
  } = useChatComposerStateKeyed({
    agentScope,
    scopeLabel,
    allWorkspaces,
    nodes,
    rootFolder,
    dockTabs,
    collectStructuredContext: true,
    eagerLoad: true,
    getRequestContext: () => requestContext,
    // A pending selection owns the initial history fetch across kept-alive scopes.
    skipInitialHistory: initialPendingSessionId !== null || pendingSessionId !== null,
  });

  const chatDestinationLabel = agentScope.kind === 'workspace' ? workspaceLabel : undefined;
  const newSession = useChatPageNewSession({ agentScope, sessionStoreId, sessionLoading, busyElsewhere, pendingSessionId, focusInput, clearInput, handleNewSession, onClearBackStack, onCreateNewSessionInScope, onNewSessionCreated });

  const handleTargetSkillChat = useCallback(async (skillName: string) => {
    if (loading || sessionLoading || busyElsewhere) throw new Error(t('chat.generating'));
    const created = await handleNewSession();
    if (!created.ok) throw new Error(created.error ?? t('chat.sessionNewFailed'));
    onClearBackStack?.();
    clearInput();
    insertSkillMention(skillName);
  }, [busyElsewhere, clearInput, handleNewSession, insertSkillMention, loading, onClearBackStack, sessionLoading, t]);

  const target = useMemo<ChatTarget>(() => ({
    surface: 'page',
    scope: agentScope,
    scopeId,
    sessionId: activeSessionId,
    composerId: `page:${scopeId}`,
    contextSnapshot: resolvedContextSnapshot,
    executionPolicy,
  }), [activeSessionId, agentScope, executionPolicy, resolvedContextSnapshot, scopeId]);

  useEffect(() => {
    if (!workspaceId) return;
    onWorkspaceContextRequest?.(workspaceId);
  }, [onWorkspaceContextRequest, workspaceId]);

  useEffect(() => {
    if (!pendingSessionId && !sessionLoading && activeSessionId) {
      onActiveSessionResolved?.(activeSessionId, sessionsStoreId);
    }
  }, [activeSessionId, onActiveSessionResolved, pendingSessionId, sessionLoading, sessionsStoreId]);
  const retrySessionTransition = useChatPagePendingSession({ handleLoadSession, onAbandonCurrentTurn: disposeCurrentTurn, onJumpToSession, onSessionConsumed, pendingSessionId, pendingSessionIntentId, retrySession, sessionStoreId });

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

  const submitDomReviewComments = useSubmitDomReviewComments({
    blocked: loading || sessionLoading || busyElsewhere || Boolean(sessionError),
    focusInput, notConfigured, openModelSettingsWithHint, requestContext, sendMessage,
  });
  useRegisterChatTarget(target, {
    insertNode: busyElsewhere || sessionLoading ? undefined : insertNodeMention,
    insertDomSelection: busyElsewhere || sessionLoading ? undefined : insertDomSelectionMention,
    insertTab: busyElsewhere || sessionLoading ? undefined : insertTabMention,
    startSkillChat: handleTargetSkillChat, submitDomReview: submitDomReviewComments, focus: focusInput,
  });

  const openModelSettingsFromSwitcher = useCallback(() => {
    if (notConfigured) {
      openModelSettingsWithHint();
      return;
    }
    onOpenAppSettings('models');
  }, [notConfigured, onOpenAppSettings, openModelSettingsWithHint]);

  const handleQuickAction = useCallback(async (prompt: string) => {
    if (loading || sessionLoading || busyElsewhere || attachmentSendBlocked || sessionError) return;
    if (notConfigured) {
      openModelSettingsWithHint();
      return;
    }
    if (!prompt) {
      focusInput();
      return;
    }

    await submitQuickAction({
      prompt, requestContext, attachments, sendMessage, clearInput,
    });
  }, [attachmentSendBlocked, attachments, busyElsewhere, clearInput, focusInput, loading, notConfigured, openModelSettingsWithHint, requestContext, sendMessage, sessionError, sessionLoading]);

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

  const {
    anchors,
    onJumpAnchor: handleJumpAnchor,
    onSessionJump: handleSessionJump,
  } = useChatPageJumpNavigation({
    agentScope,
    allWorkspaces,
    messages,
    scopeId,
    handleLoadSession,
    onJumpToSession,
    onPushBackEntry,
    onSelectSession,
  });

  const handleEditUserMessage = useCallback(
    (messageIndex: number, newContent: string) => (
      sessionError ? Promise.resolve(false) : editUserMessage(messageIndex, newContent)
    ),
    [editUserMessage, sessionError],
  );

  const handleRegenerate = useCallback(
    (messageIndex: number) => (
      sessionError ? Promise.resolve(false) : regenerateAssistantMessage(messageIndex)
    ),
    [regenerateAssistantMessage, sessionError],
  );

  const sessionInteractionDisabled = loading || sessionLoading || busyElsewhere;
  const sessionRailDisabled = sessionLoading;
  const newSessionDisabled = sessionLoading || busyElsewhere;
  const runningSessionIds = useScopeRunningSessions(agentScope, scopeId); // rail "Running" markers
  const completionStatuses = useConversationCompletionNotices({ selectedSessionKey });
  const sessionRail = useChatPageSessionRail({
    agentScope,
    allWorkspaces,
    currentScopeName,
    sessionsLoading,
    otherSessions,
    selectedSessionKey,
    sessions,
    sessionsStoreId,
    pendingSessionKey: sessionLoading ? pendingSessionKey : null,
    disabled: sessionRailDisabled,
    newSessionDisabled,
    runningSessionIds,
    completionStatuses,
    focusInput,
    handleNewSession,
    onNewSessionDraft: newSession.handleNewSessionFromRail,
    onNewSessionInWorkspace: newSession.handleNewSessionInWorkspace,
    onClearBackStack,
    onSelectSession,
    renameSession,
    deleteSession,
    toggleSessionPinned,
  });

  return (
    <div className="chat-page">
      {!fixedChat && (
        <ChatPageRail collapsed={railCollapsed} rail={sessionRail} />
      )}

      <div className="chat-page-main">
        <ChatPageTopbar
          fixedTitle={fixedChat?.title}
          sessionTitleSource={sessionRail.allSessions.find(session => session.isCurrent)?.preview ?? messages.find(message => message.role === 'user')?.content}
          workspaceLabel={chatDestinationLabel}
          railCollapsed={railCollapsed}
          onToggleRail={onToggleRail}
          anchors={anchors}
          onJumpAnchor={handleJumpAnchor}
          onNewSession={newSession.handleNewSessionFromTopbar}
          newSessionDisabled={newSessionDisabled}
          dockTabsVisible={dockTabsVisible}
          onToggleDockTabs={handleToggleDockTabs}
        />
        <ChatView
          className="chat-page-body"
          banner={<>
            <ChatConversationStatus sessionLoadingFeedback="external"
              sessionLoading={sessionLoading}
              hasMessages={messages.length > 0}
              busyElsewhere={busyElsewhere}
              sessionError={sessionError}
              onRetrySession={retrySessionTransition}
              conversationError={conversationError}
              disabled={sessionInteractionDisabled}
            />
            {fixedChat?.banner ?? (backEntry && onBackToSession ? (
              <SessionBackBar entry={backEntry} disabled={sessionInteractionDisabled} onBack={onBackToSession} />
            ) : undefined)}
          </>}
          messages={messages}
          loading={loading} sessionLoading={sessionLoading}
          workspaceId={scopeId}
          rootFolder={rootFolder}
          streamingTools={streamingTools}
          messageTools={messageTools}
          collapsedSections={collapsedSections}
          expandedTools={expandedTools}
          pendingClarify={pendingClarify}
          clarificationAnswering={clarificationAnswering}
          clarificationError={clarificationError}
          relay={relay}
          onStopRelay={stopRelay}
          clarifyInput={clarifyInput}
          onClarifyInputChange={setClarifyInput}
          onAnswerClarification={answerClarification}
          onToggleSection={toggleSection}
          onToggleToolExpand={toggleToolExpand}
          onAddImageToCanvas={addImageToCanvas}
          nodes={nodes}
          selectedContext={inheritedContextChips}
          showContextChips
          onRemoveContext={removeInheritedContext}
          onNodeFocus={handleNodeFocus}
          onQuickAction={handleQuickAction}
          emptyState={fixedChat ? <div className="chat-page-empty-spacer" /> : undefined}
          emptyStateVariant={agentScope.kind === 'global' ? 'global' : 'canvas'}
          inputPlaceholder={agentScope.kind === 'scheduled'
            ? t('scheduled.followUpPlaceholder')
            : agentScope.kind === 'workspace'
              ? t('chat.askWorkspace', { name: scopeLabel })
              : t('chat.askAnything')}
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
          onRetryAttachment={retryAttachment}
          sendDisabled={attachmentSendBlocked || busyElsewhere || Boolean(sessionError)}
          interactionDisabled={busyElsewhere}
          runInputDisabled={runInputSubmitting}
          onSubmit={handleSubmit}
          onQueue={() => submitCurrentInputDuringRun('follow-up')}
          queuedInputs={runQueue?.queuedInputs}
          steeringInputId={runQueue?.steeringInputId}
          onSteerQueued={runQueue?.steerQueuedInput}
          onRemoveQueued={runQueue?.removeQueuedInput}
          onAbort={abort}
          modelStatus={canvasModels.status}
          modelSelection={canvasModels.selection}
          modelLabel={canvasModels.selectedLabel}
          onSelectModel={canvasModels.selectModel}
          onOpenModelSettings={openModelSettingsFromSwitcher}
          contextComposer
          conversationKey={activeSessionId ?? scopeId}
          onEditUserMessage={handleEditUserMessage}
          onRegenerate={handleRegenerate}
          onSessionJump={handleSessionJump}
        />
      </div>
    </div>
  );
};
