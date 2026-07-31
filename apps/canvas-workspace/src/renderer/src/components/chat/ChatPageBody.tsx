import { useCallback, useEffect, useMemo, type KeyboardEventHandler, type ReactNode } from 'react';
import type { CanvasNode } from '../../types';
import { useRightDock, useRightDockState } from '../RightDock/context';
import { hasDockContentTabs, isDockContentTabVisible } from '../RightDock/dock-content-tabs';
import { buildDockTabRefs } from '../RightDock/tabRefs';
import type { SettingsSection } from '../Settings';
import './ChatPage.css';
import './ChatPanel.css';
import type { UnifiedSession } from './ChatSessionsRail';
import { ChatView } from './ChatView';
import { SessionBackBar, type SessionBackEntry } from './SessionBackBar';
import { useChatComposerState } from './hooks/useChatComposerState';
import { isExternalOnlyRoleMessage } from './hooks/roleMentionItems';
import { useAppShell } from '../AppShellProvider';
import type { AgentScope, WorkspaceOption } from './types';
import { useI18n } from '../../i18n';
import { isImeComposing } from '../../utils/ime';
import {
  type ChatContextSnapshot,
  type ChatExecutionPolicy,
  type ChatTarget,
} from './ChatTargetContext';
import { chatScopeId } from './chatScope';
import { useRegisterChatTarget } from './useRegisterChatTarget';
import { ChatTargetBar } from './ChatTargetBar';
import { ChatConversationStatus } from './ChatConversationStatus';
import { useChatPageTargetContext } from './hooks/useChatPageTargetContext';
import { useChatPageJumpNavigation } from './hooks/useChatPageJumpNavigation';
import { useChatPageSessionRail } from './hooks/useChatPageSessionRail';
import { useChatPagePendingSession } from './hooks/useChatPagePendingSession';
import { submitQuickAction } from './hooks/submitQuickAction';
import { ChatPageRail, ChatPageTopbar } from './ChatPageNavigationChrome';
import { scopeSessionStoreId } from '../../../../shared/agent-chat';

