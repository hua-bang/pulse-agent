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
import type { MentionItem, PendingClarification, ToolCallStatus } from './types';

interface ChatViewProps {
  className?: string;
  header?: ReactNode;
  beforeHeader?: ReactNode;

  // Streaming + messages
  messages: AgentChatMessage[];
  loading: boolean;
  workspaceId: string;
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
  selectedNodes?: CanvasNode[];
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
  modelStatus?: CanvasModelStatus;
  modelSelection?: { mode: 'auto' | 'model'; providerId?: string; modelId?: string };
  modelLabel?: string;
  onSelectAutoModel?: () => Promise<void>;
  onSelectModel?: (providerId: string, modelId: string) => Promise<void>;
  onOpenModelSettings?: () => void;
  executionMode?: 'auto' | 'ask';
  onToggleExecutionMode?: () => void;

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
  messages,
  loading,
  workspaceId,
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
  selectedNodes,
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
  modelStatus,
  modelSelection,
  modelLabel,
  onSelectAutoModel,
  onSelectModel,
  onOpenModelSettings,
  executionMode = 'auto',
  onToggleExecutionMode,
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
      {hasMessages ? (
        <ChatMessages
          messages={messages}
          loading={loading}
          nodes={nodes}
          workspaceId={workspaceId}
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
        />
      ) : (
        <ChatEmptyState selectedCount={selectedNodes?.length ?? 0} onQuickAction={onQuickAction} />
      )}
      <ChatInput
        loading={loading}
        input={input}
        attachments={attachments}
        selectedNodes={selectedNodes}
        contextComposer={contextComposer}
        executionMode={executionMode}
        modelStatus={modelStatus}
        modelSelection={modelSelection}
        modelLabel={modelLabel}
        onSelectAutoModel={onSelectAutoModel}
        onSelectModel={onSelectModel}
        onOpenModelSettings={onOpenModelSettings}
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
