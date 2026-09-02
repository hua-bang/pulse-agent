import type {
  ClipboardEventHandler,
  KeyboardEventHandler,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  RefObject,
} from 'react';
import type {
  AgentChatMessage,
  AgentScope,
  CanvasModelStatus,
  CanvasNode,
  ChatImageAttachment,
  MentionItem,
  PendingClarification,
  RelayProgress,
  ToolCallStatus,
} from '../../../types';
import type { QueuedInput } from '../../../agent-chat/runtime/useChatRunQueue';
import type { SelectedContextChip } from '../ChatComposer/types';
import type { ChatEmptyStateVariant } from './ChatEmptyState';

export interface ChatViewChrome {
  className?: string;
  header?: ReactNode;
  beforeHeader?: ReactNode;
  banner?: ReactNode;
  onResizeStart?: (event: ReactMouseEvent) => void;
}

export interface ChatViewThread {
  pendingLabel?: string;
  messages: AgentChatMessage[];
  agentScope?: AgentScope;
  loading: boolean;
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
  relay?: RelayProgress | null;
  onStopRelay?: () => void;
  onToggleSection: (messageIndex: number) => void;
  onToggleToolExpand: (toolId: number) => void;
  onAddImageToCanvas?: (imagePath: string, title?: string) => Promise<void> | void;
  onNodeFocus?: (nodeId: string) => void;
  onEditUserMessage?: (index: number, newContent: string) => Promise<boolean> | void;
  onRegenerate?: (index: number) => Promise<boolean> | void;
  onSessionJump?: (sessionId: string, workspaceId: string, messageIndex?: number) => void;
  conversationKey?: string;
}

export interface ChatViewContext {
  nodes?: CanvasNode[];
  selectedContext?: SelectedContextChip[];
  showContextChips?: boolean;
  onRemoveContext?: (key: string) => void;
  onQuickAction: (prompt: string, quickAction?: string) => Promise<void> | void;
  emptyState?: ReactNode;
  knowledgeMode?: boolean;
  emptyStateVariant?: ChatEmptyStateVariant;
}

export interface ChatViewComposer {
  inputPlaceholder?: string;
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
  runInputDisabled?: boolean;
  onSubmit: () => Promise<boolean>;
  onQueue?: () => Promise<boolean>;
  queuedInputs?: QueuedInput[];
  steeringInputId?: number;
  onSteerQueued?: (id: number) => Promise<boolean>;
  onRemoveQueued?: (id: number) => void;
  onAbort: () => Promise<boolean>;
  contextComposer?: boolean;
  modelStatus?: CanvasModelStatus;
  modelSelection?: { mode: 'auto' | 'model'; providerId?: string; modelId?: string };
  modelLabel?: string;
  onSelectModel?: (providerId: string, modelId: string) => Promise<void>;
  onOpenModelSettings?: () => void;
}

export interface ChatViewProps {
  chrome: ChatViewChrome;
  thread: ChatViewThread;
  context: ChatViewContext;
  composer: ChatViewComposer;
}