export interface ChatPageBodyProps {
  agentScope: AgentScope;
  /** Context inherited from the visible target that opened this page. */
  contextSnapshot?: ChatContextSnapshot;
  executionPolicy?: ChatExecutionPolicy;
  onExecutionPolicyChange?: (policy: Exclude<ChatExecutionPolicy, 'scheduled'>) => void;
  /** Session selected while entering a different scope. */
  initialPendingSessionId: string | null;
  /** Reactive pendingSessionId for same-workspace clicks after mount. */
  pendingSessionId: string | null;
  pendingSessionIntentId: number | null;
  /** Session chosen by the user, updated synchronously before its thread loads. */
  selectedSessionKey?: string | null;
  onSessionConsumed: (intentId: number, loaded: boolean) => void;
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
  contextSnapshot,
  executionPolicy = agentScope.kind === 'scheduled' ? 'scheduled' : 'auto',
  onExecutionPolicyChange,
  initialPendingSessionId,
  pendingSessionId,
  pendingSessionIntentId,
  selectedSessionKey = null,
  onSessionConsumed,
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
  onOpenWorkspaceSettings,
  fixedChat,
}: ChatPageBodyProps) => {
  const { t } = useI18n();
  const { notify } = useAppShell();
  const dock = useRightDock();
  const dockState = useRightDockState();
  // The dock's Tab strip lives beside this page (its chat tab is hidden here),
  // so the control is a plain show/hide of the content tabs — no navigation.
  // Kept visible (disabled, not hidden) even with zero tabs: a tab can land
  // mid-conversation (agent opens an artifact/preview), and the button's
  // position shouldn't jump around as that happens.
  const dockTabsToggleable = hasDockContentTabs(dockState);
  const dockTabsVisible = isDockContentTabVisible(dockState);
  const workspaceId = agentScope.kind === 'workspace' ? agentScope.workspaceId : undefined;
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
  const {
    abort,
    activeSessionId,
    addImageToCanvas,
    answerClarification,
    attachmentSendBlocked,
    attachments,
    branchError,
    busyElsewhere,
    canvasModels,
    clarifyInput,
    clarificationAnswering,
    clarificationError,
    clearInput,
    collapsedSections,
    conversationBranch,
    deleteSession,
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
    selectMention,
    sendMessage,
    sessions, sessionsLoading, sessionLoading,
    sessionError,
    setClarifyInput,
    setMentionIndex,
    streamingTools,
    submitCurrentInput,
    toggleSection,
    toggleSessionPinned,
    toggleToolExpand,
    undoConversationBranch,
  } = useChatComposerState({
    agentScope,
    scopeLabel,
    allWorkspaces,
    nodes,
    rootFolder,
    dockTabs: workspaceId ? buildDockTabRefs(dockState, workspaceId) : undefined,
    collectStructuredContext: true,
    eagerLoad: true,
    getRequestContext: () => requestContext,
    // If a specific session is being selected, don't also fetch the scope's
    // current active history. ChatPageBody now stays mounted across scopes,
    // so this must follow the prop rather than a mount-time snapshot.
    skipInitialHistory: initialPendingSessionId !== null || pendingSessionId !== null,
  });

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

  useRegisterChatTarget(target, {
    insertNode: busyElsewhere || sessionLoading ? undefined : insertNodeMention,
    insertDomSelection: busyElsewhere || sessionLoading ? undefined : insertDomSelectionMention,
    startSkillChat: handleTargetSkillChat,
    focus: focusInput,
  });

  useEffect(() => {
    if (!workspaceId) return;
    onWorkspaceContextRequest?.(workspaceId);
  }, [onWorkspaceContextRequest, workspaceId]);

  useEffect(() => {
    if (!sessionLoading && activeSessionId) {
      onActiveSessionResolved?.(activeSessionId, scopeId);
    }
  }, [activeSessionId, onActiveSessionResolved, scopeId, sessionLoading]);

  const retrySessionTransition = useChatPagePendingSession({
    busyElsewhere, handleLoadSession, onJumpToSession, onSessionConsumed,
    pendingSessionId, pendingSessionIntentId, retrySession, sessionStoreId,
  });

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

  const handleToggleExecutionPolicy = useCallback(() => {
    if (executionPolicy === 'scheduled') return;
    onExecutionPolicyChange?.(executionPolicy === 'ask' ? 'auto' : 'ask');
  }, [executionPolicy, onExecutionPolicyChange]);

  const sessionInteractionDisabled = loading || sessionLoading || busyElsewhere;
  const sessionRail = useChatPageSessionRail({
    agentScope,
    allWorkspaces,
    currentScopeName,
    sessionsLoading,
    otherSessions,
    selectedSessionKey,
    sessions,
    disabled: sessionInteractionDisabled,
    focusInput,
    handleNewSession,
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
          railCollapsed={railCollapsed}
          onToggleRail={onToggleRail}
          anchors={anchors}
          onJumpAnchor={handleJumpAnchor}
          onOpenReplyStyle={() => onOpenAppSettings('reply-style')}
          onOpenScopeSettings={handleOpenScopeSettings}
          settingsLabel={settingsButtonLabel}
          onNewSession={() => void sessionRail.onNewSession()}
          newSessionDisabled={sessionInteractionDisabled}
          dockTabsVisible={dockTabsVisible}
          dockTabsToggleable={dockTabsToggleable}
          onToggleDockTabs={dock.toggleContentTabs}
        />
        <ChatTargetBar target={target} />

        <ChatView
          className="chat-page-body"
          banner={<>
            <ChatConversationStatus
              sessionLoading={sessionLoading}
              busyElsewhere={busyElsewhere}
              sessionError={sessionError}
              onRetrySession={retrySessionTransition}
              conversationBranch={conversationBranch}
              branchError={branchError}
              onOpenOriginal={async () => { await undoConversationBranch(); }}
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
          onAttachFiles={agentScope.kind === 'workspace' ? handleAttachFiles : undefined}
          onRemoveAttachment={removeAttachment}
          onRetryAttachment={retryAttachment}
          sendDisabled={attachmentSendBlocked || busyElsewhere || Boolean(sessionError)}
          interactionDisabled={busyElsewhere}
          onSubmit={handleSubmit}
          onAbort={abort}
          modelStatus={canvasModels.status}
          modelSelection={canvasModels.selection}
          modelLabel={canvasModels.selectedLabel}
          onSelectAutoModel={canvasModels.selectAuto}
          onSelectModel={canvasModels.selectModel}
          onOpenModelSettings={openModelSettingsFromSwitcher}
          contextComposer
          executionMode={executionPolicy}
          onToggleExecutionMode={executionPolicy === 'scheduled' ? undefined : handleToggleExecutionPolicy}
          conversationKey={activeSessionId ?? scopeId}
          onEditUserMessage={handleEditUserMessage}
          onRegenerate={handleRegenerate}
          onSessionJump={handleSessionJump}
        />
      </div>
    </div>
  );
};
