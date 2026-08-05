import {
  useCallback,
  type ClipboardEventHandler,
  type KeyboardEventHandler,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import type { AgentChatMessage, CanvasModelStatus, CanvasNode, ChatImageAttachment } from '../../types';
import { ChatEmptyState, type ChatEmptyStateVariant } from './ChatEmptyState';
import { ChatInput } from './ChatInput';
import { ChatMentionPopup } from './ChatMentionPopup';
import { ChatMessages } from './ChatMessages';
import { RelayBar } from './RelayBar';
import type { RelayProgress } from './hooks/relayTurnHandlers';
import type { MentionItem, PendingClarification, SelectedContextChip, ToolCallStatus } from './types';
import { restoreComposerFocusAfterRender } from './utils/focusRecovery';

interface ChatViewProps {
  className?: string;
  header?: ReactNode;
  beforeHeader?: ReactNode;
  /** Rendered between the header and the messages list (e.g. session back bar). */
  banner?: ReactNode;
  pendingLabel?: string;

  // Streaming + messages
  messages: AgentChatMessage[];
  loading: boolean;
  /**
   * True while the selected conversation's messages are being fetched. Keeps
   * the thread mounted (showing a skeleton) instead of falling through to the
   * empty state, which is what a scope switch used to render for the whole
   * round trip.
   */
  sessionLoading?: boolean;
  workspaceId: string;
  rootFolder?: string;
  streamingTools: ToolCallStatus[];
  messageTools: Map<number, ToolCallStatus[]>;
  collapsedSections: Set<number>;
  expandedTools: Set<number>;
  pendingClarify: PendingClarification | null;
  clarifyInput: string;
  clarificationAnswering?: boolean;
  clarificationError?: string | null;
  onClarifyInputChange: (value: string) => void;
  onAnswerClarification: (answerOverride?: string) => Promise<void>;
  /** Multi-role relay progress (only rendered while a relay turn runs). */
  relay?: RelayProgress | null;
  onStopRelay?: () => void;
  onToggleSection: (messageIndex: number) => void;
  onToggleToolExpand: (toolId: number) => void;
  onAddImageToCanvas?: (imagePath: string, title?: string) => Promise<void> | void;

  // Canvas context
  nodes?: CanvasNode[];
  selectedContext?: SelectedContextChip[];
  showContextChips?: boolean;
  onRemoveContext?: (key: string) => void;
  onNodeFocus?: (nodeId: string) => void;

  // Quick actions (empty state)
  onQuickAction: (prompt: string, quickAction?: string) => Promise<void> | void;
  emptyState?: ReactNode;
  inputPlaceholder?: string;

  // Input
  input: string;
  attachments?: ChatImageAttachment[];
  editableRef: RefObject<HTMLDivElement>;
  mentionOpen: boolean;
  mentionItems: MentionItem[];
  mentionIndex: number;
  onSelectMention: (item: MentionItem) => void;
  onMentionIndexChange: (index: number) => void;
  onInput: () => void;
  onKeyDown: KeyboardEventHandler<HTMLDivElement>;
  onPaste: ClipboardEventHandler<HTMLDivElement>;
  onAttachFiles?: (files: FileList | File[]) => void;
  onRemoveAttachment?: (id: string) => void;
  onRetryAttachment?: (id: string) => void;
  sendDisabled?: boolean;
  interactionDisabled?: boolean;
  onSubmit: () => Promise<boolean>;
  onAbort: () => Promise<boolean>;
  contextComposer?: boolean;
  knowledgeMode?: boolean;
  emptyStateVariant?: ChatEmptyStateVariant;
  modelStatus?: CanvasModelStatus;
  modelSelection?: { mode: 'auto' | 'model'; providerId?: string; modelId?: string };
  modelLabel?: string;
  onSelectModel?: (providerId: string, modelId: string) => Promise<void>;
  onOpenModelSettings?: () => void;
  executionMode?: 'auto' | 'ask' | 'scheduled';
  onToggleExecutionMode?: () => void;
  /** Stable identity for retaining per-conversation scroll position. */
  conversationKey?: string;

  // Edit / regenerate hooks — wired from ChatPanel into the per-message
  // hover toolbar inside ChatMessage.
  onEditUserMessage?: (index: number, newContent: string) => Promise<boolean> | void;
  onRegenerate?: (index: number) => Promise<boolean> | void;

  // Session jump — load a session from a session_search result chip.
  onSessionJump?: (sessionId: string, workspaceId: string, messageIndex?: number) => void;

  // Optional decoration
  onResizeStart?: (e: ReactMouseEvent) => void;
}

/**
 * Presentational body used by both ChatPanel (narrow right-side panel) and
 * ChatPage (full-screen page). Owns no state; callers pass the result of
 * useChatStream + useChatSessions + useMentions.
 */
export const ChatView = ({
  className,
  header,
  beforeHeader,
  banner,
  pendingLabel,
  messages,
  loading,
  sessionLoading = false,
  workspaceId,
  rootFolder,
  streamingTools,
  messageTools,
  collapsedSections,
  expandedTools,
  pendingClarify,
  clarifyInput,
  clarificationAnswering = false,
  clarificationError = null,
  onClarifyInputChange,
  onAnswerClarification,
  relay,
  onStopRelay,
  onToggleSection,
  onToggleToolExpand,
  onAddImageToCanvas,
  nodes,
  selectedContext,
  showContextChips = true,
  onRemoveContext,
  onNodeFocus,
  onQuickAction,
  emptyState,
  inputPlaceholder,
  input,
  attachments,
  editableRef,
  mentionOpen,
  mentionItems,
  mentionIndex,
  onSelectMention,
  onMentionIndexChange,
  onInput,
  onKeyDown,
  onPaste,
  onAttachFiles,
  onRemoveAttachment,
  onRetryAttachment,
  sendDisabled = false,
  interactionDisabled = false,
  onSubmit,
  onAbort,
  contextComposer = false,
  knowledgeMode = false,
  emptyStateVariant,
  modelStatus,
  modelSelection,
  modelLabel,
  onSelectModel,
  onOpenModelSettings,
  executionMode = 'auto',
  onToggleExecutionMode,
  conversationKey,
  onEditUserMessage,
  onRegenerate,
  onSessionJump,
  onResizeStart,
}: ChatViewProps) => {
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
        executionMode={executionMode}
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
        onSend={onSubmit}
        onAbort={onAbort}
        onToggleExecutionMode={onToggleExecutionMode}
      />
    </div>
  );
};
