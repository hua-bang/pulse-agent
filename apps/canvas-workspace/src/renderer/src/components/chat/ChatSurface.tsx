/**
 * Single, always-mounted chat surface shared by the dock and the full-screen
 * page. It owns exactly one useChatComposerState instance, so the conversation
 * (messages, streaming, sessions, input) is continuous whether it's shown as a
 * right-side dock on any view or expanded to the /chat focus page.
 *
 * `mode` picks the chrome (dock header vs page rail+topbar); it is NOT part of
 * the remount key, so flipping dock <-> page preserves all state. The scope
 * key IS the remount key (applied by <ChatSurface> below), mirroring the old
 * ChatPage behaviour of rebuilding hook subscriptions on a workspace switch.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentContextNodeRef, AgentRequestContext } from '../../types';
import { useI18n } from '../../i18n';
import { CloseIcon, PlusIcon, SettingsIcon, SparklesIcon } from '../icons';
import type { SettingsSection } from '../Settings';
import { ChatAnchors } from './ChatAnchors';
import { ChatHeader } from './ChatHeader';
import { ChatSessionsRail, type UnifiedSession } from './ChatSessionsRail';
import { ChatView } from './ChatView';
import { useChatDock } from './ChatDockContext';
import { useChatComposerState } from './hooks/useChatComposerState';
import type { WorkspaceOption } from './types';
import { buildAnchorElementId, buildChatAnchors } from './utils/anchors';
import { getNodeDisplayLabel } from '../../utils/nodeLabel';
import './ChatPage.css';
import './ChatPanel.css';
import './ChatDock.css';

const RailToggleIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
    <rect x="1.5" y="2.5" width="13" height="11" rx="2" stroke="currentColor" strokeWidth="1.3" />
    <path d="M6 2.5v11" stroke="currentColor" strokeWidth="1.3" />
  </svg>
);

const ExpandIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
    <path d="M9.5 2.5H13.5V6.5M13.5 2.5L9 7M6.5 13.5H2.5V9.5M2.5 13.5L7 9"
      stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CollapseIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
    <path d="M13 3L9 7M9 7V3.5M9 7H12.5M3 13L7 9M7 9V12.5M7 9H3.5"
      stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export interface ChatSurfaceProps {
  mode: 'dock' | 'page';
  visible: boolean;
  allWorkspaces: WorkspaceOption[];
  onOpenAppSettings: (section: SettingsSection) => void;
  /** Page "back": collapse the focus page back to the dock. */
  onCollapseToDock: () => void;
  /** Dock "expand": open the full-screen focus page. */
  onExpandToPage: () => void;
  /** Focus a node on the canvas (navigates there if needed). */
  onNodeFocus: (workspaceId: string, nodeId: string) => void;
  onWorkspaceContextRequest?: (workspaceId: string) => void;
}

