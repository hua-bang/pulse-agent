import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChatAnchors } from './ChatAnchors';
import { ChatHeader } from './ChatHeader';
import './ChatPanel.css';
import { ChatView } from './ChatView';
import { SessionBackBar, type SessionBackEntry } from './SessionBackBar';
import { useChatComposerState } from './hooks/useChatComposerState';
import { getNodeDisplayLabel } from '../../utils/nodeLabel';
import type { AgentContextNodeRef, AgentRequestContext } from '../../types';
import type { AgentScope, ChatPanelProps, SelectedContextChip } from './types';
import { buildAnchorElementId, buildChatAnchors } from './utils/anchors';
import { useI18n } from '../../i18n';

export const ChatPanel = ({
  workspaceId,
  agentScope: agentScopeProp,
  allWorkspaces,
  nodes,
  knowledgeNodes,
  knowledgeTags,
  selectedNodeIds,
  contextNodes,
  contextTags,
  contextCanvases,
  onRemoveContext,
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

  // Keep a stable identity for the scope. Passing a fresh literal on every
  // render would make the scope-keyed effects in useChatSessions/useChatStream
  // re-run on each streaming setState, reloading history mid-stream and wiping
  // the in-flight assistant message (intermediate tool/text output vanishing +
  // flicker). Callers that pass an explicit `agentScope` (the global Nodes /
  // Graph host) must memoize it for the same reason.
  const agentScope = useMemo<AgentScope>(
    () => agentScopeProp ?? { kind: 'workspace', workspaceId: workspaceId ?? '' },
    [agentScopeProp, workspaceId],
  );
  const scopeWorkspaceId = agentScope.kind === 'workspace' ? agentScope.workspaceId : undefined;
  // Anchor element ids are namespaced per scope; global chat has no workspace
  // so it falls back to a stable 'global' namespace.
  const anchorScopeId = scopeWorkspaceId ?? 'global';

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
    agentScope,
    allWorkspaces,
    nodes,
    rootFolder,
    knowledgeNodes,
    knowledgeTags,
    collectStructuredContext: agentScope.kind === 'global',
    getRequestContext: () => requestContextRef.current,
  });

  useEffect(() => {
    if (!onRegisterInsertMention) return;
    return onRegisterInsertMention(insertNodeMention);
  }, [insertNodeMention, onRegisterInsertMention]);

  // Explicit context refs (the cross-workspace global host) win; otherwise
  // derive from the single-workspace selection (the canvas panel).
  const derivedSelectedNodes = useMemo(() => {
    const ids = new Set(selectedNodeIds ?? []);
    return (nodes ?? []).filter(node => ids.has(node.id));
  }, [nodes, selectedNodeIds]);

  const contextRefs = useMemo<AgentContextNodeRef[]>(() => {
    if (contextNodes) return contextNodes;
    return derivedSelectedNodes.map(node => ({
      id: node.id,
      title: getNodeDisplayLabel(node),
      type: node.type,
    }));
  }, [contextNodes, derivedSelectedNodes]);

  const selectedContext = useMemo<SelectedContextChip[]>(() => [
    ...contextRefs.map(ref => ({
      key: `node:${ref.workspaceId ?? ''}:${ref.id}`,
      kind: 'node' as const,
      nodeType: ref.type,
      label: ref.title,
    })),
    ...(contextCanvases ?? []).map(canvas => ({
      key: `canvas:${canvas.id}`,
      kind: 'canvas' as const,
      label: canvas.name,
    })),
    ...(contextTags ?? []).map(tag => ({
      key: `tag:${tag.name}`,
      kind: 'tag' as const,
      label: tag.name,
    })),
  ], [contextRefs, contextCanvases, contextTags]);

  const hasContext =
    contextRefs.length > 0 || (contextTags?.length ?? 0) > 0 || (contextCanvases?.length ?? 0) > 0;

  const requestContext = useMemo<AgentRequestContext>(() => ({
    executionMode,
    scope: hasContext ? 'selected_nodes' : 'current_canvas',
    selectedNodes: contextRefs,
    tags: contextTags,
    canvases: contextCanvases,
  }), [executionMode, contextRefs, contextTags, contextCanvases, hasContext]);

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

  // Where chip-jumps came from, newest last. Cleared on manual session
  // switches (menu pick / new chat) — back-navigation only makes sense for
  // the jump trail itself.
  const [sessionBackStack, setSessionBackStack] = useState<SessionBackEntry[]>([]);

  const jumpToSession = useCallback(async (sessionId: string, jumpWorkspaceId: string, messageIndex?: number) => {
    await handleLoadSession(sessionId, jumpWorkspaceId !== scopeWorkspaceId ? jumpWorkspaceId : undefined);
    if (messageIndex !== undefined && messageIndex >= 0) {
      // Allow the DOM to settle after session load, then scroll to target.
      window.setTimeout(() => {
        const id = buildAnchorElementId(anchorScopeId, messageIndex);
        const el = document.getElementById(id);
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        el.classList.add('chat-message--anchor-flash');
        window.setTimeout(() => el.classList.remove('chat-message--anchor-flash'), 1200);
      }, 120);
    }
  }, [anchorScopeId, handleLoadSession, scopeWorkspaceId]);

  const handleSessionJump = useCallback(async (sessionId: string, jumpWorkspaceId: string, messageIndex?: number) => {
    // Record where the jump started so the user can come back.
    try {
      const current = await window.canvasWorkspace.agent.getCurrentSession({ scope: agentScope });
      if (current.ok && current.sessionId && current.sessionId !== sessionId) {
        const entry: SessionBackEntry = {
          sessionId: current.sessionId,
          workspaceId: scopeWorkspaceId ?? '__global_chat__',
          label: sessionTitle,
        };
        setSessionBackStack(prev => [...prev, entry]);
      }
    } catch {
      // Back entry is best-effort; the jump itself still proceeds.
    }
    await jumpToSession(sessionId, jumpWorkspaceId, messageIndex);
  }, [agentScope, jumpToSession, scopeWorkspaceId, sessionTitle]);

  const handleSessionBack = useCallback(async () => {
    const entry = sessionBackStack[sessionBackStack.length - 1];
    if (!entry) return;
    setSessionBackStack(prev => prev.slice(0, -1));
    // Panel back entries are always recorded in this panel's own scope, so a
    // plain same-scope load suffices (jumpToSession resolves it as such).
    await jumpToSession(entry.sessionId, entry.workspaceId);
  }, [jumpToSession, sessionBackStack]);

  // Manual session switches reset the jump trail.
  const handleNewSessionFromMenu = useCallback(async () => {
    setSessionBackStack([]);
    await handleNewSession();
  }, [handleNewSession]);

  const handleLoadSessionFromMenu = useCallback(async (sessionId: string, sourceWorkspaceId?: string) => {
    setSessionBackStack([]);
    await handleLoadSession(sessionId, sourceWorkspaceId);
  }, [handleLoadSession]);

  const backEntry = sessionBackStack[sessionBackStack.length - 1];

  const anchors = useMemo(() => buildChatAnchors(messages), [messages]);

  const handleJumpAnchor = useCallback((index: number) => {
    const id = buildAnchorElementId(anchorScopeId, index);
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.add('chat-message--anchor-flash');
    window.setTimeout(() => {
      el.classList.remove('chat-message--anchor-flash');
    }, 1200);
  }, [anchorScopeId]);

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
          onNewSession={handleNewSessionFromMenu}
          onOpenModelSettings={() => onOpenAppSettings('models')}
          onOpenPromptSettings={() => onOpenAppSettings('reply-style')}
          onLoadSession={handleLoadSessionFromMenu}
          onClose={onClose}
          anchors={<ChatAnchors anchors={anchors} onJump={handleJumpAnchor} />}
        />
      }
      banner={backEntry ? (
        <SessionBackBar entry={backEntry} disabled={loading} onBack={() => void handleSessionBack()} />
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
      selectedContext={selectedContext}
      onRemoveContext={onRemoveContext}
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
      executionMode={scopeWorkspaceId ? executionMode : undefined}
      onToggleExecutionMode={scopeWorkspaceId ? handleToggleExecutionMode : undefined}
      onEditUserMessage={handleEditUserMessage}
      onRegenerate={handleRegenerate}
      onSessionJump={handleSessionJump}
    />
  );
};
