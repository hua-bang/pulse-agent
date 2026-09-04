import type {
  AgentContextDomReviewComment,
  AgentContextDomSelectionRef,
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
  | { kind: 'node'; node: CanvasNode; sourceWorkspaceId?: string }
  | { kind: 'dom-selection'; selection: AgentContextDomSelectionRef }
  | { kind: 'tab'; tab: AgentContextTabRef }
  | { kind: 'skill'; skillName: string }
  | { kind: 'dom-review'; comments: AgentContextDomReviewComment[] }
  | { kind: 'focus' };

export interface ChatTargetHandlers {
  insertNode?: (node: CanvasNode, sourceWorkspaceId?: string) => void;
  insertDomSelection?: (selection: AgentContextDomSelectionRef) => void;
  insertTab?: (tab: AgentContextTabRef) => void;
  startSkillChat?: (skillName: string) => Promise<void>;
  submitDomReview?: (comments: AgentContextDomReviewComment[]) => Promise<boolean>;
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
