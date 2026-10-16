import type {
  AgentContextDomReviewComment,
  AgentContextDomSelectionRef,
  AgentContextNodeRef,
  AgentContextTabRef,
  AgentRequestContext,
  AgentScope,
  CanvasNode,
} from '../types';

export type ChatTargetSurface = 'dock' | 'page';
export type ChatExecutionPolicy = 'auto' | 'ask' | 'scheduled';

export interface ChatContextSnapshot {
  label: string;
  requestContext?: AgentRequestContext;
}

export interface ChatTarget {
  surface: ChatTargetSurface;
  scope: AgentScope;
  scopeId: string;
  sessionId: string | null;
  composerId: string;
  contextSnapshot: ChatContextSnapshot;
  executionPolicy: ChatExecutionPolicy;
}

export type ChatInsertion =
  | { kind: 'file'; filePath: string; isDirectory?: boolean }
  | { kind: 'node'; node: CanvasNode; sourceWorkspaceId?: string }
  | { kind: 'dom-selection'; selection: AgentContextDomSelectionRef }
  | { kind: 'tab'; tab: AgentContextTabRef }
  | { kind: 'skill'; skillName: string }
  | { kind: 'dom-review'; comments: AgentContextDomReviewComment[] }
  | { kind: 'prompt'; prompt: ChatPromptSubmission }
  | { kind: 'focus' };

/** A question sent straight from another surface, scoped to the given nodes. */
export interface ChatPromptSubmission {
  text: string;
  nodes: AgentContextNodeRef[];
  /** Start the turn in a new conversation instead of the one the target shows. */
  newSession?: boolean;
  /** Context from the sender's own mention chips; overrides the target's fields. */
  context?: AgentRequestContext;
}

export interface ChatTargetHandlers {
  insertFile?: (filePath: string, isDirectory?: boolean) => void;
  insertNode?: (node: CanvasNode, sourceWorkspaceId?: string) => void;
  insertDomSelection?: (selection: AgentContextDomSelectionRef) => void;
  insertTab?: (tab: AgentContextTabRef) => void;
  startSkillChat?: (skillName: string) => Promise<void>;
  submitDomReview?: (comments: AgentContextDomReviewComment[]) => Promise<boolean>;
  submitPrompt?: (prompt: ChatPromptSubmission) => Promise<boolean>;
  focus?: () => void;
}

export type ChatDeliveryReceipt =
  | { status: 'delivered'; target: ChatTarget }
  | { status: 'queued'; target: ChatTarget }
  | { status: 'unavailable'; target: ChatTarget | null }
  | { status: 'failed'; target: ChatTarget; error?: string };

export interface ChatTargetBroker {
  register: (target: ChatTarget, handlers: ChatTargetHandlers) => () => void;
  getActiveTarget: () => ChatTarget | null;
  subscribe: (listener: () => void) => () => void;
  deliver: (insertion: ChatInsertion) => Promise<ChatDeliveryReceipt>;
}
