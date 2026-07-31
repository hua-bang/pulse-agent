import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEventHandler } from 'react';
import { ChatAnchors } from './ChatAnchors';
import { ChatHeader } from './ChatHeader';
import { SessionTitle } from './SessionTitle';
import { sessionTitleText } from './utils/sessionTitle';
import './ChatPanel.css';
import './DomMention.css';
import { ChatView } from './ChatView';
import { SessionBackBar } from './SessionBackBar';
import { useChatComposerState } from './hooks/useChatComposerState';
import { isExternalOnlyRoleMessage } from './hooks/roleMentionItems';
import { useComposerRequest } from './hooks/useComposerRequest';
import { useAppShell } from '../AppShellProvider';
import type { AgentContextDomReviewComment, AgentRequestContext } from '../../types';
import type { AgentScope, ChatPanelProps } from './types';
import { useI18n } from '../../i18n';
import { isImeComposing } from '../../utils/ime';
import { useStartSkillChat } from './hooks/useStartSkillChat';
import { buildDomReviewPrompt } from './utils/domReviewPrompt';
import {
  type ChatTarget,
} from './ChatTargetContext';
import { chatScopeId } from './chatScope';
import { useRegisterChatTarget } from './useRegisterChatTarget';
import { ChatConversationStatus } from './ChatConversationStatus';
import { useChatPanelContext } from './hooks/useChatPanelContext';
import { useChatPanelSessionNavigation } from './hooks/useChatPanelSessionNavigation';
import { submitQuickAction } from './hooks/submitQuickAction';
export const ChatPanel = ({
  workspaceId,
  agentScope: agentScopeProp,
  knowledgeMode = false,
  banner,
  pendingLabel,
  allWorkspaces,
  nodes,
  knowledgeNodes,
  knowledgeTags,
  dockTabs, selectedNodeIds,
  contextNodes,
  contextTags,
  contextCanvases,
  composerRequest, onComposerRequestHandled,
  onRemoveContext,
  rootFolder,
  onClose,
  onResizeStart,
  onNodeFocus,
  onOpenAppSettings,
  onOpenWorkspaceSettings,
  onRegisterInsertMention,
  onRegisterStartSkillChat,
  onRegisterInsertDomSelectionMention,
  onRegisterSubmitDomReviewComments,
  onTurnComplete,
  chatTargetActive = true,
  chatTargetLabel,
  sessionRefreshKey,
  onOpenSessionInScope,
}: ChatPanelProps) => {
  const { t } = useI18n();
  const { notify } = useAppShell();
  const [executionMode, setExecutionMode] = useState<'auto' | 'ask'>('auto');
  const requestContextRef = useRef<AgentRequestContext>();

  const agentScope = useMemo<AgentScope>(
    () => agentScopeProp ?? { kind: 'workspace', workspaceId: workspaceId ?? '' },
    [agentScopeProp, workspaceId],
  );
  const scopeWorkspaceId = agentScope.kind === 'workspace' ? agentScope.workspaceId : undefined;
  const scopeId = chatScopeId(agentScope);
  const scopeLabel = chatTargetLabel
    ?? (agentScope.kind === 'global'
      ? t('chat.scope.global')
      : agentScope.kind === 'scheduled'
        ? t('chat.scope.scheduled')
        : allWorkspaces?.find(workspace => workspace.id === agentScope.workspaceId)?.name
          ?? agentScope.workspaceId);
  const settingsButtonLabel = scopeWorkspaceId && onOpenWorkspaceSettings
    ? t('workspaceSettings.ariaLabel')
    : t('chat.modelSettings');
  const handleOpenScopeSettings = useCallback(() => {
    if (scopeWorkspaceId && onOpenWorkspaceSettings) {
      onOpenWorkspaceSettings(scopeWorkspaceId);
      return;
    }
    onOpenAppSettings('models');
  }, [onOpenAppSettings, onOpenWorkspaceSettings, scopeWorkspaceId]);

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
    conversationBranch,
    editUserMessage,
    regenerateAssistantMessage,
    relay,
    stopRelay,
    collapsedSections,
    editableRef,
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
    closeSessionMenu,
    openSessionMenu,
    otherSessions,
    pendingClarify,
    removeAttachment,
    retryAttachment,
    retrySession,
    replaceInput,
    selectMention,
    sendMessage,
    sessionMenuOpen,
    sessionMenuRef,
    sessions,
    sessionsLoading,
    sessionLoading,
    sessionError,
    setClarifyInput,
    setMentionIndex,
    streamingTools,
    submitCurrentInput,
    toggleSection,
    toggleToolExpand,
    undoConversationBranch,
  } = useChatComposerState({
    agentScope,
    scopeLabel,
    allWorkspaces,
    nodes,
    rootFolder,
    knowledgeNodes,
    knowledgeTags,
    dockTabs,
    collectStructuredContext: true,
    getRequestContext: () => requestContextRef.current });

  useEffect(() => {
    if (!onRegisterInsertMention || busyElsewhere || sessionLoading) return;
    return onRegisterInsertMention(insertNodeMention);
  }, [busyElsewhere, insertNodeMention, onRegisterInsertMention, sessionLoading]);
  const previousSessionRefreshKeyRef = useRef(sessionRefreshKey);
  useEffect(() => {
    if (Object.is(previousSessionRefreshKeyRef.current, sessionRefreshKey)) return;
    previousSessionRefreshKeyRef.current = sessionRefreshKey;
    void retrySession();
  }, [retrySession, sessionRefreshKey]);

  useEffect(() => {
    if (!onRegisterInsertDomSelectionMention || busyElsewhere || sessionLoading) return;
    return onRegisterInsertDomSelectionMention(insertDomSelectionMention);
  }, [busyElsewhere, insertDomSelectionMention, onRegisterInsertDomSelectionMention, sessionLoading]);

  const onTurnCompleteRef = useRef(onTurnComplete);
  onTurnCompleteRef.current = onTurnComplete;
  const prevLoadingRef = useRef(false);
  useEffect(() => {
    if (prevLoadingRef.current && !loading) onTurnCompleteRef.current?.();
    prevLoadingRef.current = loading;
  }, [loading]);

  const { requestContext, selectedContext } = useChatPanelContext({
    nodes,
    selectedNodeIds,
    contextNodes,
    contextTags,
    contextCanvases,
    executionMode,
  });
  requestContextRef.current = requestContext;

  const firstUserMessage = useMemo(() => messages.find(message => message.role === 'user')?.content.trim(), [messages]);

  const sessionTitle = useMemo(() => {
    if (!firstUserMessage) return t('chat.newAiChat');
    const fallback = requestContext.scope === 'selected_nodes'
      ? t('chat.quick.organizeSelection')
      : t('chat.quick.analyzeRelations');
    const title = sessionTitleText(firstUserMessage) || fallback;
    return title.length > 24 ? `${title.slice(0, 23)}…` : title;
  }, [firstUserMessage, requestContext.scope, t]);

  // Undefined status is still loading; only resolved false opens Settings.
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

  const submitDomReviewComments = useCallback(async (comments: AgentContextDomReviewComment[]) => {
    if (loading || sessionLoading || busyElsewhere || sessionError) return false;
    const validComments = comments.filter((comment) => comment.text.trim());
    if (validComments.length === 0) {
      focusInput();
      return false;
    }
    if (notConfigured) {
      openModelSettingsWithHint();
      return false;
    }

    const domSelections = validComments.map((comment) => comment.selection);
    const context: AgentRequestContext = {
      ...requestContext,
      domSelections: [...(requestContext.domSelections ?? []), ...domSelections],
      scope: 'selected_nodes',
    };
    return sendMessage(buildDomReviewPrompt(validComments), context);
  }, [busyElsewhere, focusInput, loading, notConfigured, openModelSettingsWithHint, requestContext, sendMessage, sessionError, sessionLoading]);

  useEffect(() => {
    if (
      !onRegisterSubmitDomReviewComments
      || loading
      || sessionLoading
      || busyElsewhere
    ) return;
    return onRegisterSubmitDomReviewComments(submitDomReviewComments);
  }, [busyElsewhere, loading, onRegisterSubmitDomReviewComments, sessionLoading, submitDomReviewComments]);

  const chatTarget = useMemo<ChatTarget>(() => ({
    surface: 'dock',
    scope: agentScope,
    scopeId,
    sessionId: activeSessionId,
    composerId: `dock:${scopeId}`,
    contextSnapshot: {
      label: scopeLabel,
      requestContext,
    },
    executionPolicy: agentScope.kind === 'scheduled' ? 'scheduled' : executionMode,
  }), [activeSessionId, agentScope, executionMode, requestContext, scopeId, scopeLabel]);

  useRegisterChatTarget(chatTargetActive ? chatTarget : null, {
    insertNode: busyElsewhere || sessionLoading ? undefined : insertNodeMention,
    insertDomSelection: busyElsewhere || sessionLoading ? undefined : insertDomSelectionMention,
    submitDomReview: submitDomReviewComments,
    focus: focusInput,
  });

  const openModelSettingsFromSwitcher = useCallback(() => {
    if (notConfigured) {
      openModelSettingsWithHint();
      return;
    }
    onOpenAppSettings('models');
  }, [notConfigured, onOpenAppSettings, openModelSettingsWithHint]);

  const handleQuickAction = useCallback(async (prompt: string, quickAction?: string) => {
    if (loading || sessionLoading || busyElsewhere || attachmentSendBlocked || sessionError) return false;
    if (notConfigured) {
      openModelSettingsWithHint();
      return false;
    }
    if (!prompt) {
      focusInput();
      return false;
    }

    return submitQuickAction({
      prompt, quickAction, requestContext, attachments, sendMessage, clearInput,
    });
  }, [attachmentSendBlocked, attachments, busyElsewhere, clearInput, focusInput, loading, notConfigured, openModelSettingsWithHint, requestContext, sendMessage, sessionError, sessionLoading]);

  useComposerRequest({
    request: composerRequest,
    focusInput,
    replaceInput,
    submitQuickAction: handleQuickAction,
    onHandled: onComposerRequestHandled,
  });

  // Externally driven roles use the user's CLI, so they need no app provider.
  const handleSubmit = useCallback(async () => {
    if (notConfigured && !isExternalOnlyRoleMessage(input)) {
      openModelSettingsWithHint();
      return false;
    }
    return await submitCurrentInput(requestContext);
  }, [input, notConfigured, openModelSettingsWithHint, requestContext, submitCurrentInput]);

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

  const handleToggleExecutionMode = useCallback(() => {
    setExecutionMode(mode => mode === 'auto' ? 'ask' : 'auto');
  }, []);

  const handleEditUserMessage = useCallback(
    (index: number, newContent: string) => (
      sessionError
        ? Promise.resolve(false)
        : editUserMessage(index, newContent, requestContextRef.current)
    ),
    [editUserMessage, sessionError],
  );

  const handleRegenerate = useCallback(
    (index: number) => (
      sessionError
        ? Promise.resolve(false)
        : regenerateAssistantMessage(index, requestContextRef.current)
    ),
    [regenerateAssistantMessage, sessionError],
  );

  const {
    anchors,
    backEntry,
    onCopyOtherSession: handleCopyOtherSession,
    onJumpAnchor: handleJumpAnchor,
    onLoadSession: handleLoadSessionFromMenu,
    onNewSession: handleNewSessionFromMenu,
    onOpenOriginalSession: handleOpenOriginalSession,
    onSessionBack: handleSessionBack,
    onSessionJump: handleSessionJump,
    setBackStack: setSessionBackStack,
  } = useChatPanelSessionNavigation({
    agentScope,
    allWorkspaces,
    scopeId,
    sessionTitle,
    messages,
    busy: loading || sessionLoading || busyElsewhere,
    focusInput,
    closeSessionMenu,
    handleNewSession,
    handleLoadSession,
    onOpenSessionInScope,
  });
  useStartSkillChat({
    loading: loading || sessionLoading || busyElsewhere,
    clearInput,
    handleNewSession,
    insertSkillMention,
    setSessionBackStack,
    onRegister: onRegisterStartSkillChat,
  });

  return (
    <ChatView
      className="chat-panel"
      onResizeStart={onResizeStart}
      header={
        <>
        <ChatHeader
          sessionMenuOpen={sessionMenuOpen}
          sessionMenuRef={sessionMenuRef}
          sessions={sessions}
          sessionsLoading={sessionsLoading}
          disabled={loading || sessionLoading || busyElsewhere}
          otherSessions={otherSessions}
          title={firstUserMessage ? <SessionTitle value={firstUserMessage} /> : sessionTitle}
          onToggleSessionMenu={openSessionMenu}
          onCloseSessionMenu={closeSessionMenu}
          onNewSession={handleNewSessionFromMenu}
          onOpenSettings={handleOpenScopeSettings}
          settingsLabel={settingsButtonLabel}
          onOpenPromptSettings={() => onOpenAppSettings('reply-style')}
          onOpenRolesSettings={() => onOpenAppSettings('chat-roles')}
          onLoadSession={handleLoadSessionFromMenu}
          onOpenOriginalSession={onOpenSessionInScope ? handleOpenOriginalSession : undefined}
          onCopyOtherSession={scopeWorkspaceId ? handleCopyOtherSession : undefined}
          onClose={onClose}
          anchors={<ChatAnchors anchors={anchors} onJump={handleJumpAnchor} />}
        />
        </>
      }
      banner={<>
        <ChatConversationStatus
          sessionLoading={sessionLoading}
          busyElsewhere={busyElsewhere}
          sessionError={sessionError}
          onRetrySession={retrySession}
          conversationBranch={conversationBranch}
          branchError={branchError}
          onOpenOriginal={async () => { await undoConversationBranch(); }}
          disabled={loading || sessionLoading || busyElsewhere}
        />
        {backEntry
          ? <SessionBackBar entry={backEntry} disabled={loading || sessionLoading || busyElsewhere} onBack={() => void handleSessionBack()} />
          : banner}
      </>}
      pendingLabel={pendingLabel}
      messages={messages}
      loading={loading}
      sessionLoading={sessionLoading}
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
      selectedContext={selectedContext}
      showContextChips={agentScope.kind === 'global'}
      onRemoveContext={onRemoveContext}
      onNodeFocus={onNodeFocus}
      onQuickAction={(prompt, quickAction) => { void handleQuickAction(prompt, quickAction); }}
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
      knowledgeMode={knowledgeMode}
      executionMode={agentScope.kind === 'scheduled' ? 'scheduled' : executionMode}
      onToggleExecutionMode={agentScope.kind === 'scheduled' ? undefined : handleToggleExecutionMode}
      conversationKey={activeSessionId ?? scopeId}
      onEditUserMessage={handleEditUserMessage}
      onRegenerate={handleRegenerate}
      onSessionJump={handleSessionJump}
    />
  );
};
