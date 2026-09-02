import { useCallback } from 'react';
import './index.css';
import { ChatEmptyState } from './ChatEmptyState';
import { ChatInput } from '../ChatInput';
import { ChatMentionPopup } from '../ChatMentionPopup';
import { ChatMessages } from '../ChatMessages';
import { RelayBar } from './RelayBar';
import { restoreComposerFocusAfterRender } from '../utils/focusRecovery';
import { McpAppsProvider } from '../../mcp-apps/McpAppsProvider';
import type { ChatViewProps } from './types';

/**
 * Presentational body used by both ChatPanel (narrow right-side panel) and
 * ChatPage (full-screen page). Owns no state; callers pass the result of
 * useChatStream + useChatSessions + useChatComposerInput.
 */
export const ChatView = ({ chrome, thread, context, composer }: ChatViewProps) => {
  const { className, header, beforeHeader, banner, onResizeStart } = chrome;
  const {
    pendingLabel, messages, agentScope, loading, sessionLoading = false, workspaceId, rootFolder,
    streamingTools, messageTools, collapsedSections, expandedTools, pendingClarify, clarifyInput,
    clarificationAnswering = false, clarificationError = null, onClarifyInputChange,
    onAnswerClarification, relay, onStopRelay, onToggleSection, onToggleToolExpand,
    onAddImageToCanvas, onNodeFocus, onEditUserMessage, onRegenerate, onSessionJump, conversationKey,
  } = thread;
  const {
    nodes, selectedContext, showContextChips = true, onRemoveContext, onQuickAction, emptyState,
    knowledgeMode = false, emptyStateVariant,
  } = context;
  const {
    inputPlaceholder, input, attachments, editableRef, mentionOpen, mentionItems, mentionIndex,
    onSelectMention, onMentionIndexChange, onInput, onKeyDown, onPaste, onAttachFiles,
    onRemoveAttachment, onRetryAttachment, sendDisabled = false, interactionDisabled = false,
    runInputDisabled = false, onSubmit, onQueue, queuedInputs, steeringInputId, onSteerQueued,
    onRemoveQueued, onAbort, contextComposer = false, modelStatus, modelSelection, modelLabel,
    onSelectModel, onOpenModelSettings,
  } = composer;
  const mcpAppScope = agentScope ?? { kind: 'workspace' as const, workspaceId };
  const hasMessages = messages.length > 0 || loading || sessionLoading || Boolean(pendingLabel);
  const runRecoveryAction = useCallback(async (
    action: () => Promise<boolean | void> | boolean | void,
  ) => {
    const trigger = document.activeElement;
    const result = await action();
    const succeeded = result !== false;
    if (succeeded) {
      restoreComposerFocusAfterRender(() => editableRef.current?.focus(), trigger);
    }
    return succeeded;
  }, [editableRef]);
  const handleEditUserMessage = useCallback((index: number, newContent: string) => (
    runRecoveryAction(() => onEditUserMessage?.(index, newContent))
  ), [onEditUserMessage, runRecoveryAction]);
  const handleRegenerate = useCallback((index: number) => (
    runRecoveryAction(() => onRegenerate?.(index))
  ), [onRegenerate, runRecoveryAction]);

  return (
    <div className={className ?? 'chat-view'}>
      {onResizeStart && (
        <div className="chat-panel-resize" onMouseDown={onResizeStart} />
      )}
      {beforeHeader}
      {header}
      {banner}
      {hasMessages ? (
        <McpAppsProvider scope={mcpAppScope}>
          <ChatMessages
            messages={messages}
            loading={loading}
            sessionLoading={sessionLoading}
            nodes={nodes}
            workspaceId={workspaceId}
            rootFolder={rootFolder}
            streamingTools={streamingTools}
            messageTools={messageTools}
            collapsedSections={collapsedSections}
            expandedTools={expandedTools}
            pendingClarify={pendingClarify}
            clarifyInput={clarifyInput}
            clarificationAnswering={clarificationAnswering}
            interactionDisabled={interactionDisabled || sessionLoading}
            clarificationError={clarificationError}
            onClarifyInputChange={onClarifyInputChange}
            onAnswerClarification={onAnswerClarification}
            onToggleSection={onToggleSection}
            onToggleToolExpand={onToggleToolExpand}
            onAddImageToCanvas={onAddImageToCanvas}
            onNodeFocus={onNodeFocus}
            onEditUserMessage={onEditUserMessage ? handleEditUserMessage : undefined}
            onRegenerate={onRegenerate ? handleRegenerate : undefined}
            onSessionJump={onSessionJump}
            pendingLabel={pendingLabel}
            conversationKey={conversationKey}
          />
        </McpAppsProvider>
      ) : emptyState !== undefined ? emptyState : (
        <ChatEmptyState
          selectedCount={selectedContext?.length ?? 0}
          onQuickAction={onQuickAction}
          variant={emptyStateVariant ?? (knowledgeMode ? 'knowledge' : 'canvas')}
        />
      )}
      {relay && relay.total > 1 && onStopRelay && (
        <RelayBar relay={relay} onStop={onStopRelay} />
      )}
      <ChatInput
        loading={loading}
        input={input}
        attachments={attachments}
        selectedContext={selectedContext}
        showContextChips={showContextChips}
        onRemoveContext={onRemoveContext}
        contextComposer={contextComposer}
        knowledgeMode={knowledgeMode}
        placeholder={inputPlaceholder}
        modelStatus={modelStatus}
        modelSelection={modelSelection}
        modelLabel={modelLabel}
        onSelectModel={onSelectModel}
        onOpenModelSettings={onOpenModelSettings}
        onMentionNavigate={(chip) => {
          const filePath = chip.dataset.filePath;
          if (filePath) {
            void window.canvasWorkspace.file.openInVSCode(filePath);
            return;
          }
          const nodeId = chip.dataset.nodeId;
          if (nodeId) onNodeFocus?.(nodeId);
        }}
        editableRef={editableRef}
        mentionOpen={mentionOpen && mentionItems.length > 0}
        mentionIndex={mentionIndex}
        mentionPopup={mentionOpen && mentionItems.length > 0 ? (
          <ChatMentionPopup
            mentionItems={mentionItems}
            mentionIndex={mentionIndex}
            onSelectMention={onSelectMention}
            onMentionIndexChange={onMentionIndexChange}
          />
        ) : undefined}
        onInput={onInput}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onAttachFiles={onAttachFiles}
        onRemoveAttachment={onRemoveAttachment}
        onRetryAttachment={onRetryAttachment}
        sendDisabled={sendDisabled || sessionLoading}
        interactionDisabled={interactionDisabled || sessionLoading}
        runInputDisabled={runInputDisabled}
        onSend={onSubmit}
        onQueue={onQueue}
        queuedInputs={queuedInputs}
        steeringInputId={steeringInputId}
        onSteerQueued={onSteerQueued}
        onRemoveQueued={onRemoveQueued}
        onAbort={onAbort}
      />
    </div>
  );
};
