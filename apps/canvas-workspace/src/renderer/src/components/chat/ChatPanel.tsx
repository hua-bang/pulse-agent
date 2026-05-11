import { useCallback, useMemo, useRef, useState } from 'react';
import { ChatHeader } from './ChatHeader';
import './ChatPanel.css';
import { ChatView } from './ChatView';
import { useChatSessions } from './hooks/useChatSessions';
import { useChatStream } from './hooks/useChatStream';
import { useMentions } from './hooks/useMentions';
import { getNodeDisplayLabel } from '../../utils/nodeLabel';
import type { AgentRequestContext } from '../../types';
import type { ChatPanelProps } from './types';

export const ChatPanel = ({
  workspaceId,
  allWorkspaces,
  nodes,
  selectedNodeIds,
  rootFolder,
  onClose,
  onResizeStart,
  onNodeFocus,
}: ChatPanelProps) => {
  const [executionMode, setExecutionMode] = useState<'auto' | 'ask'>('auto');

  const {
    abort,
    addImageToCanvas,
    answerClarification,
    clarifyInput,
    collapsedSections,
    expandedTools,
    loading,
    messageTools,
    messages,
    pendingClarify,
    replaceMessages,
    sendMessage,
    setClarifyInput,
    streamingTools,
    toggleSection,
    toggleToolExpand,
  } = useChatStream({ workspaceId, allWorkspaces });

  const {
    otherSessions,
    handleLoadSession,
    handleNewSession,
    openSessionMenu,
    sessionMenuOpen,
    sessionMenuRef,
    sessions,
  } = useChatSessions({
    workspaceId,
    allWorkspaces,
    onMessagesLoaded: replaceMessages,
  });

  const requestContextRef = useRef<AgentRequestContext>();

  const {
    attachments,
    clearInput,
    editableRef,
    focusInput,
    handleAttachFiles,
    handleInput,
    handleKeyDown,
    handlePaste,
    input,
    mentionIndex,
    mentionItems,
    mentionOpen,
    removeAttachment,
    selectMention,
    setMentionIndex,
    submitCurrentInput,
  } = useMentions({
    allWorkspaces,
    workspaceId,
    nodes,
    rootFolder,
    onSubmit: sendMessage,
    getRequestContext: () => requestContextRef.current,
  });

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
    if (!firstUserMessage) return 'New AI chat';
    const cleaned = firstUserMessage
      .replace(/@\[[^\]]+\]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const fallback = requestContext.scope === 'selected_nodes' ? '整理选中节点' : '分析当前画布';
    const title = cleaned || fallback;
    return title.length > 24 ? `${title.slice(0, 23)}…` : title;
  }, [messages, requestContext.scope]);

  const handleQuickAction = useCallback(async (prompt: string, quickAction?: string) => {
    if (!prompt) {
      focusInput();
      return;
    }

    const ok = await sendMessage(prompt, { ...requestContext, quickAction });
    if (ok) {
      clearInput();
    }
  }, [clearInput, focusInput, requestContext, sendMessage]);

  const handleSubmit = useCallback(async () => {
    return await submitCurrentInput(requestContext);
  }, [requestContext, submitCurrentInput]);

  const handleToggleExecutionMode = useCallback(() => {
    setExecutionMode(mode => mode === 'auto' ? 'ask' : 'auto');
  }, []);

  return (
    <ChatView
      className="chat-panel"
      onResizeStart={onResizeStart}
      header={
        <ChatHeader
          sessionMenuOpen={sessionMenuOpen}
          sessionMenuRef={sessionMenuRef}
          sessions={sessions}
          otherSessions={otherSessions}
          title={sessionTitle}
          onToggleSessionMenu={openSessionMenu}
          onNewSession={handleNewSession}
          onLoadSession={handleLoadSession}
          onClose={onClose}
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
      contextComposer
      executionMode={executionMode}
      onToggleExecutionMode={handleToggleExecutionMode}
    />
  );
};
