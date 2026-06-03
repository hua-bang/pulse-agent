import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChatAnchors } from './ChatAnchors';
import { ChatHeader } from './ChatHeader';
import './ChatPanel.css';
import { ChatView } from './ChatView';
import { useChatComposerState } from './hooks/useChatComposerState';
import { getNodeDisplayLabel } from '../../utils/nodeLabel';
import type { AgentRequestContext } from '../../types';
import type { ChatPanelProps } from './types';
import { buildAnchorElementId, buildChatAnchors } from './utils/anchors';
import { useI18n } from '../../i18n';

export const ChatPanel = ({
  workspaceId,
  allWorkspaces,
  nodes,
  selectedNodeIds,
  rootFolder,
  onClose,
  onResizeStart,
  onNodeFocus,
  onOpenAppSettings,
  onRegisterInsertMention,
}: ChatPanelProps) => {
  const { t } = useI18n();
  const [executionMode, setExecutionMode] = useState<'auto' | 'ask'>('auto');
  const requestContextRef = useRef<AgentRequestContext>();

  const {
    abort,
    addImageToCanvas,
    answerClarification,
    attachments,
    canvasModels,
    clarifyInput,
    clearInput,
    editUserMessage,
    regenerateAssistantMessage,
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
    insertNodeMention,
    loading,
    mentionIndex,
    mentionItems,
    mentionOpen,
    messageTools,
    messages,
    openSessionMenu,
    otherSessions,
    pendingClarify,
    removeAttachment,
    selectMention,
    sendMessage,
    sessionMenuOpen,
    sessionMenuRef,
    sessions,
    sessionsLoading,
    setClarifyInput,
    setMentionIndex,
    streamingTools,
    submitCurrentInput,
    toggleSection,
    toggleToolExpand,
  } = useChatComposerState({
    workspaceId,
    allWorkspaces,
    nodes,
    rootFolder,
    getRequestContext: () => requestContextRef.current,
  });

  useEffect(() => {
    if (!onRegisterInsertMention) return;
    return onRegisterInsertMention(insertNodeMention);
  }, [insertNodeMention, onRegisterInsertMention]);

  const selectedNodes = useMemo(() => {
    const ids = new Set(selectedNodeIds ?? []);
    return (nodes ?? []).filter(node => ids.has(node.id));
  }, [nodes, selectedNodeIds]);

  const requestContext = useMemo<AgentRequestContext>(() => ({
    executionMode,
    scope: selectedNodes.length > 0 ? 'selected_nodes' : 'current_canvas',
    selectedNodes: selectedNodes.map(node => ({
      id: node.id,
      title: getNodeDisplayLabel(node),
      type: node.type,
    })),
  }), [executionMode, selectedNodes]);

  requestContextRef.current = requestContext;

  const sessionTitle = useMemo(() => {
    const firstUserMessage = messages.find(message => message.role === 'user')?.content.trim();
    if (!firstUserMessage) return t('chat.newAiChat');
    const cleaned = firstUserMessage
      .replace(/@\[[^\]]+\]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const fallback = requestContext.scope === 'selected_nodes'
      ? t('chat.quick.organizeSelection')
      : t('chat.quick.analyzeRelations');
    const title = cleaned || fallback;
    return title.length > 24 ? `${title.slice(0, 23)}…` : title;
  }, [messages, requestContext.scope, t]);

  // status.apiKeyPresent is the main process's resolved verdict — false means
  // no provider with a key is configured. Treat undefined (still loading) as
  // "configured" so we don't bounce the user into Settings on first paint.
  const notConfigured = canvasModels.status !== undefined && !canvasModels.status.apiKeyPresent;

  const handleQuickAction = useCallback(async (prompt: string, quickAction?: string) => {
    if (notConfigured) {
      onOpenAppSettings('models');
      return;
    }
    if (!prompt) {
      focusInput();
      return;
    }

    const ok = await sendMessage(prompt, { ...requestContext, quickAction });
    if (ok) {
      clearInput();
    }
  }, [clearInput, focusInput, notConfigured, onOpenAppSettings, requestContext, sendMessage]);

  const handleSubmit = useCallback(async () => {
    if (notConfigured) {
      onOpenAppSettings('models');
      return false;
    }
    return await submitCurrentInput(requestContext);
  }, [notConfigured, onOpenAppSettings, requestContext, submitCurrentInput]);

  const handleToggleExecutionMode = useCallback(() => {
    setExecutionMode(mode => mode === 'auto' ? 'ask' : 'auto');
  }, []);

  const handleEditUserMessage = useCallback(
    (index: number, newContent: string) => editUserMessage(index, newContent, requestContextRef.current),
    [editUserMessage],
  );

  const handleRegenerate = useCallback(
    (index: number) => regenerateAssistantMessage(index, requestContextRef.current),
    [regenerateAssistantMessage],
  );

  const anchors = useMemo(() => buildChatAnchors(messages), [messages]);

  const handleJumpAnchor = useCallback((index: number) => {
    const id = buildAnchorElementId(workspaceId, index);
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.add('chat-message--anchor-flash');
    window.setTimeout(() => {
      el.classList.remove('chat-message--anchor-flash');
    }, 1200);
  }, [workspaceId]);

  return (
    <ChatView
      className="chat-panel"
      onResizeStart={onResizeStart}
      header={
        <ChatHeader
          sessionMenuOpen={sessionMenuOpen}
          sessionMenuRef={sessionMenuRef}
          sessions={sessions}
          sessionsLoading={sessionsLoading}
          otherSessions={otherSessions}
          title={sessionTitle}
          onToggleSessionMenu={openSessionMenu}
          onNewSession={handleNewSession}
          onOpenModelSettings={() => onOpenAppSettings('models')}
          onOpenPromptSettings={() => onOpenAppSettings('reply-style')}
          onLoadSession={handleLoadSession}
          onClose={onClose}
          anchors={<ChatAnchors anchors={anchors} onJump={handleJumpAnchor} />}
        />
      }
      messages={messages}
      loading={loading}
      workspaceId={workspaceId}
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
      selectedNodes={selectedNodes}
      onNodeFocus={onNodeFocus}
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
      onKeyDown={handleKeyDown}
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
      onOpenModelSettings={() => onOpenAppSettings('models')}
      contextComposer
      executionMode={executionMode}
      onToggleExecutionMode={handleToggleExecutionMode}
      onEditUserMessage={handleEditUserMessage}
      onRegenerate={handleRegenerate}
    />
  );
};