const ChatSurfaceInner = ({
  mode,
  visible,
  allWorkspaces,
  onOpenAppSettings,
  onCollapseToDock,
  onExpandToPage,
  onNodeFocus,
  onWorkspaceContextRequest,
}: ChatSurfaceProps) => {
  const { t } = useI18n();
  const dock = useChatDock();
  const {
    agentScope,
    activeContext,
    pendingSessionId,
    newSessionRequest,
    focusInputRequest,
    consumeSession,
    selectSession,
    requestNewGlobalSession,
    registerInsertMention,
    railCollapsed,
    toggleRail,
    closeDock,
    dockWidth,
    setDockWidth,
  } = dock;

  const scopeWorkspaceId = agentScope.kind === 'workspace' ? agentScope.workspaceId : undefined;
  const anchorScopeId = scopeWorkspaceId ?? 'global';

  // The active view's context only applies when it belongs to the current chat
  // scope — otherwise a canvas selection would bleed into a global/other-ws chat.
  const ctxMatches = Boolean(
    activeContext && activeContext.workspaceId && activeContext.workspaceId === scopeWorkspaceId,
  );
  const nodes = ctxMatches ? activeContext?.nodes : undefined;
  const rootFolder = ctxMatches ? activeContext?.rootFolder : undefined;
  const selectedFullNodes = ctxMatches ? activeContext?.selectedNodes : undefined;

  const initialPendingRef = useRef(pendingSessionId);
  const requestContextRef = useRef<AgentRequestContext>();
  const [executionMode, setExecutionMode] = useState<'auto' | 'ask'>('auto');

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
    regenerateAssistantMessage,
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
    eagerLoad: true,
    skipInitialHistory: initialPendingRef.current !== null,
    getRequestContext: () => requestContextRef.current,
  });

  // Expose this surface's mention-insertion to the provider so "add to chat"
  // (from the canvas) can drop an @-chip into the composer.
  useEffect(() => registerInsertMention(insertNodeMention), [insertNodeMention, registerInsertMention]);

  useEffect(() => {
    if (scopeWorkspaceId) onWorkspaceContextRequest?.(scopeWorkspaceId);
  }, [onWorkspaceContextRequest, scopeWorkspaceId]);

  // New global session: fires on (re)mount into the global scope when a request
  // is pending, mirroring the old ChatPage handoff.
  useEffect(() => {
    if (agentScope.kind !== 'global') return;
    if (newSessionRequest <= 0) return;
    void handleNewSession();
  }, [agentScope.kind, handleNewSession, newSessionRequest]);

  useEffect(() => {
    if (pendingSessionId === null) return;
    void handleLoadSession(pendingSessionId).then(() => consumeSession());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSessionId]);

  // One-shot input focus requests (e.g. "Discuss in AI Chat"). Seeded from the
  // current value so it never fires on mount, only on a genuine bump.
  const lastFocusRef = useRef(focusInputRequest);
  useEffect(() => {
    if (focusInputRequest === lastFocusRef.current) return;
    lastFocusRef.current = focusInputRequest;
    if (visible) focusInput();
  }, [focusInputRequest, focusInput, visible]);

  const selectedNodeRefs = useMemo<AgentContextNodeRef[]>(() => {
    if (!ctxMatches) return [];
    if (activeContext?.selectedNodeRefs?.length) return activeContext.selectedNodeRefs;
    if (selectedFullNodes?.length) {
      return selectedFullNodes.map((node) => ({
        id: node.id,
        title: getNodeDisplayLabel(node),
        type: node.type,
      }));
    }
    return [];
  }, [ctxMatches, activeContext, selectedFullNodes]);

  const requestContext = useMemo<AgentRequestContext>(() => ({
    executionMode,
    scope: selectedNodeRefs.length > 0 ? 'selected_nodes' : 'current_canvas',
    selectedNodes: selectedNodeRefs,
  }), [executionMode, selectedNodeRefs]);

  requestContextRef.current = requestContext;

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
    const ok = await sendMessage(prompt, { ...requestContextRef.current, quickAction });
    if (ok) clearInput();
  }, [clearInput, focusInput, notConfigured, onOpenAppSettings, sendMessage]);

  const handleSubmit = useCallback(async () => {
    if (notConfigured) {
      onOpenAppSettings('models');
      return false;
    }
    return await submitCurrentInput(requestContextRef.current);
  }, [notConfigured, onOpenAppSettings, submitCurrentInput]);

  const handleToggleExecutionMode = useCallback(() => {
    setExecutionMode((m) => (m === 'auto' ? 'ask' : 'auto'));
  }, []);

  const handleEditUserMessage = useCallback(
    (index: number, newContent: string) => editUserMessage(index, newContent, requestContextRef.current),
    [editUserMessage],
  );

  const handleRegenerate = useCallback(
    (index: number) => regenerateAssistantMessage(index, requestContextRef.current),
    [regenerateAssistantMessage],
  );

  // Clicking a node reference: prefer the active view's own handler (Nodes /
  // Graph focus in place); otherwise focus it on the canvas. From the page we
  // also collapse back so the target view is visible.
  const handleNodeFocus = useCallback((nodeId: string) => {
    const ctxFocus = ctxMatches ? activeContext?.onNodeFocus : undefined;
    if (ctxFocus) {
      ctxFocus(nodeId, scopeWorkspaceId);
    } else if (scopeWorkspaceId) {
      onNodeFocus(scopeWorkspaceId, nodeId);
    } else {
      return;
    }
    if (mode === 'page') onCollapseToDock();
  }, [ctxMatches, activeContext, mode, onCollapseToDock, onNodeFocus, scopeWorkspaceId]);

  const anchors = useMemo(() => buildChatAnchors(messages), [messages]);

  const handleJumpAnchor = useCallback((messageIndex: number) => {
    const id = buildAnchorElementId(anchorScopeId, messageIndex);
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.add('chat-message--anchor-flash');
    window.setTimeout(() => el.classList.remove('chat-message--anchor-flash'), 1200);
  }, [anchorScopeId]);

  const sessionTitle = useMemo(() => {
    const firstUserMessage = messages.find((m) => m.role === 'user')?.content.trim();
    if (!firstUserMessage) return t('chat.newAiChat');
    const cleaned = firstUserMessage.replace(/@\[[^\]]+\]/g, '').replace(/\s+/g, ' ').trim();
    const fallback = requestContext.scope === 'selected_nodes'
      ? t('chat.quick.organizeSelection')
      : t('chat.quick.analyzeRelations');
    const title = cleaned || fallback;
    return title.length > 24 ? `${title.slice(0, 23)}…` : title;
  }, [messages, requestContext.scope, t]);

  // Unified, cross-workspace session list for the page rail.
  const allSessions = useMemo<UnifiedSession[]>(() => {
    const currentWorkspaceName = scopeWorkspaceId
      ? allWorkspaces.find((w) => w.id === scopeWorkspaceId)?.name ?? scopeWorkspaceId
      : 'Global Chat';
    const currentSessionWorkspaceId = scopeWorkspaceId ?? '__global_chat__';
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
  }, [sessions, otherSessions, scopeWorkspaceId, allWorkspaces]);

  const handleRailNewSession = useCallback(async () => {
    // From a workspace scope the rail's "new chat" returns to the global
    // surface; in global scope it just starts a fresh global session.
    if (agentScope.kind !== 'global') {
      requestNewGlobalSession();
      return;
    }
    await handleNewSession();
  }, [agentScope.kind, handleNewSession, requestNewGlobalSession]);

  const sharedViewProps = {
    messages,
    loading,
    workspaceId: anchorScopeId,
    streamingTools,
    messageTools,
    collapsedSections,
    expandedTools,
    pendingClarify,
    clarifyInput,
    onClarifyInputChange: setClarifyInput,
    onAnswerClarification: answerClarification,
    onToggleSection: toggleSection,
    onToggleToolExpand: toggleToolExpand,
    onAddImageToCanvas: addImageToCanvas,
    nodes,
    selectedNodes: selectedFullNodes,
    onNodeFocus: handleNodeFocus,
    onQuickAction: handleQuickAction,
    input,
    attachments,
    editableRef,
    mentionOpen,
    mentionItems,
    mentionIndex,
    onSelectMention: selectMention,
    onMentionIndexChange: setMentionIndex,
    onInput: handleInput,
    onKeyDown: handleKeyDown,
    onPaste: handlePaste,
    onAttachFiles: handleAttachFiles,
    onRemoveAttachment: removeAttachment,
    onSubmit: handleSubmit,
    onAbort: abort,
    modelStatus: canvasModels.status,
    modelSelection: canvasModels.selection,
    modelLabel: canvasModels.selectedLabel,
    onSelectAutoModel: canvasModels.selectAuto,
    onSelectModel: canvasModels.selectModel,
    onOpenModelSettings: () => onOpenAppSettings('models'),
    contextComposer: true,
    executionMode,
    onToggleExecutionMode: handleToggleExecutionMode,
    onEditUserMessage: handleEditUserMessage,
    onRegenerate: handleRegenerate,
  } as const;

  if (mode === 'page') {
    return (
      <div className="chat-page">
        <div className={`chat-page-rail-wrapper${railCollapsed ? ' chat-page-rail-wrapper--collapsed' : ''}`}>
          <ChatSessionsRail
            allSessions={allSessions}
            onNewSession={handleRailNewSession}
            onSelectSession={selectSession}
          />
        </div>
        <div className="chat-page-main">
          <div className="chat-page-topbar">
            <button
              className="chat-panel-action-btn"
              onClick={toggleRail}
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
              onClick={() => onOpenAppSettings('models')}
              title={t('chat.modelSettings')}
              aria-label={t('chat.modelSettings')}
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
              onClick={onCollapseToDock}
              title={t('chat.collapseToDock')}
              aria-label={t('chat.collapseToDock')}
            >
              <CollapseIcon size={16} />
            </button>
          </div>
          <ChatView className="chat-page-body" {...sharedViewProps} />
        </div>
      </div>
    );
  }

  return (
    <ChatView
      className="chat-panel"
      onResizeStart={(e) => {
        e.preventDefault();
        const startX = e.clientX;
        const startWidth = dockWidth;
        const onMove = (ev: MouseEvent) => setDockWidth(startWidth + (startX - ev.clientX));
        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
        };
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      }}
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
          onClose={closeDock}
          anchors={
            <>
              <ChatAnchors anchors={anchors} onJump={handleJumpAnchor} />
              <button
                className="chat-panel-action-btn"
                onClick={onExpandToPage}
                title={t('chat.expandToPage')}
                aria-label={t('chat.expandToPage')}
              >
                <ExpandIcon size={16} />
              </button>
            </>
          }
        />
      }
      {...sharedViewProps}
    />
  );
};

/**
 * Wrapper that keys the surface by scope so a workspace switch rebuilds the
 * hook subscriptions cleanly (the mode does NOT key it, so dock<->page
 * transitions preserve state).
 */
export const ChatSurface = (props: ChatSurfaceProps) => {
  const { scopeKey } = useChatDock();
  return <ChatSurfaceInner key={scopeKey} {...props} />;
};
