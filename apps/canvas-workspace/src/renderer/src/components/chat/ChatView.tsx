import type {
  ClipboardEventHandler,
  KeyboardEventHandler,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  RefObject,
} from 'react';
import type { AgentChatMessage, CanvasModelStatus, CanvasNode, ChatImageAttachment } from '../../types';
import { ChatEmptyState } from './ChatEmptyState';
import { ChatInput } from './ChatInput';
import { ChatMentionPopup } from './ChatMentionPopup';
import { ChatMessages } from './ChatMessages';
import type { MentionItem, PendingClarification, SelectedContextChip, ToolCallStatus } from './types';

interface ChatViewProps {
  className?: string;
  header?: ReactNode;
  beforeHeader?: ReactNode;
  /** Rendered between the header and the messages list (e.g. session back bar). */
  banner?: ReactNode;

  // Streaming + messages
  messages: AgentChatMessage[];
  loading: boolean;
  workspaceId: string;
  rootFolder?: string;
  streamingTools: ToolCallStatus[];
  messageTools: Map<number, ToolCallStatus[]>;
  collapsedSections: Set<number>;
  expandedTools: Set<number>;
  pendingClarify: PendingClarification | null;
  clarifyInput: string;
  onClarifyInputChange: (value: string) => void;
  onAnswerClarification: () => Promise<void>;
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
  onSubmit: () => Promise<boolean>;
  onAbort: () => Promise<void>;
  contextComposer?: boolean;
  knowledgeMode?: boolean;
  modelStatus?: CanvasModelStatus;
  modelSelection?: { mode: 'auto' | 'model'; providerId?: string; modelId?: string };
  modelLabel?: string;
  onSelectAutoModel?: () => Promise<void>;
  onSelectModel?: (providerId: string, modelId: string) => Promise<void>;
  onOpenModelSettings?: () => void;
  executionMode?: 'auto' | 'ask';
  onToggleExecutionMode?: () => void;

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
  messages,
  loading,
  workspaceId,
  rootFolder,
  streamingTools,
  messageTools,
  collapsedSections,
  expandedTools,
  pendingClarify,
  clarifyInput,
  onClarifyInputChange,
  onAnswerClarification,
  onToggleSection,
  onToggleToolExpand,
  onAddImageToCanvas,
  nodes,
  selectedContext,
  showContextChips = true,
  onRemoveContext,
  onNodeFocus,
  onQuickAction,
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
  onSubmit,
  onAbort,
  contextComposer = false,
  knowledgeMode = false,
  modelStatus,
  modelSelection,
  modelLabel,
  onSelectAutoModel,
  onSelectModel,
  onOpenModelSettings,
  executionMode = 'auto',
  onToggleExecutionMode,
  onEditUserMessage,
  onRegenerate,
  onSessionJump,
  onResizeStart,
}: ChatViewProps) => {
  const hasMessages = messages.length > 0 || loading;

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
          nodes={nodes}
          workspaceId={workspaceId}
          rootFolder={rootFolder}
          streamingTools={streamingTools}
          messageTools={messageTools}
          collapsedSections={collapsedSections}
          expandedTools={expandedTools}
          pendingClarify={pendingClarify}
          clarifyInput={clarifyInput}
          onClarifyInputChange={onClarifyInputChange}
          onAnswerClarification={onAnswerClarification}
          onToggleSection={onToggleSection}
          onToggleToolExpand={onToggleToolExpand}
          onAddImageToCanvas={onAddImageToCanvas}
          onNodeFocus={onNodeFocus}
          onEditUserMessage={onEditUserMessage}
          onRegenerate={onRegenerate}
          onSessionJump={onSessionJump}
        />
      ) : (
        <ChatEmptyState
          selectedCount={selectedContext?.length ?? 0}
          onQuickAction={onQuickAction}
          modelStatus={modelStatus}
          onConfigureModel={onOpenModelSettings}
          knowledgeMode={knowledgeMode}
        />
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
        executionMode={executionMode}
        modelStatus={modelStatus}
        modelSelection={modelSelection}
        modelLabel={modelLabel}
        onSelectAutoModel={onSelectAutoModel}
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
        onSend={onSubmit}
        onAbort={onAbort}
        onToggleExecutionMode={onToggleExecutionMode}
      />
    </div>
  );
};
